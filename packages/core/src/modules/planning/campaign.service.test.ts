import { createDatabase, type Database, type TenantContext } from '@pof/db'
import { testDatabaseUrls } from '@pof/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { NotFoundError, ValidationError } from '../../errors.ts'
import { newWorkspace } from '../../testing/fixtures.ts'
import * as campaigns from './campaign.service.ts'
import * as shoots from './shoot.service.ts'

let db: Database
let close: () => Promise<void>

beforeAll(async () => {
  const created = createDatabase(testDatabaseUrls().appUrl, { max: 5 })
  db = created.db
  close = async () => {
    await created.client.end({ timeout: 5 })
  }
})

afterAll(async () => {
  await close?.()
})

const ws = () => newWorkspace(db)

describe('createCampaign', () => {
  it('creates a campaign with defaults', async () => {
    const ctx = await ws()
    const created = await campaigns.createCampaign(db, ctx, {
      name: 'Autumn/Winter 2027',
      status: 'draft',
    })

    expect(created.name).toBe('Autumn/Winter 2027')
    expect(created.status).toBe('draft')
    expect(created.workspaceId).toBe(ctx.workspaceId)
  })

  it('is idempotent when the same client id is replayed', async () => {
    const ctx = await ws()
    const id = crypto.randomUUID()

    const first = await campaigns.createCampaign(db, ctx, { id, name: 'Once', status: 'draft' })
    const second = await campaigns.createCampaign(db, ctx, { id, name: 'Once', status: 'draft' })

    expect(second.id).toBe(first.id)
    const { items } = await campaigns.listCampaigns(db, ctx, {
      limit: 50,
      includeDeleted: false,
    })
    expect(items).toHaveLength(1)
  })

  it('stores plain dates without a time component', async () => {
    const ctx = await ws()
    const created = await campaigns.createCampaign(db, ctx, {
      name: 'Dated',
      status: 'active',
      startsOn: '2027-03-01',
      endsOn: '2027-03-31',
    })

    // A campaign runs "through March" — storing an instant would let a viewer
    // further west see it start in February.
    expect(created.startsOn).toBe('2027-03-01')
    expect(created.endsOn).toBe('2027-03-31')
  })
})

describe('tenant isolation', () => {
  it('hides another workspace campaign entirely', async () => {
    const [a, b] = [await ws(), await ws()]
    await campaigns.createCampaign(db, a, { name: "A's campaign", status: 'draft' })

    const seenByB = await campaigns.listCampaigns(db, b, { limit: 50, includeDeleted: false })
    expect(seenByB.items).toHaveLength(0)
  })

  it('reports another workspace campaign as simply not found', async () => {
    const [a, b] = [await ws(), await ws()]
    const owned = await campaigns.createCampaign(db, a, { name: "A's", status: 'draft' })

    await expect(campaigns.getCampaign(db, b, owned.id)).rejects.toThrow(NotFoundError)
  })
})

describe('linking shoots to campaigns', () => {
  it('attaches a shoot to a campaign in the same workspace', async () => {
    const ctx = await ws()
    const campaign = await campaigns.createCampaign(db, ctx, { name: 'Group', status: 'active' })

    const shoot = await shoots.createShoot(db, ctx, {
      name: 'Member shoot',
      shootTypeKey: 'portrait',
      status: 'draft',
      campaignId: campaign.id,
    })

    expect(shoot.campaignId).toBe(campaign.id)
  })

  it('refuses to attach a shoot to another workspace campaign', async () => {
    const [a, b] = [await ws(), await ws()]
    const foreign = await campaigns.createCampaign(db, a, { name: "A's", status: 'active' })

    // The composite foreign key makes this impossible at the database level
    // too, but a constraint violation is an opaque 500 to a user.
    await expect(
      shoots.createShoot(db, b, {
        name: 'Sneaky',
        shootTypeKey: 'portrait',
        status: 'draft',
        campaignId: foreign.id,
      }),
    ).rejects.toThrow(NotFoundError)
  })

  it('refuses to attach a shoot to a deleted campaign', async () => {
    const ctx = await ws()
    const campaign = await campaigns.createCampaign(db, ctx, { name: 'Gone', status: 'active' })
    await campaigns.deleteCampaign(db, ctx, campaign.id)

    await expect(
      shoots.createShoot(db, ctx, {
        name: 'Orphan',
        shootTypeKey: 'portrait',
        status: 'draft',
        campaignId: campaign.id,
      }),
    ).rejects.toThrow(ValidationError)
  })

  it('keeps the shoot when its campaign is deleted', async () => {
    const ctx = await ws()
    const campaign = await campaigns.createCampaign(db, ctx, { name: 'Doomed', status: 'active' })
    const shoot = await shoots.createShoot(db, ctx, {
      name: 'Survivor',
      shootTypeKey: 'portrait',
      status: 'draft',
      campaignId: campaign.id,
    })

    await campaigns.deleteCampaign(db, ctx, campaign.id)

    // ON DELETE SET NULL, not CASCADE. Losing a shoot means losing real
    // planning work; losing its grouping is an inconvenience. This is the
    // single most destructive thing a wrong FK action could do here.
    const stillThere = await shoots.getShoot(db, ctx, shoot.id)
    expect(stillThere.name).toBe('Survivor')
    expect(stillThere.deletedAt).toBeNull()
  })
})

describe('deleteCampaign', () => {
  it('soft-deletes and hides it from normal listings', async () => {
    const ctx = await ws()
    const campaign = await campaigns.createCampaign(db, ctx, { name: 'Bye', status: 'draft' })

    await campaigns.deleteCampaign(db, ctx, campaign.id)

    const visible = await campaigns.listCampaigns(db, ctx, { limit: 50, includeDeleted: false })
    expect(visible.items).toHaveLength(0)

    const withTombstones = await campaigns.listCampaigns(db, ctx, {
      limit: 50,
      includeDeleted: true,
    })
    expect(withTombstones.items).toHaveLength(1)
  })
})
