import type { GeocodeQuery, GeocodeResult, GeocodingPort } from '../ports/geocoding.ts'

/**
 * Nominatim geocoder — the alternative `GeocodingPort` adapter.
 *
 * NOT the default, and its policy is stricter than Photon's. Read
 * https://operations.osmfoundation.org/policies/nominatim/ before enabling
 * it; the relevant points are:
 *
 *   - Maximum one request per second, enforced here.
 *   - An identifying User-Agent is required; a stock library agent is
 *     explicitly unacceptable.
 *   - Results must be cached — handled in the service layer.
 *   - It has no autocomplete, and periodic type-ahead requests are treated as
 *     bulk geocoding and discouraged. The search UI therefore debounces
 *     heavily rather than querying per keystroke.
 *   - Access can be withdrawn without notice. Anything commercial should
 *     self-host or use a paid provider.
 *
 * Provided because some networks reach Nominatim and not Photon, which is
 * precisely the situation a port exists to absorb.
 */

interface NominatimPlace {
  place_id?: number
  osm_id?: number
  osm_type?: string
  lat?: string
  lon?: string
  name?: string
  display_name?: string
  type?: string
  address?: { country_code?: string }
}

export interface NominatimOptions {
  baseUrl?: string
  fetch?: typeof globalThis.fetch
}

export function createNominatimGeocoding(options: NominatimOptions = {}): GeocodingPort {
  const baseUrl = options.baseUrl ?? 'https://nominatim.openstreetmap.org'
  const doFetch = options.fetch ?? globalThis.fetch

  /**
   * Serialises requests at most one per second, as the policy requires.
   * A promise chain rather than a token bucket: simple, and correct under
   * concurrency because each caller waits for the previous one.
   */
  let gate: Promise<unknown> = Promise.resolve()
  const rateLimited = <T>(work: () => Promise<T>): Promise<T> => {
    const result = gate.then(work, work)
    gate = result.then(
      () => new Promise((resolve) => setTimeout(resolve, 1000)),
      () => new Promise((resolve) => setTimeout(resolve, 1000)),
    )
    return result
  }

  return {
    attribution: '© OpenStreetMap contributors',

    search(query: GeocodeQuery): Promise<GeocodeResult[]> {
      const trimmed = query.query.trim()
      if (trimmed.length < 3) return Promise.resolve([])

      return rateLimited(async () => {
        const url = new URL('/search', baseUrl)
        url.searchParams.set('q', trimmed)
        url.searchParams.set('format', 'jsonv2')
        url.searchParams.set('limit', String(query.limit ?? 8))
        url.searchParams.set('addressdetails', '1')

        const response = await doFetch(url, {
          headers: {
            'User-Agent':
              'PointOfFocus/0.1 (photoshoot planning; +https://github.com/CharbelHanna/pof)',
            Accept: 'application/json',
          },
        })

        if (!response.ok) throw new Error(`Geocoding failed (${response.status})`)

        const body = (await response.json()) as NominatimPlace[]
        return body.map(toResult).filter((r): r is GeocodeResult => r !== null)
      })
    },
  }
}

function toResult(place: NominatimPlace): GeocodeResult | null {
  // Nominatim returns coordinates as strings, unlike Photon's GeoJSON numbers.
  const latitude = Number(place.lat)
  const longitude = Number(place.lon)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null

  const display = place.display_name ?? ''
  const name = place.name || display.split(',')[0]?.trim() || 'Unnamed place'

  return {
    ...(place.osm_id ? { providerId: `${place.osm_type ?? ''}${place.osm_id}` } : {}),
    name,
    address: display || name,
    latitude,
    longitude,
    ...(place.type ? { kind: place.type } : {}),
    ...(place.address?.country_code ? { countryCode: place.address.country_code } : {}),
  }
}
