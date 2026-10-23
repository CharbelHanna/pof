import { describe, expect, it } from 'vitest'
import { parseServerEnv } from './env'

/**
 * These tests do double duty: they check our cross-field rules, and they pin
 * the Zod 4 APIs this file relies on (`z.url({ protocol })`, `z.stringbool()`,
 * `z.email()`), so a dependency bump that changes their behaviour fails here
 * rather than at container start.
 */

const valid = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://app_user:pw@localhost:5432/pof',
  APP_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  STORAGE_BUCKET: 'pof-assets',
  STORAGE_ACCESS_KEY_ID: 'minioadmin',
  STORAGE_SECRET_ACCESS_KEY: 'minioadmin',
} satisfies NodeJS.ProcessEnv

describe('parseServerEnv', () => {
  it('accepts a minimal valid environment and applies defaults', () => {
    const env = parseServerEnv(valid)

    expect(env.NODE_ENV).toBe('development')
    expect(env.LOG_LEVEL).toBe('info')
    expect(env.STORAGE_REGION).toBe('auto')
    expect(env.MAIL_PROVIDER).toBe('console')
    expect(env.STORAGE_FORCE_PATH_STYLE).toBe(false)
  })

  it('accepts both postgres:// and postgresql:// schemes', () => {
    expect(parseServerEnv({ ...valid, DATABASE_URL: 'postgres://u:p@h:5432/d' })).toBeTruthy()
    expect(parseServerEnv({ ...valid, DATABASE_URL: 'postgresql://u:p@h:5432/d' })).toBeTruthy()
  })

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => parseServerEnv({ ...valid, DATABASE_URL: 'mysql://u:p@h:3306/d' })).toThrow(
      /DATABASE_URL/,
    )
  })

  it('coerces STORAGE_FORCE_PATH_STYLE from a string', () => {
    expect(parseServerEnv({ ...valid, STORAGE_FORCE_PATH_STYLE: 'true' }).STORAGE_FORCE_PATH_STYLE)
      .toBe(true)
    expect(parseServerEnv({ ...valid, STORAGE_FORCE_PATH_STYLE: 'false' }).STORAGE_FORCE_PATH_STYLE)
      .toBe(false)
  })

  it('rejects a short BETTER_AUTH_SECRET', () => {
    expect(() => parseServerEnv({ ...valid, BETTER_AUTH_SECRET: 'too-short' })).toThrow(
      /BETTER_AUTH_SECRET/,
    )
  })

  it('reports every problem at once rather than one per restart', () => {
    let message = ''
    try {
      parseServerEnv({ NODE_ENV: 'development' })
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).toContain('DATABASE_URL')
    expect(message).toContain('APP_URL')
    expect(message).toContain('BETTER_AUTH_SECRET')
    expect(message).toContain('STORAGE_BUCKET')
  })

  it('requires SMTP_HOST when the mail provider is smtp', () => {
    expect(() => parseServerEnv({ ...valid, MAIL_PROVIDER: 'smtp' })).toThrow(/SMTP_HOST/)
    expect(parseServerEnv({ ...valid, MAIL_PROVIDER: 'smtp', SMTP_HOST: 'localhost' })).toBeTruthy()
  })

  it('requires RESEND_API_KEY when the mail provider is resend', () => {
    expect(() => parseServerEnv({ ...valid, MAIL_PROVIDER: 'resend' })).toThrow(/RESEND_API_KEY/)
  })

  it('refuses to discard mail in production', () => {
    expect(() =>
      parseServerEnv({ ...valid, NODE_ENV: 'production', MAIL_PROVIDER: 'console' }),
    ).toThrow(/MAIL_PROVIDER/)
  })
})
