import { pub } from './base.ts'
import { shootRouter } from './routers/shoot.ts'

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

  shoots: shootRouter,
}

export type AppRouter = typeof router
