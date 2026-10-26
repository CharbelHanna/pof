import { describe, expect, it } from 'vitest'

import { formatSessionTime, localInputValue, toInstant } from './time.ts'

/**
 * Timezone handling is the part of session scheduling most likely to be
 * subtly wrong, and wrong here means a photographer misses first light.
 * These tests use real DST transitions rather than invented ones.
 */

describe('toInstant', () => {
  it('treats a UTC wall clock as itself', () => {
    expect(toInstant('2027-01-15T09:00', 'UTC').toISOString()).toBe('2027-01-15T09:00:00.000Z')
  })

  it('applies a winter offset', () => {
    // London in January is UTC+0.
    expect(toInstant('2027-01-15T09:00', 'Europe/London').toISOString()).toBe(
      '2027-01-15T09:00:00.000Z',
    )
  })

  it('applies a summer offset', () => {
    // London in June is UTC+1, so 06:00 local is 05:00Z. Getting this wrong
    // is a sunrise call missed by an hour.
    expect(toInstant('2027-06-21T06:00', 'Europe/London').toISOString()).toBe(
      '2027-06-21T05:00:00.000Z',
    )
  })

  it('handles a zone behind UTC', () => {
    // New York in June is UTC-4.
    expect(toInstant('2027-06-21T06:00', 'America/New_York').toISOString()).toBe(
      '2027-06-21T10:00:00.000Z',
    )
  })

  it('handles a half-hour offset', () => {
    // Kolkata is UTC+5:30 year round — catches code that assumes whole hours.
    expect(toInstant('2027-06-21T06:00', 'Asia/Kolkata').toISOString()).toBe(
      '2027-06-21T00:30:00.000Z',
    )
  })

  it('handles a southern-hemisphere zone whose DST runs the other way', () => {
    // Sydney in June is winter: UTC+10, not +11.
    expect(toInstant('2027-06-21T06:00', 'Australia/Sydney').toISOString()).toBe(
      '2027-06-20T20:00:00.000Z',
    )
  })

  describe('around a DST transition', () => {
    // UK clocks go forward at 01:00 UTC on 2027-03-28.
    it('resolves a time just before the change', () => {
      expect(toInstant('2027-03-28T00:30', 'Europe/London').toISOString()).toBe(
        '2027-03-28T00:30:00.000Z',
      )
    })

    it('resolves a time just after the change', () => {
      // 02:30 local is 01:30Z once the clocks have gone forward. This is the
      // case the single-pass offset calculation gets wrong.
      expect(toInstant('2027-03-28T02:30', 'Europe/London').toISOString()).toBe(
        '2027-03-28T01:30:00.000Z',
      )
    })

    it('resolves a time after clocks go back', () => {
      // UK clocks go back at 02:00 BST on 2027-10-31.
      expect(toInstant('2027-10-31T03:00', 'Europe/London').toISOString()).toBe(
        '2027-10-31T03:00:00.000Z',
      )
    })
  })

  it('round-trips through localInputValue', () => {
    for (const zone of ['UTC', 'Europe/London', 'America/New_York', 'Asia/Kolkata']) {
      for (const local of ['2027-01-15T09:00', '2027-06-21T06:00', '2027-11-02T23:45']) {
        expect(localInputValue(toInstant(local, zone), zone), `${zone} ${local}`).toBe(local)
      }
    }
  })
})

describe('localInputValue', () => {
  it('renders an instant in the session zone, not the viewer zone', () => {
    expect(localInputValue(new Date('2027-06-21T05:00:00.000Z'), 'Europe/London')).toBe(
      '2027-06-21T06:00',
    )
  })

  it('renders midnight as 00, not 24', () => {
    // Some engines format midnight as hour 24 with hour12:false, which would
    // produce an invalid datetime-local value.
    expect(localInputValue(new Date('2027-06-21T00:00:00.000Z'), 'UTC')).toBe('2027-06-21T00:00')
  })

  it('accepts an ISO string, as the API returns', () => {
    expect(localInputValue('2027-06-21T05:00:00.000Z', 'Europe/London')).toBe('2027-06-21T06:00')
  })
})

describe('formatSessionTime', () => {
  it('shows the time in the session zone with the zone named', () => {
    const formatted = formatSessionTime(
      '2027-06-21T05:00:00.000Z',
      '2027-06-21T07:00:00.000Z',
      'Europe/London',
    )

    // 05:00Z–07:00Z is 06:00–08:00 in London in June.
    expect(formatted).toContain('06:00')
    expect(formatted).toContain('08:00')
    // The zone must be visible: a photographer planning from abroad has to
    // see that 06:00 is local to the shoot, not to them.
    expect(formatted).toMatch(/BST|GMT\+1/)
  })

  it('uses the session zone even for a far-away shoot', () => {
    const formatted = formatSessionTime(
      '2027-06-21T10:00:00.000Z',
      '2027-06-21T12:00:00.000Z',
      'America/New_York',
    )

    expect(formatted).toContain('06:00')
  })
})
