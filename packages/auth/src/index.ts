import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins'

import { newId } from '@pof/schemas'
import { schema, type Database } from '@pof/db'

/**
 * Better Auth server instance.
 *
 * Self-hosted deliberately. Clerk and Supabase Auth would put the user table,
 * the organization/membership model — and therefore the tenancy root — in
 * someone else's database behind a per-MAU bill. Because every domain row is
 * keyed by `workspace_id` referencing `organization.id`, migrating off a
 * hosted identity provider later would mean re-keying the entire schema. That
 * is the most expensive migration this application could ever face, so it is
 * foreclosed on day one.
 *
 * The `organization` plugin IS our workspace model: organization, member and
 * invitation tables, roles and `hasPermission` come for free. V1 hides the
 * teams UI and provisions exactly one organization per user, but the data
 * model is multi-tenant from the first migration — so adding studios later is
 * a UI change, not a data migration.
 */
export function createAuth(options: {
  db: Database
  secret: string
  baseURL: string
  trustedOrigins?: string[]
}) {
  return betterAuth({
    secret: options.secret,
    baseURL: options.baseURL,
    trustedOrigins: options.trustedOrigins ?? [],

    database: drizzleAdapter(options.db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        organization: schema.organization,
        member: schema.member,
        invitation: schema.invitation,
      },
    }),

    emailAndPassword: {
      enabled: true,
      // Phase 0 keeps signup frictionless. Phase 7 turns verification on as
      // part of hardening, once transactional mail is wired to a real provider.
      requireEmailVerification: false,
      minPasswordLength: 12,
    },

    advanced: {
      database: {
        /**
         * Better Auth defaults to its own string ids. We override to UUIDv7 so
         * that auth ids are the same type as every domain id — `workspace_id`
         * is a `uuid` column referencing `organization.id`, and a text id
         * would force either a cast on every join or a second id scheme.
         */
        generateId: () => newId(),
      },
    },

    plugins: [
      organization({
        /**
         * One workspace per user in V1. The limit is a product decision, not a
         * schema one — raising it later is a config change.
         */
        organizationLimit: 1,
        creatorRole: 'owner',
      }),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
export type Session = Auth['$Infer']['Session']
