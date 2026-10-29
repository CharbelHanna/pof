// Namespace import, not default: suncalc is CommonJS and assigns its
// functions onto module.exports, so the interop default is undefined here.
import * as SunCalc from 'suncalc'

/**
 * Sun times for a place and a day.
 *
 * Computed locally — no API, no key, no rate limit, works offline, and
 * accurate to roughly fifteen seconds. This is why coordinates had to be
 * resolved at entry rather than stored as free text: once a location has
 * latitude and longitude, the light is arithmetic.
 *
 * Deliberately in `@pof/schemas` so it is shared with the Expo app later and
 * can be unit-tested without a database or a network.
 */

export interface SunTimes {
  dawn: Date
  sunrise: Date
  /** Morning golden hour runs from sunrise to here. */
  goldenHourEnd: Date
  solarNoon: Date
  /** Evening golden hour starts here and runs to sunset. */
  goldenHourStart: Date
  sunset: Date
  dusk: Date
}

/**
 * Blue hour is not a SunCalc output; it is the window between civil dusk and
 * the sun reaching roughly -6°, which SunCalc exposes as `dusk`/`dawn`
 * relative to sunset/sunrise. Modelled as the stretch either side of the
 * golden hour, which is how photographers actually talk about it.
 */
export interface LightWindows {
  /** Before sunrise: the cool, even light. */
  blueHourMorning: { from: Date; to: Date }
  goldenHourMorning: { from: Date; to: Date }
  goldenHourEvening: { from: Date; to: Date }
  blueHourEvening: { from: Date; to: Date }
}

export interface SunReport {
  times: SunTimes | null
  windows: LightWindows | null
  /**
   * True inside the polar circles when the sun never rises or never sets.
   * SunCalc returns Invalid Date rather than throwing, which would otherwise
   * propagate as `null` timestamps and look like a bug.
   */
  polar: 'midnight-sun' | 'polar-night' | null
}

function isValid(date: Date | null | undefined): date is Date {
  return date instanceof Date && !Number.isNaN(date.getTime())
}

/**
 * Sun times for a coordinate on the day of `instant`.
 *
 * `instant` is an absolute moment; SunCalc resolves the solar day containing
 * it, so passing a session's start time gives that session's light.
 */
export function sunReport(instant: Date, latitude: number, longitude: number): SunReport {
  const times = SunCalc.getTimes(instant, latitude, longitude)

  const sunrise = times.sunrise
  const sunset = times.sunset

  if (!isValid(sunrise) || !isValid(sunset)) {
    /**
     * Above the Arctic or below the Antarctic circle the sun may not cross
     * the horizon at all. Which case it is depends on the solar altitude at
     * local noon — and this matters for exactly the shoots that care most,
     * since "golden hour in Tromsø in June" is a real plan with no sunrise
     * in it.
     */
    const noonAltitude = SunCalc.getPosition(times.solarNoon, latitude, longitude).altitude
    return {
      times: null,
      windows: null,
      polar: noonAltitude > 0 ? 'midnight-sun' : 'polar-night',
    }
  }

  /**
   * Every one of these can be absent, not just sunrise and sunset: close to
   * the polar circles the sun may cross the horizon but never descend far
   * enough for civil twilight, so dawn and dusk are missing while sunrise is
   * not. Treating that as "no usable light information" is more honest than
   * substituting a value nobody computed.
   */
  const candidates = {
    dawn: times.dawn,
    sunrise,
    goldenHourEnd: times.goldenHourEnd,
    solarNoon: times.solarNoon,
    goldenHourStart: times.goldenHour,
    sunset,
    dusk: times.dusk,
  }

  if (!Object.values(candidates).every(isValid)) {
    return { times: null, windows: null, polar: null }
  }

  const resolved = candidates as SunTimes

  return {
    times: resolved,
    windows: {
      blueHourMorning: { from: resolved.dawn, to: resolved.sunrise },
      goldenHourMorning: { from: resolved.sunrise, to: resolved.goldenHourEnd },
      goldenHourEvening: { from: resolved.goldenHourStart, to: resolved.sunset },
      blueHourEvening: { from: resolved.sunset, to: resolved.dusk },
    },
    polar: null,
  }
}

/** Whether an interval overlaps a light window, for "is this session in the golden hour". */
export function overlaps(
  interval: { from: Date; to: Date },
  window: { from: Date; to: Date },
): boolean {
  return interval.from < window.to && interval.to > window.from
}
