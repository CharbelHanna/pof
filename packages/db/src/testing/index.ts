import { inject } from 'vitest'

export { tenantSeeds } from './seeds.ts'

/**
 * Connection URLs for the Postgres that `global-setup.ts` started.
 *
 * Exposed as a function rather than by augmenting Vitest's `ProvidedContext`
 * interface. A `declare module 'vitest'` augmentation only applies to programs
 * that actually include the declaring file, and consuming packages reference
 * global-setup.ts as a Vitest config *string* — so they never import it, and
 * `inject('appUrl')` fails to typecheck for them. Cross-package augmentation
 * also resolves inconsistently depending on where `vitest` sits in the pnpm
 * store.
 *
 * One narrow cast here, explained, beats that fragility spread across every
 * package that wants a database test.
 */
export function testDatabaseUrls(): { appUrl: string; ownerUrl: string } {
  return {
    /** pof_app — unprivileged, RLS applies. What the application uses. */
    appUrl: inject('appUrl' as never) as unknown as string,
    /** pof_owner — schema owner. Migrations and fixture setup only. */
    ownerUrl: inject('ownerUrl' as never) as unknown as string,
  }
}
