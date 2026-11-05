import { createDatabase, type Database } from '@pof/db'
import { testDatabaseUrls } from '@pof/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { NotFoundError, ValidationError } from '../../errors.ts'
import { newWorkspace } from '../../testing/fixtures.ts'
import * as shoots from '../planning/shoot.service.ts'
import * as checklists from './checklist.service.ts'

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

async function shootFor(ctx: Awaited<ReturnType<typeof ws>>, name = 'Checklist test shoot') {
  return shoots.createShoot(db, ctx, { name, shootTypeKey: 'portrait', status: 'planned' })
}

async function listFor(ctx: Awaited<ReturnType<typeof ws>>, name = 'Camera bag') {
  const shoot = await shootFor(ctx)
  const list = await checklists.createChecklist(db, ctx, {
    shootId: shoot.id,
    name,
    kind: 'gear',
  })
  return { shoot, list }
}

describe('createChecklist', () => {
  it('creates a list against a shoot', async () => {
    const ctx = await ws()
    const shoot = await shootFor(ctx)

    const created = await checklists.createChecklist(db, ctx, {
      shootId: shoot.id,
      name: 'Camera bag',
      kind: 'gear',
    })

    expect(created.name).toBe('Camera bag')
    expect(created.kind).toBe('gear')
    // Null means the list belongs to the whole shoot, which is the common
    // case for gear: the bag is packed once for the trip.
    expect(created.sessionId).toBeNull()
    expect(created.workspaceId).toBe(ctx.workspaceId)
  })

  it('defaults to prep, the kind most lists turn out to be', async () => {
    const ctx = await ws()
    const shoot = await shootFor(ctx)

    const created = await checklists.createChecklist(db, ctx, {
      shootId: shoot.id,
      name: 'Before the day',
      kind: 'prep',
    })

    expect(created.kind).toBe('prep')
  })

  it('appends rather than colliding on position', async () => {
    const ctx = await ws()
    const shoot = await shootFor(ctx)

    const first = await checklists.createChecklist(db, ctx, {
      shootId: shoot.id,
      name: 'Camera bag',
      kind: 'gear',
    })
    const second = await checklists.createChecklist(db, ctx, {
      shootId: shoot.id,
      name: 'Lighting case',
      kind: 'gear',
    })

    expect(second.position).toBeGreaterThan(first.position)
  })

  it('refuses a shoot that does not exist', async () => {
    const ctx = await ws()

    await expect(
      checklists.createChecklist(db, ctx, {
        shootId: crypto.randomUUID(),
        name: 'Orphan',
        kind: 'gear',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('refuses a deleted shoot', async () => {
    const ctx = await ws()
    const shoot = await shootFor(ctx)
    await shoots.deleteShoot(db, ctx, shoot.id)

    await expect(
      checklists.createChecklist(db, ctx, { shootId: shoot.id, name: 'Too late', kind: 'gear' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  /**
   * The offline path: a client mints the id, loses connectivity, and retries.
   * The second call must return the original row rather than a duplicate.
   */
  it('is idempotent on a client-supplied id', async () => {
    const ctx = await ws()
    const shoot = await shootFor(ctx)
    const id = crypto.randomUUID()

    const first = await checklists.createChecklist(db, ctx, {
      id,
      shootId: shoot.id,
      name: 'Camera bag',
      kind: 'gear',
    })
    const again = await checklists.createChecklist(db, ctx, {
      id,
      shootId: shoot.id,
      name: 'Camera bag',
      kind: 'gear',
    })

    expect(again.id).toBe(first.id)

    const { items } = await checklists.listChecklists(db, ctx, {
      shootId: shoot.id,
      limit: 100,
      includeDeleted: false,
    })
    expect(items).toHaveLength(1)
  })
})

describe('listChecklists', () => {
  it('reports progress without a second query per list', async () => {
    const ctx = await ws()
    const { shoot, list } = await listFor(ctx)

    await checklists.addChecklistItems(db, ctx, {
      checklistId: list.id,
      labels: ['Batteries', 'Cards', 'Tripod', 'ND filter'],
    })

    const { items: before } = await checklists.listChecklists(db, ctx, {
      shootId: shoot.id,
      limit: 100,
      includeDeleted: false,
    })
    expect(before[0]!.itemCount).toBe(4)
    expect(before[0]!.doneCount).toBe(0)

    const { items: lines } = await checklists.listChecklistItems(db, ctx, {
      checklistId: list.id,
      limit: 200,
      includeDeleted: false,
    })
    await checklists.setChecklistItemDone(db, ctx, { id: lines[0]!.id, done: true })

    const { items: after } = await checklists.listChecklists(db, ctx, {
      shootId: shoot.id,
      limit: 100,
      includeDeleted: false,
    })
    expect(after[0]!.doneCount).toBe(1)
    expect(after[0]!.itemCount).toBe(4)
  })

  /** A crossed-off line is not progress, and must not inflate either count. */
  it('excludes deleted items from both counts', async () => {
    const ctx = await ws()
    const { shoot, list } = await listFor(ctx)

    const added = await checklists.addChecklistItems(db, ctx, {
      checklistId: list.id,
      labels: ['Batteries', 'Cards'],
    })
    await checklists.setChecklistItemDone(db, ctx, { id: added[0]!.id, done: true })
    await checklists.deleteChecklistItem(db, ctx, added[0]!.id)

    const { items } = await checklists.listChecklists(db, ctx, {
      shootId: shoot.id,
      limit: 100,
      includeDeleted: false,
    })

    expect(items[0]!.itemCount).toBe(1)
    expect(items[0]!.doneCount).toBe(0)
  })

  it('filters to the lists belonging to the whole shoot when sessionId is null', async () => {
    const ctx = await ws()
    const shoot = await shootFor(ctx)

    await checklists.createChecklist(db, ctx, {
      shootId: shoot.id,
      name: 'Whole shoot',
      kind: 'gear',
    })

    const { items } = await checklists.listChecklists(db, ctx, {
      shootId: shoot.id,
      sessionId: null,
      limit: 100,
      includeDeleted: false,
    })

    expect(items).toHaveLength(1)
    expect(items[0]!.name).toBe('Whole shoot')
  })

  it('filters by kind', async () => {
    const ctx = await ws()
    const shoot = await shootFor(ctx)

    await checklists.createChecklist(db, ctx, { shootId: shoot.id, name: 'Bag', kind: 'gear' })
    await checklists.createChecklist(db, ctx, { shootId: shoot.id, name: 'Before', kind: 'prep' })

    const { items } = await checklists.listChecklists(db, ctx, {
      shootId: shoot.id,
      kind: 'prep',
      limit: 100,
      includeDeleted: false,
    })

    expect(items).toHaveLength(1)
    expect(items[0]!.name).toBe('Before')
  })
})

describe('deleteChecklist', () => {
  /**
   * Leaving the items live would hide them from every view while keeping them
   * in the table — invisible but not gone, which is the shape of a bug found
   * months later.
   */
  it('takes its items with it', async () => {
    const ctx = await ws()
    const { list } = await listFor(ctx)

    await checklists.addChecklistItems(db, ctx, {
      checklistId: list.id,
      labels: ['Batteries', 'Cards'],
    })

    await checklists.deleteChecklist(db, ctx, list.id)

    const { items } = await checklists.listChecklistItems(db, ctx, {
      checklistId: list.id,
      limit: 200,
      includeDeleted: false,
    })
    expect(items).toHaveLength(0)

    const { items: withDeleted } = await checklists.listChecklistItems(db, ctx, {
      checklistId: list.id,
      limit: 200,
      includeDeleted: true,
    })
    expect(withDeleted).toHaveLength(2)
  })
})

describe('addChecklistItems', () => {
  it('adds a burst of lines in their given order', async () => {
    const ctx = await ws()
    const { list } = await listFor(ctx)

    const added = await checklists.addChecklistItems(db, ctx, {
      checklistId: list.id,
      labels: ['Batteries', 'Cards', 'Tripod'],
    })

    expect(added.map((row) => row.label)).toEqual(['Batteries', 'Cards', 'Tripod'])
    expect(added[0]!.position).toBeLessThan(added[1]!.position)
    expect(added[1]!.position).toBeLessThan(added[2]!.position)
  })

  it('appends after lines that are already there', async () => {
    const ctx = await ws()
    const { list } = await listFor(ctx)

    const first = await checklists.addChecklistItems(db, ctx, {
      checklistId: list.id,
      labels: ['Batteries'],
    })
    const second = await checklists.addChecklistItems(db, ctx, {
      checklistId: list.id,
      labels: ['Cards'],
    })

    expect(second[0]!.position).toBeGreaterThan(first[0]!.position)
  })

  it('refuses a deleted checklist', async () => {
    const ctx = await ws()
    const { list } = await listFor(ctx)
    await checklists.deleteChecklist(db, ctx, list.id)

    await expect(
      checklists.addChecklistItems(db, ctx, { checklistId: list.id, labels: ['Too late'] }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('setChecklistItemDone', () => {
  it('records when, from the server clock', async () => {
    const ctx = await ws()
    const { list } = await listFor(ctx)
    const [item] = await checklists.addChecklistItems(db, ctx, {
      checklistId: list.id,
      labels: ['Batteries'],
    })

    const before = Date.now()
    const ticked = await checklists.setChecklistItemDone(db, ctx, { id: item!.id, done: true })

    expect(ticked.doneAt).toBeInstanceOf(Date)
    // Within a generous window of now, which is what "the server decided"
    // actually means in an assertion.
    expect(ticked.doneAt!.getTime()).toBeGreaterThan(before - 60_000)
    expect(ticked.doneAt!.getTime()).toBeLessThan(Date.now() + 60_000)
  })

  it('unticks back to null', async () => {
    const ctx = await ws()
    const { list } = await listFor(ctx)
    const [item] = await checklists.addChecklistItems(db, ctx, {
      checklistId: list.id,
      labels: ['Batteries'],
    })

    await checklists.setChecklistItemDone(db, ctx, { id: item!.id, done: true })
    const unticked = await checklists.setChecklistItemDone(db, ctx, { id: item!.id, done: false })

    expect(unticked.doneAt).toBeNull()
  })

  /**
   * The first time it was done is the fact worth keeping. Re-ticking an
   * already-ticked item is almost always a double tap on a phone, and moving
   * the timestamp would quietly rewrite when the bag was actually packed.
   */
  it('does not move the timestamp when ticked twice', async () => {
    const ctx = await ws()
    const { list } = await listFor(ctx)
    const [item] = await checklists.addChecklistItems(db, ctx, {
      checklistId: list.id,
      labels: ['Batteries'],
    })

    const first = await checklists.setChecklistItemDone(db, ctx, { id: item!.id, done: true })
    const again = await checklists.setChecklistItemDone(db, ctx, { id: item!.id, done: true })

    expect(again.doneAt!.getTime()).toBe(first.doneAt!.getTime())
  })

  it('refuses an item that does not exist', async () => {
    const ctx = await ws()

    await expect(
      checklists.setChecklistItemDone(db, ctx, { id: crypto.randomUUID(), done: true }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('reorderChecklistItems', () => {
  it('rewrites the order in one call', async () => {
    const ctx = await ws()
    const { list } = await listFor(ctx)
    const added = await checklists.addChecklistItems(db, ctx, {
      checklistId: list.id,
      labels: ['Batteries', 'Cards', 'Tripod'],
    })

    const reversed = [added[2]!.id, added[1]!.id, added[0]!.id]
    const result = await checklists.reorderChecklistItems(db, ctx, {
      checklistId: list.id,
      orderedIds: reversed,
    })

    expect(result.reordered).toBe(3)

    const { items } = await checklists.listChecklistItems(db, ctx, {
      checklistId: list.id,
      limit: 200,
      includeDeleted: false,
    })
    const byPosition = [...items].sort((a, b) => a.position - b.position)
    expect(byPosition.map((row) => row.label)).toEqual(['Tripod', 'Cards', 'Batteries'])
  })

  /**
   * A partial list would leave the omitted items at stale positions, which
   * looks like the drag silently failing — far harder to diagnose than a
   * rejected request.
   */
  it('refuses a partial order', async () => {
    const ctx = await ws()
    const { list } = await listFor(ctx)
    const added = await checklists.addChecklistItems(db, ctx, {
      checklistId: list.id,
      labels: ['Batteries', 'Cards', 'Tripod'],
    })

    await expect(
      checklists.reorderChecklistItems(db, ctx, {
        checklistId: list.id,
        orderedIds: [added[0]!.id, added[1]!.id],
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('refuses a duplicated id', async () => {
    const ctx = await ws()
    const { list } = await listFor(ctx)
    const added = await checklists.addChecklistItems(db, ctx, {
      checklistId: list.id,
      labels: ['Batteries', 'Cards'],
    })

    await expect(
      checklists.reorderChecklistItems(db, ctx, {
        checklistId: list.id,
        orderedIds: [added[0]!.id, added[0]!.id],
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  /** An id from another list must not be silently accepted and repositioned. */
  it('refuses an id from a different checklist', async () => {
    const ctx = await ws()
    const { shoot, list } = await listFor(ctx)
    const other = await checklists.createChecklist(db, ctx, {
      shootId: shoot.id,
      name: 'Lighting case',
      kind: 'gear',
    })

    const mine = await checklists.addChecklistItems(db, ctx, {
      checklistId: list.id,
      labels: ['Batteries'],
    })
    const theirs = await checklists.addChecklistItems(db, ctx, {
      checklistId: other.id,
      labels: ['Stands'],
    })

    await expect(
      checklists.reorderChecklistItems(db, ctx, {
        checklistId: list.id,
        orderedIds: [mine[0]!.id, theirs[0]!.id],
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('tenant scoping', () => {
  /**
   * The service layer must not be reachable across workspaces even with a
   * valid id, independently of the RLS backstop proven in the isolation
   * suite.
   */
  it('will not read another workspace checklist by id', async () => {
    const mine = await ws()
    const theirs = await ws()

    const { list } = await listFor(theirs)

    await expect(
      checklists.updateChecklist(db, mine, { id: list.id, name: 'Stolen' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('will not add items to another workspace checklist', async () => {
    const mine = await ws()
    const theirs = await ws()

    const { list } = await listFor(theirs)

    await expect(
      checklists.addChecklistItems(db, mine, { checklistId: list.id, labels: ['Sneaky'] }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
