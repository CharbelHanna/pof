/**
 * ===========================================================================
 * GeocodingPort — turning a place a photographer types into coordinates.
 * ===========================================================================
 *
 * Coordinates are not a nicety here. Sunrise, sunset, golden hour and blue
 * hour are computed from latitude, longitude and date; a free-text address
 * produces none of them. So the location field has to resolve to real
 * coordinates at the point of entry, which makes this a search rather than a
 * text box.
 *
 * ---------------------------------------------------------------------------
 * Why this is behind a port, and what the licensing actually says
 * ---------------------------------------------------------------------------
 * Every freely available geocoder carries a usage policy rather than a
 * licence you can rely on commercially, so the provider has to be swappable:
 *
 *   Photon (photon.komoot.io) — the default adapter. Built for
 *     search-as-you-type, derived from OpenStreetMap data. Free, but
 *     "extensive usage will be throttled", with no availability guarantee.
 *
 *   Nominatim — deliberately NOT the default. Its usage policy caps requests
 *     at one per second, requires caching, and discourages the periodic
 *     requests a type-ahead makes; access can be withdrawn without notice. It
 *     also does not support autocomplete at all, which is the interaction
 *     this feature needs.
 *
 *   Self-hosted Photon or Pelias, or a paid provider (Geoapify, OpenCage,
 *     Mapbox) — what a commercial deployment would actually use.
 *
 * The same shape as the weather problem: the constraint is contractual, not
 * technical, and the port means it cannot block anything.
 *
 * Two obligations that are NOT optional when using OSM-derived data:
 *   1. Attribution must be displayed wherever results appear.
 *   2. Results must be cached rather than re-queried for the same input.
 * Both are handled — see the adapter and the search UI.
 */

export interface GeocodeResult {
  /** Stable id from the provider, where one exists. Not a primary key. */
  providerId?: string
  /** Short label, e.g. "Glen Coe". */
  name: string
  /** Full human-readable address for disambiguation in a results list. */
  address: string
  latitude: number
  longitude: number
  /** "village", "peak", "building" — shown to help pick between results. */
  kind?: string
  countryCode?: string
}

export interface GeocodeQuery {
  query: string
  limit?: number
  /** Bias results towards a point, for "near me" searches. */
  near?: { latitude: number; longitude: number }
}

export interface GeocodingPort {
  search(query: GeocodeQuery): Promise<GeocodeResult[]>
  /**
   * Attribution text that must be rendered wherever results are shown. Part
   * of the port because it differs per provider and is a licence obligation,
   * not a UI preference — a component cannot be left to remember it.
   */
  readonly attribution: string
}
