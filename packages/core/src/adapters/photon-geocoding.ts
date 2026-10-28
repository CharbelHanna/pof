import type { GeocodeQuery, GeocodeResult, GeocodingPort } from '../ports/geocoding.ts'

/**
 * Photon geocoder — the default `GeocodingPort` adapter.
 *
 * Photon indexes OpenStreetMap data and is built for search-as-you-type,
 * which Nominatim explicitly is not. See ports/geocoding.ts for why the
 * provider is swappable and what each option's policy actually permits.
 */

interface PhotonFeature {
  properties?: {
    osm_id?: number
    osm_type?: string
    name?: string
    street?: string
    housenumber?: string
    city?: string
    state?: string
    country?: string
    countrycode?: string
    osm_value?: string
    osm_key?: string
  }
  geometry?: { coordinates?: [number, number] }
}

export interface PhotonOptions {
  /** Override to point at a self-hosted instance. */
  baseUrl?: string
  fetch?: typeof globalThis.fetch
}

export function createPhotonGeocoding(options: PhotonOptions = {}): GeocodingPort {
  const baseUrl = options.baseUrl ?? 'https://photon.komoot.io'
  const doFetch = options.fetch ?? globalThis.fetch

  return {
    attribution: '© OpenStreetMap contributors',

    async search(query: GeocodeQuery): Promise<GeocodeResult[]> {
      const trimmed = query.query.trim()
      // Single characters match half the planet and waste a request against a
      // service that asks us not to hammer it.
      if (trimmed.length < 3) return []

      const url = new URL('/api', baseUrl)
      url.searchParams.set('q', trimmed)
      url.searchParams.set('limit', String(query.limit ?? 8))
      if (query.near) {
        url.searchParams.set('lat', String(query.near.latitude))
        url.searchParams.set('lon', String(query.near.longitude))
      }

      const response = await doFetch(url, {
        headers: {
          // Identifying the application is required by OSM-derived services;
          // a stock library agent is explicitly not acceptable.
          'User-Agent':
            'PointOfFocus/0.1 (photoshoot planning; +https://github.com/CharbelHanna/pof)',
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(`Geocoding failed (${response.status})`)
      }

      const body = (await response.json()) as { features?: PhotonFeature[] }

      return (body.features ?? [])
        .map(toResult)
        .filter((result): result is GeocodeResult => result !== null)
    },
  }
}

function toResult(feature: PhotonFeature): GeocodeResult | null {
  const coordinates = feature.geometry?.coordinates
  // GeoJSON is [longitude, latitude] — the reverse of how everyone says it,
  // and a reliable source of silently transposed coordinates.
  const longitude = coordinates?.[0]
  const latitude = coordinates?.[1]
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null

  const props = feature.properties ?? {}
  const name =
    props.name ??
    [props.housenumber, props.street].filter(Boolean).join(' ') ??
    props.city ??
    'Unnamed place'

  const address = [
    [props.housenumber, props.street].filter(Boolean).join(' ') || undefined,
    props.city,
    props.state,
    props.country,
  ]
    .filter(Boolean)
    .join(', ')

  return {
    ...(props.osm_id ? { providerId: `${props.osm_type ?? ''}${props.osm_id}` } : {}),
    name,
    address: address || name,
    latitude,
    longitude,
    ...(props.osm_value ? { kind: props.osm_value } : {}),
    ...(props.countrycode ? { countryCode: props.countrycode } : {}),
  }
}
