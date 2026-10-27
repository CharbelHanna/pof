import { randomUUID } from 'node:crypto'

import { schema, type Database, type TenantContext } from '@pof/db'

/**
 * A fresh workspace per test.
 *
 * Isolation between tests comes from each one owning a distinct workspace
 * rather than from truncating tables — Vitest runs files in parallel workers
 * against one database, so a global truncate would corrupt neighbouring
 * suites. It is also a more honest setup, since it exercises the same tenant
 * scoping the application uses.
 */
export async function newWorkspace(db: Database): Promise<TenantContext> {
  const id = randomUUID()
  const slug = `ws-${id.slice(0, 8)}`

  await db.insert(schema.organization).values({ id, name: slug, slug })

  return { workspaceId: id, userId: randomUUID() }
}

/** Dates far enough out that they never collide with other fixtures. */
export function sessionWindow(offsetHours = 0): { startsAt: Date; endsAt: Date } {
  const startsAt = new Date(Date.UTC(2027, 2, 14, 6 + offsetHours, 0, 0))
  return { startsAt, endsAt: new Date(startsAt.getTime() + 2 * 60 * 60 * 1000) }
}
