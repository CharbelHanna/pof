import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

/**
 * Better Auth tables — core plus the `organization` plugin.
 *
 * Transcribed from better-auth@1.7.12's own table definitions
 * (`@better-auth/core/dist/db/get-tables.mjs` and
 * `better-auth/dist/plugins/organization/organization.mjs`), not from docs.
 * The property keys MUST match Better Auth's field names exactly — the Drizzle
 * adapter maps model fields to these keys. Column names may be snake_case;
 * property keys may not be renamed.
 *
 * ---------------------------------------------------------------------------
 * These tables are deliberately NOT tenant-scoped and have no RLS policy.
 * ---------------------------------------------------------------------------
 * Better Auth has to resolve a session token, a user's email, or the set of
 * organizations a user belongs to *before* any workspace context exists. A
 * tenant policy on these tables would make login itself impossible. Tenant
 * isolation begins at the domain tables (see ./domain/), every one of which is
 * workspace-scoped and RLS-forced.
 *
 * `organization` is our Workspace. There is no parallel workspace concept to
 * keep in sync — the tenancy root and the auth org are the same row.
 */

export const user = pgTable('user', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})

export const organization = pgTable(
  'organization',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    logo: text('logo'),
    metadata: text('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('organization_slug_idx').on(table.slug)],
)

export const session = pgTable(
  'session',
  {
    id: uuid('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    token: text('token').notNull().unique(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /**
     * Added by the organization plugin. Treated as a *request*, never a fact:
     * `buildTenantContext` re-resolves membership server-side on every request
     * rather than trusting this value. See packages/core identity module.
     */
    activeOrganizationId: uuid('active_organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('session_user_id_idx').on(table.userId)],
)

export const account = pgTable(
  'account',
  {
    id: uuid('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
      mode: 'date',
    }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      withTimezone: true,
      mode: 'date',
    }),
    scope: text('scope'),
    /** Hashed by Better Auth (scrypt). Never returned to clients. */
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('account_user_id_idx').on(table.userId)],
)

export const verification = pgTable(
  'verification',
  {
    id: uuid('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
)

export const member = pgTable(
  'member',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('member_organization_id_idx').on(table.organizationId),
    index('member_user_id_idx').on(table.userId),
    /**
     * A user belongs to a workspace once. Better Auth does not declare this,
     * but every read treats membership as singular — `findWorkspaceForUser`
     * takes the first row — so a duplicate would make "which workspace?"
     * depend on row order.
     *
     * It is also the database-level backstop for lazy provisioning: that path
     * serialises on an advisory lock, and this makes a second membership
     * impossible even if some future caller forgets to.
     */
    uniqueIndex('member_organization_id_user_id_key').on(table.organizationId, table.userId),
  ],
)

export const invitation = pgTable(
  'invitation',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role'),
    status: text('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    inviterId: uuid('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('invitation_organization_id_idx').on(table.organizationId),
    index('invitation_email_idx').on(table.email),
  ],
)

/** Every table Better Auth owns. The tenant-isolation suite skips these. */
export const authTables = {
  user,
  session,
  account,
  verification,
  organization,
  member,
  invitation,
} as const

export const authTableNames = [
  'user',
  'session',
  'account',
  'verification',
  'organization',
  'member',
  'invitation',
] as const
