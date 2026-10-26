import { ORPCError } from '@orpc/client'
import { os } from '@orpc/server'
import { NotFoundError, PlanLimitExceededError, ValidationError } from '@pof/core'
import { ZodError } from 'zod'

import type { ApiContext } from './context.ts'

/**
 * Procedure builders.
 *
 * Procedures are ADAPTERS, nothing more: validate input, assemble a tenant
 * context, call a plain function in `@pof/core`, map errors. Business rules
 * live in the service layer so the web UI, a future Expo app and any future
 * public API all reach identical behaviour — and so swapping the transport,
 * if oRPC ever stops being the right bet, is a day's work rather than a
 * rewrite. Keep handlers boring.
 */

const base = os.$context<ApiContext>()

/**
 * Translate domain errors into transport errors.
 *
 * `@pof/core` knows nothing about HTTP — it throws `NotFoundError`, not a 404.
 * Doing the mapping once here means every procedure gets consistent status
 * codes for free, and a new service can never accidentally leak a raw stack
 * trace as a 500.
 */
const mapDomainErrors = base.middleware(async ({ next }) => {
  try {
    return await next()
  } catch (error) {
    if (error instanceof NotFoundError) {
      throw new ORPCError('NOT_FOUND', { message: error.message })
    }
    if (error instanceof ValidationError) {
      throw new ORPCError('BAD_REQUEST', { message: error.message })
    }
    if (error instanceof PlanLimitExceededError) {
      throw new ORPCError('FORBIDDEN', { message: error.message })
    }

    /**
     * Validation that cannot happen in the input schema.
     *
     * Genre-specific `details` are checked in the service layer, because the
     * valid shape depends on `shootTypeKey` — a sibling field a field-level
     * schema cannot see. The service therefore throws a ZodError *after*
     * oRPC's own input validation has already passed.
     *
     * Without this branch that surfaced as a 500 "Internal server error":
     * the user saw a server fault for what was really a typo, and the field
     * that was wrong was never reported.
     */
    if (error instanceof ZodError) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'Validation failed',
        data: {
          issues: error.issues.map((issue) => ({
            path: issue.path.map(String),
            message: issue.message,
          })),
        },
      })
    }

    throw error
  }
})

/**
 * Require an authenticated session and derive the tenant context from it.
 *
 * This is the only place a `TenantContext` is constructed for API callers, so
 * there is exactly one path by which a request becomes workspace-scoped.
 */
const requireAuth = base.middleware(async ({ context, next }) => {
  if (!context.session) {
    throw new ORPCError('UNAUTHORIZED', { message: 'Sign in to continue' })
  }

  return next({
    context: {
      ...context,
      session: context.session,
      tenant: {
        workspaceId: context.session.workspaceId,
        userId: context.session.userId,
      },
    },
  })
})

/** Procedures callable without a session. */
export const pub = base.use(mapDomainErrors)

/** Procedures that require a signed-in user with a resolved workspace. */
export const authed = base.use(mapDomainErrors).use(requireAuth)
