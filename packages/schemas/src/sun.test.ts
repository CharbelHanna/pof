import { describe, expect, it } from 'vitest'

import { overlaps, sunReport } from './sun.ts'

/**
 * Sun times are the reason coordinates are stored rather than addresses, so
 * these check against places and dates with known, checkable answers rather
 * than against whatever the library happens to return.
 */

// Glen Coe, Scotland — the landscape case that motivated the feature.
const GLEN_COE = { lat: 56.6667, lon: -5.1 }

describe('sunReport', () => {
  it('puts midsummer sunrise in Glen Coe just after 03:30 UTC', () => {
    const report = sunReport(new Date('2027-06-21T12:00:00Z'), GLEN_COE.lat, GLEN_COE.lon)

    expect(report.polar).toBeNull()
    expect(report.times).not.toBeNull()

    const hour = report.times!.sunrise.getUTCHours()
    // Scotland in late June: sunrise is around 03:25–03:40 UTC.
    expect(hour).toBe(3)
  })

  it('orders the day correctly', () => {
    const { times } = sunReport(new Date('2027-06-21T12:00:00Z'), GLEN_COE.lat, GLEN_COE.lon)

    expect(times).not.toBeNull()
    const t = times!
    expect(t.dawn.getTime()).toBeLessThan(t.sunrise.getTime())
    expect(t.sunrise.getTime()).toBeLessThan(t.goldenHourEnd.getTime())
    expect(t.goldenHourEnd.getTime()).toBeLessThan(t.solarNoon.getTime())
    expect(t.solarNoon.getTime()).toBeLessThan(t.goldenHourStart.getTime())
    expect(t.goldenHourStart.getTime()).toBeLessThan(t.sunset.getTime())
    expect(t.sunset.getTime()).toBeLessThan(t.dusk.getTime())
  })

  it('gives a much shorter day at midwinter', () => {
    const summer = sunReport(new Date('2027-06-21T12:00:00Z'), GLEN_COE.lat, GLEN_COE.lon)
    const winter = sunReport(new Date('2027-12-21T12:00:00Z'), GLEN_COE.lat, GLEN_COE.lon)

    const length = (r: typeof summer) => r.times!.sunset.getTime() - r.times!.sunrise.getTime()

    // Roughly 17.5 hours in June against 6.5 in December at this latitude.
    expect(length(summer)).toBeGreaterThan(length(winter) * 2)
  })

  it('reports windows that bracket sunrise and sunset', () => {
    const { windows, times } = sunReport(
      new Date('2027-06-21T12:00:00Z'),
      GLEN_COE.lat,
      GLEN_COE.lon,
    )

    expect(windows!.blueHourMorning.to.getTime()).toBe(times!.sunrise.getTime())
    expect(windows!.goldenHourMorning.from.getTime()).toBe(times!.sunrise.getTime())
    expect(windows!.goldenHourEvening.to.getTime()).toBe(times!.sunset.getTime())
    expect(windows!.blueHourEvening.from.getTime()).toBe(times!.sunset.getTime())
  })

  describe('inside the polar circles', () => {
    // Tromsø — "golden hour in June" there is a real plan with no sunrise.
    const TROMSO = { lat: 69.6496, lon: 18.956 }

    it('reports midnight sun rather than null timestamps', () => {
      const report = sunReport(new Date('2027-06-21T12:00:00Z'), TROMSO.lat, TROMSO.lon)

      expect(report.polar).toBe('midnight-sun')
      expect(report.times).toBeNull()
    })

    it('reports polar night in midwinter', () => {
      const report = sunReport(new Date('2027-12-21T12:00:00Z'), TROMSO.lat, TROMSO.lon)

      expect(report.polar).toBe('polar-night')
      expect(report.times).toBeNull()
    })
  })

  it('differs by longitude on the same date', () => {
    const scotland = sunReport(new Date('2027-06-21T12:00:00Z'), GLEN_COE.lat, GLEN_COE.lon)
    // Same latitude, far to the east — sunrise comes earlier in absolute time.
    const east = sunReport(new Date('2027-06-21T12:00:00Z'), GLEN_COE.lat, 20)

    expect(east.times!.sunrise.getTime()).toBeLessThan(scotland.times!.sunrise.getTime())
  })
})

describe('overlaps', () => {
  const window = { from: new Date('2027-06-21T03:30:00Z'), to: new Date('2027-06-21T04:30:00Z') }

  it('detects a session sitting inside the window', () => {
    expect(
      overlaps(
        { from: new Date('2027-06-21T03:45:00Z'), to: new Date('2027-06-21T04:00:00Z') },
        window,
      ),
    ).toBe(true)
  })

  it('detects a session straddling the start', () => {
    expect(
      overlaps(
        { from: new Date('2027-06-21T03:00:00Z'), to: new Date('2027-06-21T03:45:00Z') },
        window,
      ),
    ).toBe(true)
  })

  it('rejects a session that ends before the window opens', () => {
    expect(
      overlaps(
        { from: new Date('2027-06-21T02:00:00Z'), to: new Date('2027-06-21T03:30:00Z') },
        window,
      ),
    ).toBe(false)
  })

  it('rejects a session starting exactly when the window closes', () => {
    // Touching is not overlapping — a session beginning as golden hour ends
    // did not catch it.
    expect(
      overlaps(
        { from: new Date('2027-06-21T04:30:00Z'), to: new Date('2027-06-21T05:00:00Z') },
        window,
      ),
    ).toBe(false)
  })
})
