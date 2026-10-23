import { describe, expect, it } from 'vitest'

import { newId } from './id.ts'
import { createShootSchema, listShootsSchema, shootTypeKeySchema, updateShootSchema } from './shoot.ts'

describe('newId', () => {
  it('produces a valid v7 uuid', () => {
    const id = newId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('is time-ordered, which is the reason for v7 over v4', () => {
    // Lexical order must track creation order — that is what keeps inserts at
    // the right-hand edge of the B-tree instead of scattering.
    const ids = Array.from({ length: 50 }, () => newId())
    expect([...ids].sort()).toEqual(ids)
  })

  it('does not collide across rapid successive calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId()))
    expect(ids.size).toBe(1000)
  })
})

describe('createShootSchema', () => {
  it('requires a name and applies defaults', () => {
    const parsed = createShootSchema.parse({ name: 'Autumn editorial' })

    expect(parsed.name).toBe('Autumn editorial')
    expect(parsed.shootTypeKey).toBe('portrait')
    expect(parsed.status).toBe('draft')
  })

  it('trims the name and rejects a blank one', () => {
    expect(createShootSchema.parse({ name: '  Spaced  ' }).name).toBe('Spaced')
    expect(() => createShootSchema.parse({ name: '   ' })).toThrow()
  })

  it('accepts a client-supplied id so offline creates can be idempotent', () => {
    const id = newId()
    expect(createShootSchema.parse({ id, name: 'Offline shoot' }).id).toBe(id)
  })

  it('rejects an id that is not a uuid', () => {
    expect(() => createShootSchema.parse({ id: 'not-a-uuid', name: 'x' })).toThrow()
  })
})

describe('shootTypeKeySchema', () => {
  it('accepts lowercase kebab-case keys', () => {
    for (const key of ['portrait', 'editorial', 'landscape', 'product', 'food-product']) {
      expect(shootTypeKeySchema.parse(key)).toBe(key)
    }
  })

  it('rejects keys that would not survive a URL or a seed file', () => {
    for (const key of ['Portrait', 'with space', 'with_underscore', '']) {
      expect(() => shootTypeKeySchema.parse(key)).toThrow()
    }
  })
})

describe('updateShootSchema', () => {
  it('requires an id but leaves every other field optional', () => {
    const id = newId()
    expect(updateShootSchema.parse({ id })).toEqual({ id })
    expect(updateShootSchema.parse({ id, name: 'Renamed' }).name).toBe('Renamed')
  })

  it('allows notes to be explicitly cleared', () => {
    // `nullable` not just `optional`: omitting means "leave alone", null means
    // "clear it". Collapsing the two would make notes unclearable.
    const parsed = updateShootSchema.parse({ id: newId(), notes: null })
    expect(parsed.notes).toBeNull()
  })
})

describe('listShootsSchema', () => {
  it('defaults to a bounded page and excludes tombstones', () => {
    const parsed = listShootsSchema.parse({})
    expect(parsed.limit).toBe(50)
    expect(parsed.includeDeleted).toBe(false)
  })

  it('caps the page size so a client cannot ask for the whole table', () => {
    expect(() => listShootsSchema.parse({ limit: 500 })).toThrow()
  })

  it('coerces updatedSince from an ISO string, as a query string would supply', () => {
    const parsed = listShootsSchema.parse({ updatedSince: '2026-10-01T00:00:00.000Z' })
    expect(parsed.updatedSince).toBeInstanceOf(Date)
    expect(parsed.updatedSince?.toISOString()).toBe('2026-10-01T00:00:00.000Z')
  })
})
