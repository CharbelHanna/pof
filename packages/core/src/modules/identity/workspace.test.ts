import { randomUUID } from 'node:crypto'

import { createDatabase, schema, type Database } from '@pof/db'
import { testDatabaseUrls } from '@pof/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ensureWorkspaceForUser, findWorkspaceForUser } from './workspace.ts'

let db: Database
let close: () => Promise<void>

beforeAll(async () => {
  const created = createDatabase(testDatabaseUrls().appUrl, { max: 10 })
  db = created.db
  close = async () => {
    await created.client.end({ timeout: 5 })
  }
})

afterAll(async () => {
  await close?.()
})

async function newUser(): Promise<string> {
  const id = randomUUID()
  await db.insert(schema.user).values({
    id,
    name: 'Provisioning test',
    email: `prov-${id}@pof.test`,
    emailVerified: true,
  })
  return id
}

describe('ensureWorkspaceForUser', () => {
  it('creates a workspace on first use', async () => {
    const userId = await newUser()

    const workspaceId = await ensureWorkspaceForUser(db, userId)

    expect(workspaceId).toBeTruthy()
    expect(await findWorkspaceForUser(db, userId)).toBe(workspaceId)
  })

  it('returns the same workspace on repeat calls', async () => {
    const userId = await newUser()

    const first = await ensureWorkspaceForUser(db, userId)
    const second = await ensureWorkspaceForUser(db, userId)

    expect(second).toBe(first)
  })

  /**
   * The regression this file exists for.
   *
   * A newly signed-up user's first page load fires many requests at once —
   * the shoot page alone queries the shoot, the genre list, campaigns,
   * sessions, crew, gear, the gear library and locations — and every one of
   * them resolves a session, so every one tries to provision.
   *
   * Before the advisory lock, the losers re-read membership before the
   * winner had committed, found nothing, and threw "Could not provision a
   * workspace for user". It surfaced in CI as the whole suite failing at
   * sign-up.
   */
  it('survives many simultaneous first requests for the same user', async () => {
    const userId = await newUser()

    const results = await Promise.all(
      Array.from({ length: 12 }, () => ensureWorkspaceForUser(db, userId)),
    )

    // Every caller gets an answer, and they all agree.
    expect(new Set(results).size).toBe(1)

    // Exactly one workspace and one membership — not twelve.
    const members = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(eq(schema.member.userId, userId))
    expect(members).toHaveLength(1)
  })

  it('does not confuse concurrent provisioning of different users', async () => {
    const users = await Promise.all([newUser(), newUser(), newUser(), newUser()])

    const workspaces = await Promise.all(
      users.flatMap((userId) => [
        ensureWorkspaceForUser(db, userId),
        ensureWorkspaceForUser(db, userId),
      ]),
    )

    // Each user gets exactly one workspace, and no two users share one.
    const perUser = await Promise.all(users.map((id) => findWorkspaceForUser(db, id)))
    expect(new Set(perUser).size).toBe(users.length)
    expect(workspaces.filter(Boolean)).toHaveLength(users.length * 2)
  })

  /**
   * The one-way trap the old code could fall into: an organization created
   * without its membership. Every later attempt conflicted on the slug and
   * the re-read found nothing, so the user was permanently stuck.
   */
  it('recovers a half-provisioned workspace rather than failing forever', async () => {
    const userId = await newUser()
    const slug = `ws-${userId.replaceAll('-', '').slice(0, 12)}`

    // Simulate the crash: the organization exists, the membership does not.
    await db.insert(schema.organization).values({ id: randomUUID(), name: 'My Studio', slug })

    const workspaceId = await ensureWorkspaceForUser(db, userId)

    expect(workspaceId).toBeTruthy()
    expect(await findWorkspaceForUser(db, userId)).toBe(workspaceId)
  })

  it('cannot record the same user in one workspace twice', async () => {
    const userId = await newUser()
    const workspaceId = await ensureWorkspaceForUser(db, userId)

    // The backstop under the advisory lock. Every read treats membership as
    // singular, so a duplicate would make "which workspace?" depend on row
    // order.
    //
    // Asserting on the cause rather than the message: Drizzle wraps driver
    // errors in a generic "Failed query:" string, so matching the message
    // would pass for any failure at all, including a typo in the insert.
    const cause = await db
      .insert(schema.member)
      .values({ id: randomUUID(), organizationId: workspaceId, userId, role: 'owner' })
      .then(
        () => null,
        (error: { cause?: { constraint_name?: string } }) => error.cause,
      )

    expect(cause?.constraint_name).toBe('member_organization_id_user_id_key')
  })

  it('honours a requested workspace only when the user is a member', async () => {
    const [mine, theirs] = [await newUser(), await newUser()]
    const myWorkspace = await ensureWorkspaceForUser(db, mine)
    const theirWorkspace = await ensureWorkspaceForUser(db, theirs)

    // Asking for someone else's workspace must not grant it — this value
    // comes from a client-controlled cookie.
    expect(await findWorkspaceForUser(db, mine, theirWorkspace)).toBe(myWorkspace)
    expect(await findWorkspaceForUser(db, mine, myWorkspace)).toBe(myWorkspace)
  })
})
