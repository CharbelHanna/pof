export { tenantSeeds } from './seeds.ts'

/**
 * Types for the values `global-setup.ts` hands to suites via `provide()`.
 *
 * Declared here rather than in global-setup.ts because other packages wire
 * that file in through a Vitest config string and never import it — so the
 * augmentation would not be part of their program and `inject('appUrl')`
 * would not typecheck. Importing '@pof/db/testing' in a suite brings these in.
 */
declare module 'vitest' {
  interface ProvidedContext {
    /** Connects as pof_app — unprivileged, RLS applies. What the app uses. */
    appUrl: string
    /** Connects as pof_owner — schema owner. Migrations and setup only. */
    ownerUrl: string
  }
}
