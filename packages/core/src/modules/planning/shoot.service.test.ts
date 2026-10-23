import { randomUUID } from 'node:crypto'

import { createDatabase, schema, type Database, type TenantContext } from '@pof/db'
import { testDatabaseUrls } from '@pof/db/testing'
import { newId } from '@pof/schemas'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { NotFoundError } from '../../errors.ts'
import * as shoots from './shoot.service.ts'

/**
 * Integration coverage for the shoot module: service → repository →
 * withTenant → RLS, against a real Postgres with the real migrations applied.
 *
 * Deliberately not mocked. The behaviour worth testing here — idempotent
 * creates, soft-delete visibility, keyset pagination, and cross-tenant
 * invisibility — is behaviour of the database, and a mock would assert only
 * that the mock works.
 */

let db: Database
let close: () => Promise<void>

const ctxFor = (workspaceId: string): TenantContext => ({ workspaceId, userId: randomUUID() })

/** A fresh workspace per test keeps parallel suites from colliding. */
async function newWorkspace(): Promise<TenantContext> {
  const id = randomUUID()
  await db
    .insert(schema.organization)
    .values({ id, name: `ws-${id.slice(0, 8)}`, slug: `ws-${id.slice(0, 8)}` })
  return ctxFor(id)
}

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

describe('createShoot', () => {
  it('creates a shoot with defaults applied', async () => {
    const ctx = await newWorkspace()

    const created = await shoots.createShoot(db, ctx, {
      name: 'Autumn editorial',
      shootTypeKey: 'editorial',
      status: 'draft',
    })

    expect(created.name).toBe('Autumn editorial')
    expect(created.shootTypeKey).toBe('editorial')
    expect(created.status).toBe('draft')
    expect(created.workspaceId).toBe(ctx.workspaceId)
    expect(created.deletedAt).toBeNull()
  })

  it('is idempotent when the same client id is replayed', async () => {
    const ctx = await newWorkspace()
    const id = newId()

    const first = await shoots.createShoot(db, ctx, {
      id,
      name: 'Offline shoot',
      shootTypeKey: 'portrait',
      status: 'draft',
    })
    // The same mutation arriving twice — a queued offline write being flushed,
    // or a double-tapped submit button. It must not produce two shoots.
    const second = await shoots.createShoot(db, ctx, {
      id,
      name: 'Offline shoot',
      shootTypeKey: 'portrait',
      status: 'draft',
    })

    expect(second.id).toBe(first.id)
    expect(second.createdAt.getTime()).toBe(first.createdAt.getTime())

    const { items } = await shoots.listShoots(db, ctx, { limit: 50, includeDeleted: false })
    expect(items).toHaveLength(1)
  })
})

describe('listShoots', () => {
  it('paginates by keyset and reports the next cursor', async () => {
    const ctx = await newWorkspace()
    for (let i = 0; i < 5; i++) {
      await shoots.createShoot(db, ctx, {
        name: `Shoot ${i}`,
        shootTypeKey: 'portrait',
        status: 'draft',
      })
    }

    const first = await shoots.listShoots(db, ctx, { limit: 2, includeDeleted: false })
    expect(first.items).toHaveLength(2)
    expect(first.nextCursor).not.toBeNull()

    const second = await shoots.listShoots(db, ctx, {
      limit: 2,
      includeDeleted: false,
      cursor: first.nextCursor!,
    })
    expect(second.items).toHaveLength(2)

    // Pages must not overlap — the classic off-by-one in cursor pagination.
    const ids = new Set([...first.items, ...second.items].map((s) => s.id))
    expect(ids.size).toBe(4)
  })

  it('returns no cursor on the final page', async () => {
    const ctx = await newWorkspace()
    await shoots.createShoot(db, ctx, { name: 'Only', shootTypeKey: 'portrait', status: 'draft' })

    const page = await shoots.listShoots(db, ctx, { limit: 50, includeDeleted: false })
    expect(page.items).toHaveLength(1)
    expect(page.nextCursor).toBeNull()
  })

  it('filters by updatedSince so an offline client can sync incrementally', async () => {
    const ctx = await newWorkspace()
    await shoots.createShoot(db, ctx, { name: 'Old', shootTypeKey: 'portrait', status: 'draft' })

    // The cutoff comes from the SERVER, echoed back exactly as a real client
    // must do. Using `new Date()` here instead fails intermittently, because
    // the host clock and the database clock are not the same clock — which is
    // precisely the bug `syncedAt` exists to prevent.
    const { syncedAt: cutoff } = await shoots.listShoots(db, ctx, {
      limit: 50,
      includeDeleted: true,
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    const fresh = await shoots.createShoot(db, ctx, {
      name: 'New',
      shootTypeKey: 'portrait',
      status: 'draft',
    })

    const changed = await shoots.listShoots(db, ctx, {
      limit: 50,
      includeDeleted: true,
      updatedSince: cutoff,
    })

    expect(changed.items.map((s) => s.id)).toEqual([fresh.id])
  })

  it('hands back a server clock for the client to echo as the next cutoff', async () => {
    const ctx = await newWorkspace()
    const page = await shoots.listShoots(db, ctx, { limit: 50, includeDeleted: false })

    expect(page.syncedAt).toBeInstanceOf(Date)
  })

  it('hides another workspace entirely', async () => {
    const [a, b] = [await newWorkspace(), await newWorkspace()]
    await shoots.createShoot(db, a, { name: "A's", shootTypeKey: 'portrait', status: 'draft' })

    const seenByB = await shoots.listShoots(db, b, { limit: 50, includeDeleted: false })
    expect(seenByB.items).toHaveLength(0)
  })
})

describe('updateShoot', () => {
  it('renames a shoot and advances updatedAt via the database trigger', async () => {
    const ctx = await newWorkspace()
    const created = await shoots.createShoot(db, ctx, {
      name: 'Before',
      shootTypeKey: 'portrait',
      status: 'draft',
    })

    await new Promise((resolve) => setTimeout(resolve, 10))
    const updated = await shoots.updateShoot(db, ctx, { id: created.id, name: 'After' })

    expect(updated.name).toBe('After')
    // The trigger, not application code, is what guarantees this — which is
    // why incremental sync can rely on updatedAt never going stale.
    expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime())
  })

  it('clears notes when explicitly set to null', async () => {
    const ctx = await newWorkspace()
    const created = await shoots.createShoot(db, ctx, {
      name: 'With notes',
      shootTypeKey: 'portrait',
      status: 'draft',
      notes: 'bring the 85mm',
    })
    expect(created.notes).toBe('bring the 85mm')

    const cleared = await shoots.updateShoot(db, ctx, { id: created.id, notes: null })
    expect(cleared.notes).toBeNull()
  })

  it('reports another workspace row as simply not found', async () => {
    const [a, b] = [await newWorkspace(), await newWorkspace()]
    const owned = await shoots.createShoot(db, a, {
      name: "A's",
      shootTypeKey: 'portrait',
      status: 'draft',
    })

    // B must not be able to tell "exists but is not yours" from "does not
    // exist" — the distinction itself leaks information.
    await expect(shoots.updateShoot(db, b, { id: owned.id, name: 'hijacked' })).rejects.toThrow(
      NotFoundError,
    )

    const stillOriginal = await shoots.getShoot(db, a, owned.id)
    expect(stillOriginal.name).toBe("A's")
  })
})

describe('deleteShoot', () => {
  it('soft-deletes, hiding the row from normal listings', async () => {
    const ctx = await newWorkspace()
    const created = await shoots.createShoot(db, ctx, {
      name: 'Doomed',
      shootTypeKey: 'portrait',
      status: 'draft',
    })

    const deleted = await shoots.deleteShoot(db, ctx, created.id)
    expect(deleted.deletedAt).toBeInstanceOf(Date)

    const visible = await shoots.listShoots(db, ctx, { limit: 50, includeDeleted: false })
    expect(visible.items).toHaveLength(0)
  })

  it('still surfaces the row as a tombstone for syncing clients', async () => {
    const ctx = await newWorkspace()
    const created = await shoots.createShoot(db, ctx, {
      name: 'Tombstone',
      shootTypeKey: 'portrait',
      status: 'draft',
    })
    await shoots.deleteShoot(db, ctx, created.id)

    // An offline client needs to learn the row is gone so it can drop its
    // local copy. A hard delete would leave it orphaned there forever.
    const withDeleted = await shoots.listShoots(db, ctx, { limit: 50, includeDeleted: true })
    expect(withDeleted.items).toHaveLength(1)
    expect(withDeleted.items[0]?.deletedAt).toBeInstanceOf(Date)
  })

  it('refuses to delete twice', async () => {
    const ctx = await newWorkspace()
    const created = await shoots.createShoot(db, ctx, {
      name: 'Once',
      shootTypeKey: 'portrait',
      status: 'draft',
    })

    await shoots.deleteShoot(db, ctx, created.id)
    await expect(shoots.deleteShoot(db, ctx, created.id)).rejects.toThrow(NotFoundError)
  })
})
