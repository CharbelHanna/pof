import { randomUUID } from 'node:crypto'

import { createDatabase, schema, type TenantContext } from '@pof/db'
import { newId } from '@pof/schemas'
import { eq } from 'drizzle-orm'

import * as shoots from './modules/planning/shoot.service.ts'

/**
 * Development seed.
 *
 * Creates a demo workspace and a handful of shoots across genres, going
 * through the REAL service layer — so running it exercises withTenant, the
 * RLS policies, the trigger-maintained updatedAt and the idempotent create
 * path, rather than just inserting rows. If this script succeeds, the stack
 * genuinely works.
 *
 * Safe to re-run: it reuses the demo workspace and the shoot ids are fixed,
 * so repeated runs converge rather than piling up duplicates.
 *
 *   pnpm db:seed
 */

const DEMO_SLUG = 'demo-studio'

/** Fixed ids make the seed idempotent on re-run. */
const DEMO_SHOOTS = [
  {
    id: '0193a000-0000-7000-8000-000000000001',
    name: 'Nadia — portfolio portraits',
    shootTypeKey: 'portrait',
    status: 'confirmed' as const,
    notes: 'Natural light, bring the 85mm and the reflector.',
  },
  {
    id: '0193a000-0000-7000-8000-000000000002',
    name: 'Vogue Italia — autumn editorial',
    shootTypeKey: 'editorial',
    status: 'planning' as const,
    notes: 'Three looks, studio day plus a rooftop golden hour session.',
  },
  {
    id: '0193a000-0000-7000-8000-000000000003',
    name: 'Glen Coe — winter landscape',
    shootTypeKey: 'landscape',
    status: 'draft' as const,
    notes: 'Sunrise call. Check tide and road access the night before.',
  },
  {
    id: '0193a000-0000-7000-8000-000000000004',
    name: 'Aurora Ceramics — catalogue',
    shootTypeKey: 'product',
    status: 'shooting' as const,
    notes: '42 SKUs on white, plus six lifestyle sets.',
  },
  {
    id: '0193a000-0000-7000-8000-000000000005',
    name: 'Cancelled test shoot',
    shootTypeKey: 'portrait',
    status: 'cancelled' as const,
    notes: null,
  },
]

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL must be set (copy .env.example to .env)')

  const { db, client } = createDatabase(url, { max: 4 })

  try {
    // --- demo user + workspace -------------------------------------------
    // Inserted directly because Better Auth owns the signup flow and there is
    // no HTTP server yet. Note there is no password account, so this user
    // cannot log in — that arrives with apps/web.
    const [existingOrg] = await db
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.slug, DEMO_SLUG))
      .limit(1)

    let workspaceId = existingOrg?.id
    let userId: string

    if (!workspaceId) {
      workspaceId = newId()
      userId = newId()

      await db.insert(schema.user).values({
        id: userId,
        name: 'Demo Photographer',
        email: `demo+${workspaceId.slice(0, 8)}@pointoffocus.local`,
        emailVerified: true,
      })
      await db.insert(schema.organization).values({
        id: workspaceId,
        name: 'Demo Studio',
        slug: DEMO_SLUG,
      })
      await db.insert(schema.member).values({
        id: newId(),
        organizationId: workspaceId,
        userId,
        role: 'owner',
      })
      console.log(`[seed] created workspace "Demo Studio" (${workspaceId})`)
    } else {
      const [member] = await db
        .select()
        .from(schema.member)
        .where(eq(schema.member.organizationId, workspaceId))
        .limit(1)
      userId = member?.userId ?? randomUUID()
      console.log(`[seed] reusing workspace "Demo Studio" (${workspaceId})`)
    }

    const ctx: TenantContext = { workspaceId, userId }

    // --- shoots, through the real service --------------------------------
    for (const shoot of DEMO_SHOOTS) {
      const created = await shoots.createShoot(db, ctx, {
        id: shoot.id,
        name: shoot.name,
        shootTypeKey: shoot.shootTypeKey,
        status: shoot.status,
        ...(shoot.notes ? { notes: shoot.notes } : {}),
      })
      console.log(`[seed]   ${created.status.padEnd(10)} ${created.name}`)
    }

    // Demonstrates soft delete: the row stays as a tombstone for syncing
    // clients but disappears from normal listings.
    const tombstone = DEMO_SHOOTS.at(-1)!
    const alreadyDeleted = await shoots
      .getShoot(db, ctx, tombstone.id)
      .then((s) => s.deletedAt !== null)
    if (!alreadyDeleted) {
      await shoots.deleteShoot(db, ctx, tombstone.id)
      console.log(`[seed]   soft-deleted "${tombstone.name}" to show tombstones`)
    }

    const visible = await shoots.listShoots(db, ctx, { limit: 50, includeDeleted: false })
    const withTombstones = await shoots.listShoots(db, ctx, { limit: 50, includeDeleted: true })

    console.log('')
    console.log(
      `[seed] done. ${visible.items.length} active shoots, ${withTombstones.items.length} including tombstones.`,
    )
    console.log(`[seed] server clock for incremental sync: ${visible.syncedAt.toISOString()}`)
    console.log('[seed] browse the data with: pnpm db:studio')
  } finally {
    await client.end({ timeout: 5 })
  }
}

main().catch((error: unknown) => {
  console.error('[seed] failed:', error)
  process.exit(1)
})
