import type { GeocodingPort, JobQueuePort, StoragePort } from '@pof/core/ports'
import type { Database, TenantContext } from '@pof/db'

/**
 * What every procedure receives.
 *
 * `session` is the result of a SERVER-SIDE lookup performed per request — the
 * caller never supplies it. In particular the workspace is resolved by
 * checking the `member` table, not by reading `session.activeOrganizationId`,
 * which the client controls and which must be treated as a request rather
 * than a fact. Trusting it is the easiest cross-tenant read to introduce.
 */
export interface ApiContext {
  db: Database
  session: AuthenticatedSession | null
  /**
   * Optional: place search degrades to "unavailable" rather than breaking
   * the app when no provider is configured. Everything else about locations,
   * including sun times, works without it.
   */
  geocoding?: GeocodingPort | undefined
  /**
   * Optional for the same reason, but the consequence differs: without it
   * uploads cannot be offered at all, rather than degrading. Procedures that
   * need it say so explicitly instead of assuming it is there, so a
   * misconfigured deployment fails on the upload endpoint with a clear
   * message rather than throwing on a null somewhere further in.
   */
  storage?: StoragePort | undefined
  /**
   * Optional, and the upload path tolerates its absence: the asset stays
   * `uploaded` and can be processed later. A queue outage should mean a
   * late thumbnail, not a refused upload.
   */
  jobs?: JobQueuePort | undefined
}

export interface AuthenticatedSession {
  userId: string
  /** Verified against `member` for this user. */
  workspaceId: string
}

/** Context available to procedures that require authentication. */
export interface AuthedContext extends ApiContext {
  session: AuthenticatedSession
  tenant: TenantContext
}
