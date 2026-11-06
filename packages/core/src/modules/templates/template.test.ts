import { createDatabase, schema, withTenant, type Database } from '@pof/db'
import { testDatabaseUrls } from '@pof/db/testing'
import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { NotFoundError, ValidationError } from '../../errors.ts'
import { newWorkspace, sessionWindow } from '../../testing/fixtures.ts'
import * as checklists from '../preparation/checklist.service.ts'
import * as shots from '../preparation/shot.service.ts'
import * as sessions from '../planning/session.service.ts'
import * as shoots from '../planning/shoot.service.ts'
import * as templates from './template.service.ts'

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
type Ctx = Awaited<ReturnType<typeof ws>>

async function shootWithSession(ctx: Ctx, name = 'Template test shoot') {
  const shoot = await shoots.createShoot(db, ctx, {
    name,
    shootTypeKey: 'portrait',
    status: 'planned',
  })
  const session = await sessions.createSession(db, ctx, {
    shootId: shoot.id,
    name: 'Day one',
    status: 'planned',
    timezone: 'UTC',
    ...sessionWindow(),
  })
  return { shoot, session }
}

const SHOT_ITEM = {
  kind: 'shot' as const,
  title: 'Wide establishing frame',
  framing: 'Wide',
}

const GEAR_ITEM = {
  kind: 'checklist_item' as const,
  checklistName: 'Camera bag',
  checklistKind: 'gear' as const,
  label: 'Batteries',
}

async function templateWith(
  ctx: Ctx,
  items: Parameters<typeof templates.publishTemplateVersion>[2]['items'],
) {
  const template = await templates.createTemplate(db, ctx, { name: 'Studio portrait' })
  await templates.publishTemplateVersion(db, ctx, { templateId: template.id, items })
  return template
}

describe('publishTemplateVersion', () => {
  it('numbers versions from one and moves the current pointer', async () => {
    const ctx = await ws()
    const template = await templates.createTemplate(db, ctx, { name: 'Studio portrait' })

    // Named but empty is a legitimate state: there is nothing to apply yet.
    expect(template.currentVersion).toBe(0)

    const first = await templates.publishTemplateVersion(db, ctx, {
      templateId: template.id,
      items: [SHOT_ITEM],
    })
    expect(first.version).toBe(1)

    const second = await templates.publishTemplateVersion(db, ctx, {
      templateId: template.id,
      items: [SHOT_ITEM, GEAR_ITEM],
    })
    expect(second.version).toBe(2)

    const { template: reread } = await templates.getTemplate(db, ctx, { id: template.id })
    expect(reread.currentVersion).toBe(2)
  })

  /**
   * The guarantee the whole design rests on. Publishing v2 must leave v1
   * exactly as it was, because sessions built from v1 describe what actually
   * happened on the day.
   */
  it('leaves earlier versions untouched', async () => {
    const ctx = await ws()
    const template = await templates.createTemplate(db, ctx, { name: 'Studio portrait' })

    await templates.publishTemplateVersion(db, ctx, {
      templateId: template.id,
      items: [SHOT_ITEM],
    })
    await templates.publishTemplateVersion(db, ctx, {
      templateId: template.id,
      items: [{ ...SHOT_ITEM, title: 'Something else entirely' }, GEAR_ITEM],
    })

    const v1 = await templates.getTemplate(db, ctx, { id: template.id, version: 1 })
    expect(v1.items).toHaveLength(1)
    expect(v1.items[0]!.payload).toMatchObject({ title: 'Wide establishing frame' })

    const v2 = await templates.getTemplate(db, ctx, { id: template.id, version: 2 })
    expect(v2.items).toHaveLength(2)
  })

  it('keeps the authored order', async () => {
    const ctx = await ws()
    const template = await templateWith(ctx, [
      { ...SHOT_ITEM, title: 'First' },
      { ...SHOT_ITEM, title: 'Second' },
      { ...SHOT_ITEM, title: 'Third' },
    ])

    const { items } = await templates.getTemplate(db, ctx, { id: template.id })
    expect(items.map((item) => (item.payload as { title: string }).title)).toEqual([
      'First',
      'Second',
      'Third',
    ])
  })

  it('refuses a template that does not exist', async () => {
    const ctx = await ws()

    await expect(
      templates.publishTemplateVersion(db, ctx, {
        templateId: crypto.randomUUID(),
        items: [SHOT_ITEM],
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('applyTemplate', () => {
  it('copies shots into the session with provenance', async () => {
    const ctx = await ws()
    const { shoot, session } = await shootWithSession(ctx)
    const template = await templateWith(ctx, [SHOT_ITEM])

    const result = await templates.applyTemplate(db, ctx, {
      templateId: template.id,
      sessionId: session.id,
    })
    expect(result.shots).toBe(1)

    const { items } = await shots.listShots(db, ctx, {
      shootId: shoot.id,
      limit: 100,
      includeDeleted: false,
    })

    expect(items).toHaveLength(1)
    expect(items[0]!.title).toBe('Wide establishing frame')
    expect(items[0]!.framing).toBe('Wide')
    expect(items[0]!.sessionId).toBe(session.id)
    // The stamp that makes a later diff possible.
    expect(items[0]!.sourceTemplateItemId).not.toBeNull()
  })

  it('records which template and version the session was built from', async () => {
    const ctx = await ws()
    const { session } = await shootWithSession(ctx)
    const template = await templateWith(ctx, [SHOT_ITEM])

    await templates.applyTemplate(db, ctx, { templateId: template.id, sessionId: session.id })

    /**
     * Read through `withTenant`. A bare `db` query carries no
     * `app.workspace_id`, so FORCE row-level security correctly returns
     * nothing — which the isolation suite proves on purpose, and which makes
     * a direct read here look like a missing column rather than a working
     * policy.
     */
    const row = await withTenant(db, ctx, async (tx) => {
      const [found] = await tx
        .select({
          appliedTemplateId: schema.shootSession.appliedTemplateId,
          appliedTemplateVersion: schema.shootSession.appliedTemplateVersion,
        })
        .from(schema.shootSession)
        .where(eq(schema.shootSession.id, session.id))
      return found
    })

    expect(row!.appliedTemplateId).toBe(template.id)
    expect(row!.appliedTemplateVersion).toBe(1)
  })

  it('creates checklists and their lines', async () => {
    const ctx = await ws()
    const { shoot, session } = await shootWithSession(ctx)
    const template = await templateWith(ctx, [
      GEAR_ITEM,
      { ...GEAR_ITEM, label: 'Cards' },
      { ...GEAR_ITEM, checklistName: 'Before the day', checklistKind: 'prep', label: 'Charge' },
    ])

    const result = await templates.applyTemplate(db, ctx, {
      templateId: template.id,
      sessionId: session.id,
    })
    expect(result.checklistItems).toBe(3)

    const { items: lists } = await checklists.listChecklists(db, ctx, {
      shootId: shoot.id,
      limit: 100,
      includeDeleted: false,
    })

    expect(lists).toHaveLength(2)
    const bag = lists.find((list) => list.name === 'Camera bag')
    expect(bag!.itemCount).toBe(2)
    expect(bag!.kind).toBe('gear')
  })

  /**
   * Two templates that both want a "Camera bag" mean the same real bag.
   * Splitting it into two lists is exactly how something gets left behind.
   */
  it('reuses a checklist that already exists with the same name and kind', async () => {
    const ctx = await ws()
    const { shoot, session } = await shootWithSession(ctx)

    const first = await templateWith(ctx, [GEAR_ITEM])
    const second = await templateWith(ctx, [{ ...GEAR_ITEM, label: 'Cards' }])

    await templates.applyTemplate(db, ctx, { templateId: first.id, sessionId: session.id })
    await templates.applyTemplate(db, ctx, { templateId: second.id, sessionId: session.id })

    const { items: lists } = await checklists.listChecklists(db, ctx, {
      shootId: shoot.id,
      limit: 100,
      includeDeleted: false,
    })

    expect(lists).toHaveLength(1)
    expect(lists[0]!.itemCount).toBe(2)
  })

  it('appends after shots that are already planned', async () => {
    const ctx = await ws()
    const { shoot, session } = await shootWithSession(ctx)

    const existing = await shots.createShot(db, ctx, {
      shootId: shoot.id,
      title: 'Already planned',
      status: 'planned',
    })

    const template = await templateWith(ctx, [SHOT_ITEM])
    await templates.applyTemplate(db, ctx, { templateId: template.id, sessionId: session.id })

    const { items } = await shots.listShots(db, ctx, {
      shootId: shoot.id,
      limit: 100,
      includeDeleted: false,
    })
    const byPosition = [...items].sort((a, b) => a.position - b.position)

    expect(byPosition.map((row) => row.title)).toEqual([
      'Already planned',
      'Wide establishing frame',
    ])
    expect(byPosition[1]!.position).toBeGreaterThan(existing.position)
  })

  it('applies an older version when asked', async () => {
    const ctx = await ws()
    const { shoot, session } = await shootWithSession(ctx)
    const template = await templates.createTemplate(db, ctx, { name: 'Studio portrait' })

    await templates.publishTemplateVersion(db, ctx, {
      templateId: template.id,
      items: [{ ...SHOT_ITEM, title: 'The old way' }],
    })
    await templates.publishTemplateVersion(db, ctx, {
      templateId: template.id,
      items: [{ ...SHOT_ITEM, title: 'The new way' }],
    })

    const result = await templates.applyTemplate(db, ctx, {
      templateId: template.id,
      sessionId: session.id,
      version: 1,
    })
    expect(result.version).toBe(1)

    const { items } = await shots.listShots(db, ctx, {
      shootId: shoot.id,
      limit: 100,
      includeDeleted: false,
    })
    expect(items[0]!.title).toBe('The old way')
  })

  it('refuses a template with nothing published', async () => {
    const ctx = await ws()
    const { session } = await shootWithSession(ctx)
    const template = await templates.createTemplate(db, ctx, { name: 'Empty' })

    await expect(
      templates.applyTemplate(db, ctx, { templateId: template.id, sessionId: session.id }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('refuses a session that does not exist', async () => {
    const ctx = await ws()
    const template = await templateWith(ctx, [SHOT_ITEM])

    await expect(
      templates.applyTemplate(db, ctx, {
        templateId: template.id,
        sessionId: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  /**
   * Editing a template must not reach backwards into a shoot that already
   * happened. This is the behaviour the copy-not-link decision exists for,
   * so it is asserted directly rather than inferred from the schema.
   */
  it('does not touch a session that was already built from an earlier version', async () => {
    const ctx = await ws()
    const { shoot, session } = await shootWithSession(ctx)
    const template = await templateWith(ctx, [SHOT_ITEM])

    await templates.applyTemplate(db, ctx, { templateId: template.id, sessionId: session.id })

    await templates.publishTemplateVersion(db, ctx, {
      templateId: template.id,
      items: [
        { ...SHOT_ITEM, title: 'Rewritten' },
        { ...SHOT_ITEM, title: 'And an extra' },
      ],
    })

    const { items } = await shots.listShots(db, ctx, {
      shootId: shoot.id,
      limit: 100,
      includeDeleted: false,
    })

    expect(items).toHaveLength(1)
    expect(items[0]!.title).toBe('Wide establishing frame')
  })
})

describe('saveSessionAsTemplate', () => {
  it('captures the session shots and the shoot checklists', async () => {
    const ctx = await ws()
    const { shoot, session } = await shootWithSession(ctx)

    await shots.createShot(db, ctx, {
      shootId: shoot.id,
      sessionId: session.id,
      title: 'Wide establishing frame',
      status: 'planned',
    })

    const list = await checklists.createChecklist(db, ctx, {
      shootId: shoot.id,
      name: 'Camera bag',
      kind: 'gear',
    })
    await checklists.addChecklistItems(db, ctx, {
      checklistId: list.id,
      labels: ['Batteries', 'Cards'],
    })

    const saved = await templates.saveSessionAsTemplate(db, ctx, {
      sessionId: session.id,
      name: 'Studio portrait',
    })

    expect(saved.version.version).toBe(1)
    expect(saved.itemCount).toBe(3)

    const { items } = await templates.getTemplate(db, ctx, { id: saved.template.id })
    const kinds = items.map((item) => item.kind)
    expect(kinds.filter((kind) => kind === 'shot')).toHaveLength(1)
    expect(kinds.filter((kind) => kind === 'checklist_item')).toHaveLength(2)
  })

  /** A round trip is the strongest statement that the copy is faithful. */
  it('round-trips into another session', async () => {
    const ctx = await ws()
    const source = await shootWithSession(ctx, 'Source shoot')

    await shots.createShot(db, ctx, {
      shootId: source.shoot.id,
      sessionId: source.session.id,
      title: 'Wide establishing frame',
      framing: 'Wide',
      status: 'planned',
    })
    const list = await checklists.createChecklist(db, ctx, {
      shootId: source.shoot.id,
      name: 'Camera bag',
      kind: 'gear',
    })
    await checklists.addChecklistItems(db, ctx, { checklistId: list.id, labels: ['Batteries'] })

    const saved = await templates.saveSessionAsTemplate(db, ctx, {
      sessionId: source.session.id,
      name: 'Studio portrait',
    })

    const target = await shootWithSession(ctx, 'Target shoot')
    await templates.applyTemplate(db, ctx, {
      templateId: saved.template.id,
      sessionId: target.session.id,
    })

    const { items: copiedShots } = await shots.listShots(db, ctx, {
      shootId: target.shoot.id,
      limit: 100,
      includeDeleted: false,
    })
    expect(copiedShots).toHaveLength(1)
    expect(copiedShots[0]!.title).toBe('Wide establishing frame')
    expect(copiedShots[0]!.framing).toBe('Wide')

    const { items: copiedLists } = await checklists.listChecklists(db, ctx, {
      shootId: target.shoot.id,
      limit: 100,
      includeDeleted: false,
    })
    expect(copiedLists).toHaveLength(1)
    expect(copiedLists[0]!.name).toBe('Camera bag')
    expect(copiedLists[0]!.itemCount).toBe(1)
  })

  it('refuses a session with nothing in it', async () => {
    const ctx = await ws()
    const { session } = await shootWithSession(ctx)

    await expect(
      templates.saveSessionAsTemplate(db, ctx, { sessionId: session.id, name: 'Nothing' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('deleteTemplate', () => {
  /**
   * A session that reports "built from Studio Portrait v2" has to be able to
   * show what v2 was, so removing the template must not take its history.
   */
  it('keeps versions and items so applied sessions can still explain themselves', async () => {
    const ctx = await ws()
    const template = await templateWith(ctx, [SHOT_ITEM])

    await templates.deleteTemplate(db, ctx, template.id)

    const { items: visible } = await templates.listTemplates(db, ctx, {
      limit: 100,
      includeDeleted: false,
    })
    expect(visible).toHaveLength(0)

    const versions = await withTenant(db, ctx, (tx) =>
      tx
        .select()
        .from(schema.sessionTemplateVersion)
        .where(
          and(
            eq(schema.sessionTemplateVersion.templateId, template.id),
            eq(schema.sessionTemplateVersion.workspaceId, ctx.workspaceId),
          ),
        )
        .orderBy(asc(schema.sessionTemplateVersion.version)),
    )

    expect(versions).toHaveLength(1)
  })
})

describe('tenant scoping', () => {
  it('will not apply another workspace template', async () => {
    const mine = await ws()
    const theirs = await ws()

    const template = await templateWith(theirs, [SHOT_ITEM])
    const { session } = await shootWithSession(mine)

    await expect(
      templates.applyTemplate(db, mine, { templateId: template.id, sessionId: session.id }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('will not list another workspace templates', async () => {
    const mine = await ws()
    const theirs = await ws()

    await templateWith(theirs, [SHOT_ITEM])

    const { items } = await templates.listTemplates(db, mine, {
      limit: 100,
      includeDeleted: false,
    })
    expect(items).toHaveLength(0)
  })
})
