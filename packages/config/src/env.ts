import { z } from 'zod'

/**
 * Server-side environment configuration.
 *
 * This is the ONLY place platform configuration enters the application. No
 * secret-manager SDK, no `process.env` reads scattered through modules — every
 * host (local compose, Railway, Fly, Hetzner, Azure, ECS) supplies plain
 * environment variables and this file validates them once, at boot.
 *
 * Importing this module from browser code is a bug: it reads `process.env` and
 * would leak secrets into the client bundle. `@pof/config/env/client` is the
 * browser-safe counterpart.
 */

/**
 * An optional URL that tolerates an empty string.
 *
 * Templating systems routinely expand an unset variable to "" rather than
 * omitting it — `${VAR:-}` in docker-compose is the obvious case. A plain
 * `.optional()` rejects that, so a variable nobody set takes the whole
 * application down at boot. Treat empty as absent, which is what it means.
 */
const optionalUrl = () =>
  z
    .union([z.literal(''), z.url()])
    .optional()
    .transform((value) => (value === '' ? undefined : value))

const nonEmpty = (label: string) => z.string().min(1, `${label} must not be empty`)

const serverSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),

    /**
     * Plain Postgres connection string over TCP. Deliberately not a
     * provider-specific driver URL — the same value works against a local
     * `postgres:18-alpine` container, Neon, Supabase, RDS or Azure Database for
     * PostgreSQL with no code change.
     *
     * Must point at the unprivileged `app_user` role, NOT the migration owner.
     * RLS is silently bypassed for table owners and superusers, so connecting
     * as the owner would disable tenant isolation without any visible error.
     * The tenant-isolation suite asserts this.
     */
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),

    /** Separate, higher-privilege URL used only by `pnpm db:migrate`. */
    DATABASE_MIGRATION_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),

    /** Public origin of the app, used for auth callbacks and absolute links. */
    APP_URL: z.url(),

    /**
     * Better Auth signing secret. 32+ bytes of randomness:
     *   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
     */
    BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),

    // ---------------------------------------------------------------------
    // Object storage (S3-compatible). Works against MinIO, Cloudflare R2, AWS
    // S3, Backblaze B2 or Hetzner by changing these values only. See
    // packages/core/src/ports/storage.ts for why the port is intent-shaped.
    // ---------------------------------------------------------------------
    STORAGE_ENDPOINT: optionalUrl(),
    STORAGE_REGION: z.string().default('auto'),
    STORAGE_BUCKET: nonEmpty('STORAGE_BUCKET'),
    STORAGE_ACCESS_KEY_ID: nonEmpty('STORAGE_ACCESS_KEY_ID'),
    STORAGE_SECRET_ACCESS_KEY: nonEmpty('STORAGE_SECRET_ACCESS_KEY'),
    /** MinIO requires path-style addressing; R2 and S3 do not. */
    STORAGE_FORCE_PATH_STYLE: z.stringbool().default(false),
    /** CDN or public origin that serves processed derivatives. */
    STORAGE_PUBLIC_URL: optionalUrl(),

    // ---------------------------------------------------------------------
    // Mail. SMTP is the self-host escape hatch and the local-dev default.
    // ---------------------------------------------------------------------
    MAIL_PROVIDER: z.enum(['smtp', 'resend', 'console']).default('console'),
    MAIL_FROM: z.email().default('noreply@pof.local'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),

    // ---------------------------------------------------------------------
    // Geocoding. Every freely available provider carries a usage policy
    // rather than a licence, so the choice is configuration — see
    // packages/core/src/ports/geocoding.ts.
    // ---------------------------------------------------------------------
    GEOCODING_PROVIDER: z.enum(['photon', 'nominatim', 'none']).default('photon'),
    /** Point at a self-hosted instance, which is what production should use. */
    GEOCODING_BASE_URL: optionalUrl(),

    SENTRY_DSN: optionalUrl(),
  })
  /**
   * Cross-field rules. Catching these at boot beats discovering at 2am that
   * the mail provider was configured but unusable.
   */
  .superRefine((env, ctx) => {
    if (env.MAIL_PROVIDER === 'smtp' && !env.SMTP_HOST) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message: 'SMTP_HOST is required when MAIL_PROVIDER is "smtp"',
      })
    }
    if (env.MAIL_PROVIDER === 'resend' && !env.RESEND_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'RESEND_API_KEY is required when MAIL_PROVIDER is "resend"',
      })
    }
    /**
     * A deployed app must never silently discard mail. But NODE_ENV alone is
     * the wrong test: `next start` and any locally-run production build set
     * it, and refusing to boot then would make it impossible to exercise a
     * production build on a laptop — which is exactly when you want to.
     *
     * Keying off the public origin instead keeps the real protection (a
     * reachable deployment cannot drop password-reset emails on the floor)
     * without blocking local verification.
     */
    const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(env.APP_URL)

    if (env.NODE_ENV === 'production' && env.MAIL_PROVIDER === 'console' && !isLocalOrigin) {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_PROVIDER'],
        message:
          'MAIL_PROVIDER "console" discards mail and is not allowed for a deployed app. ' +
          'Set MAIL_PROVIDER=smtp or resend.',
      })
    }
  })

export type ServerEnv = z.infer<typeof serverSchema>

/**
 * Parse and validate. Throws a single readable error listing every problem,
 * rather than failing one variable at a time across several restarts.
 */
export function parseServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const result = serverSchema.safeParse(source)

  if (!result.success) {
    const lines = result.error.issues.map((issue) => {
      const key = issue.path.join('.') || '(root)'
      return `  - ${key}: ${issue.message}`
    })
    throw new Error(
      `Invalid environment configuration:\n${lines.join('\n')}\n\n` +
        `See .env.example for the full list of variables.`,
    )
  }

  return result.data
}

let cached: ServerEnv | undefined

/**
 * Validated server env, parsed once per process.
 *
 * Lazy rather than module-level so that importing a type from this package
 * does not blow up tooling (lint, codegen) that runs without a full env.
 */
export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv()
  return cached
}

/** Test-only: drop the memoised value so a suite can vary the environment. */
export function resetServerEnvCache(): void {
  cached = undefined
}
