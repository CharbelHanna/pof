import { shootTypes } from '@pof/core'

import { authed, pub } from './base.ts'
import { campaignRouter } from './routers/campaign.ts'
import { crewRouter } from './routers/crew.ts'
import { gearItemRouter, shootGearRouter } from './routers/gear.ts'
import { locationRouter } from './routers/location.ts'
import { sessionLocationRouter } from './routers/session-location.ts'
import { sessionRouter } from './routers/session.ts'
import { shootRouter } from './routers/shoot.ts'
import { shotGearRouter } from './routers/shot-gear.ts'
import { shotRouter } from './routers/shot.ts'

/**
 * The root router — the single surface every client reaches.
 *
 *   Web      → RPC handler at /api/rpc, typed client from @pof/api-client
 *   Mobile   → the identical typed client, different base URL (Phase 8).
 *              Zero new server code.
 *   Public   → OpenAPI handler at /api/v1 over this same router
 */
export const router = {
  /** Liveness probe. Deliberately public and dependency-free. */
  health: pub
    .route({ method: 'GET', path: '/health', summary: 'Liveness probe' })
    .handler(() => ({ status: 'ok' as const, time: new Date().toISOString() })),

  /**
   * The genre list plus each genre's field definitions, so the dynamic form
   * renderer needs no hardcoded knowledge of which genres exist.
   *
   * Authenticated despite being global reference data: there is no reason to
   * expose the product's shape to anonymous callers, and keeping every
   * non-health procedure behind auth means "is this one public?" is never a
   * question anybody has to re-ask.
   */
  shootTypes: {
    list: authed
      .route({ method: 'GET', path: '/shoot-types', summary: 'List shoot types' })
      .handler(({ context }) => shootTypes.listShootTypes(context.db)),
  },

  shoots: shootRouter,
  campaigns: campaignRouter,
  sessions: sessionRouter,
  crew: crewRouter,
  gearItems: gearItemRouter,
  shootGear: shootGearRouter,
  locations: locationRouter,
  sessionLocations: sessionLocationRouter,
  shots: shotRouter,
  shotGear: shotGearRouter,
}

export type AppRouter = typeof router
