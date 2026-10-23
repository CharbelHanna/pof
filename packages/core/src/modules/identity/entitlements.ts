import type { TenantContext } from '@pof/db'

/**
 * Plan limits — the commercial seam.
 *
 * There is no billing in V1 and there may never be: whether this becomes a
 * commercial SaaS is undecided. But the expensive half of adding billing is
 * not the Stripe integration (that is a weekend); it is finding and
 * retrofitting every place a limit should apply, across dozens of procedures,
 * long after the code was written.
 *
 * So the call sites exist from day one and the implementation does not.
 * `assertWithin` is a no-op returning an unlimited plan. Adding tiers later is
 * this one file plus a `subscription` table keyed by `workspace_id` — not an
 * audit of the whole API.
 *
 * If this stays a personal tool, nothing is wasted: it is dead code nobody
 * notices, and the storage counter it would read is a useful "you're using
 * 4.2 GB" line in settings regardless.
 */

export type LimitKey = 'shoots' | 'sessions' | 'templates' | 'storageBytes' | 'members'

export interface Plan {
  readonly key: 'unlimited'
  readonly limits: Readonly<Record<LimitKey, number>>
}

const UNLIMITED: Plan = {
  key: 'unlimited',
  limits: {
    shoots: Number.POSITIVE_INFINITY,
    sessions: Number.POSITIVE_INFINITY,
    templates: Number.POSITIVE_INFINITY,
    storageBytes: Number.POSITIVE_INFINITY,
    members: Number.POSITIVE_INFINITY,
  },
}

export class PlanLimitExceededError extends Error {
  constructor(
    readonly limit: LimitKey,
    readonly allowed: number,
  ) {
    super(`Plan limit reached for ${limit} (max ${allowed})`)
    this.name = 'PlanLimitExceededError'
  }
}

/** The workspace's current plan. Always unlimited until billing exists. */
export async function getPlan(_ctx: TenantContext): Promise<Plan> {
  return UNLIMITED
}

/**
 * Assert the workspace may create `count` more of `limit`.
 *
 * Call this in every procedure that creates a countable resource, even though
 * it currently does nothing. That is the entire point — the call site is the
 * expensive part to add later.
 */
export async function assertWithin(
  ctx: TenantContext,
  limit: LimitKey,
  count = 1,
): Promise<void> {
  const plan = await getPlan(ctx)
  const allowed = plan.limits[limit]

  if (!Number.isFinite(allowed)) return

  // Phase 7 reads the real usage here — from `workspace_usage` for
  // storageBytes (maintained incrementally, because walking a bucket after
  // the fact is prohibitive) and a COUNT(*) for everything else, which is
  // cheap enough not to bother precomputing.
  const used = 0

  if (used + count > allowed) {
    throw new PlanLimitExceededError(limit, allowed)
  }
}
