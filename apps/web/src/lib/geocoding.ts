import 'server-only'

import { serverEnv } from '@pof/config/env'
import { createNominatimGeocoding, createPhotonGeocoding } from '@pof/core'
import type { GeocodingPort } from '@pof/core/ports'

/**
 * The configured geocoding provider, or none.
 *
 * Which provider is right depends on the deployment, not on the code: Photon
 * supports autocomplete and is the sensible default, Nominatim is stricter
 * but reachable on networks where Photon is not, and a production deployment
 * should self-host or buy. `none` disables place search entirely — locations
 * can still be entered by coordinates, and sun times still work, because they
 * are computed locally.
 */
export function getGeocoding(): GeocodingPort | undefined {
  const env = serverEnv()
  const baseUrl = env.GEOCODING_BASE_URL

  switch (env.GEOCODING_PROVIDER) {
    case 'nominatim':
      return createNominatimGeocoding(baseUrl ? { baseUrl } : {})
    case 'none':
      return undefined
    default:
      return createPhotonGeocoding(baseUrl ? { baseUrl } : {})
  }
}
