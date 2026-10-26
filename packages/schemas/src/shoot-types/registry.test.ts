import { describe, expect, it } from 'vitest'

import type { FieldSpec } from './fields.ts'

import {
  SYSTEM_SHOOT_TYPES,
  SYSTEM_SHOOT_TYPE_KEYS,
  currentDetailsVersion,
  getShootTypeDefinition,
  parseShootDetails,
  safeParseShootDetails,
} from './registry.ts'

describe('registry integrity', () => {
  it.each(SYSTEM_SHOOT_TYPE_KEYS)('%s is internally consistent', (key) => {
    const definition = SYSTEM_SHOOT_TYPES[key]

    expect(definition.key).toBe(key)
    expect(definition.label).not.toBe('')
    expect(definition.version).toBeGreaterThanOrEqual(1)
    expect(definition.fields.length).toBeGreaterThan(0)
  })

  it.each(SYSTEM_SHOOT_TYPE_KEYS)('%s: every field exists in its schema', (key) => {
    const definition = SYSTEM_SHOOT_TYPES[key]

    // The whole point of co-locating schema and field metadata is that they
    // cannot drift. A field the schema strips would render but never save —
    // the most confusing possible failure, because the form looks fine.
    for (const field of definition.fields) {
      const probe = { [field.name]: sampleFor(field) }
      const parsed = definition.detailsSchema.parse(probe)

      expect(Object.keys(parsed), `${key}.${field.name}`).toContain(field.name)
    }
  })

  it.each(SYSTEM_SHOOT_TYPE_KEYS)('%s: select fields declare options', (key) => {
    for (const field of SYSTEM_SHOOT_TYPES[key].fields) {
      if (field.widget === 'select') {
        expect(field.options, `${key}.${field.name}`).toBeDefined()
        expect(field.options!.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('parseShootDetails', () => {
  it('accepts a valid payload for a known genre', () => {
    const parsed = parseShootDetails('editorial', {
      publication: 'Vogue Italia',
      lookCount: 3,
    })

    expect(parsed).toEqual({ publication: 'Vogue Italia', lookCount: 3 })
  })

  it('treats a missing payload as empty rather than an error', () => {
    // Most shoots never fill in genre fields; demanding `{}` everywhere is
    // noise the caller should not have to think about.
    expect(parseShootDetails('portrait', undefined)).toEqual({})
    expect(parseShootDetails('portrait', null)).toEqual({})
  })

  it('rejects a value that breaks the genre schema', () => {
    expect(() => parseShootDetails('portrait', { subjectCount: -5 })).toThrow()
    expect(() => parseShootDetails('product', { surfaceFinish: 'holographic' })).toThrow()
  })

  it('strips fields the genre does not define', () => {
    // Zod objects are strip-by-default. Worth pinning: it is what stops one
    // genre's leftovers accumulating in another genre's rows after a type
    // change.
    const parsed = parseShootDetails('portrait', { subjectCount: 2, publication: 'Wired' })

    expect(parsed).toEqual({ subjectCount: 2 })
  })

  describe('an unknown genre', () => {
    it('keeps a flat payload intact', () => {
      // A workspace-defined type, or a row written by a newer deploy.
      // Rejecting would make the shoot uneditable.
      const parsed = parseShootDetails('wedding', { ceremonyTime: '14:00', guests: 120 })

      expect(parsed).toEqual({ ceremonyTime: '14:00', guests: 120 })
    })

    it('refuses nested objects', () => {
      expect(() => parseShootDetails('wedding', { venue: { name: 'Hall' } })).toThrow()
    })

    it('refuses an unreasonable number of fields', () => {
      const tooMany = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`field${i}`, 'x']))

      expect(() => parseShootDetails('wedding', tooMany)).toThrow()
    })
  })
})

describe('safeParseShootDetails', () => {
  it('returns empty rather than throwing when a row cannot be parsed', () => {
    // A row written under an older schema version must stay viewable. A read
    // never writes back, so nothing is destroyed by showing less.
    expect(safeParseShootDetails('portrait', { subjectCount: 'three' })).toEqual({})
  })

  it('still returns valid data untouched', () => {
    expect(safeParseShootDetails('portrait', { subjectCount: 3 })).toEqual({ subjectCount: 3 })
  })
})

describe('currentDetailsVersion', () => {
  it('reports the version for a known genre', () => {
    expect(currentDetailsVersion('portrait')).toBe(SYSTEM_SHOOT_TYPES.portrait.version)
  })

  it('defaults to 1 for an unknown genre', () => {
    expect(currentDetailsVersion('wedding')).toBe(1)
  })
})

describe('getShootTypeDefinition', () => {
  it('returns undefined for an unknown key rather than throwing', () => {
    expect(getShootTypeDefinition('nope')).toBeUndefined()
  })
})

/** A value the given widget could plausibly produce. */
function sampleFor(field: FieldSpec): unknown {
  switch (field.widget) {
    case 'number':
      return 1
    case 'toggle':
      return true
    case 'date':
      return '2026-10-26'
    case 'select':
      // Must be a real option, or the enum rejects it and the probe would
      // fail for the wrong reason.
      return field.options?.[0]?.value
    default:
      return 'sample'
  }
}
