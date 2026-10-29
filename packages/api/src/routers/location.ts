import { ORPCError } from '@orpc/client'
import { locations } from '@pof/core'
import {
  createLocationSchema,
  listLocationsSchema,
  locationIdSchema,
  searchPlacesSchema,
  sunTimesSchema,
  updateLocationSchema,
} from '@pof/schemas'

import { authed } from '../base.ts'

/** Thin adapters over `@pof/core`. See routers/shoot.ts for the pattern. */
export const locationRouter = {
  create: authed
    .route({ method: 'POST', path: '/locations', summary: 'Save a location' })
    .input(createLocationSchema)
    .handler(({ input, context }) => locations.createLocation(context.db, context.tenant, input)),

  list: authed
    .route({ method: 'GET', path: '/locations', summary: 'List saved locations' })
    .input(listLocationsSchema)
    .handler(({ input, context }) => locations.listLocations(context.db, context.tenant, input)),

  get: authed
    .route({ method: 'GET', path: '/locations/{id}', summary: 'Get a location' })
    .input(locationIdSchema)
    .handler(({ input, context }) => locations.getLocation(context.db, context.tenant, input.id)),

  update: authed
    .route({ method: 'PATCH', path: '/locations/{id}', summary: 'Update a location' })
    .input(updateLocationSchema)
    .handler(({ input, context }) => locations.updateLocation(context.db, context.tenant, input)),

  delete: authed
    .route({ method: 'DELETE', path: '/locations/{id}', summary: 'Delete a location' })
    .input(locationIdSchema)
    .handler(({ input, context }) =>
      locations.deleteLocation(context.db, context.tenant, input.id),
    ),

  /**
   * Place search, proxied rather than called from the browser: the provider's
   * policy requires an identifying User-Agent a browser cannot set, and
   * requires caching, which only the server can do across users.
   */
  search: authed
    .route({ method: 'GET', path: '/locations/search', summary: 'Search for a place' })
    .input(searchPlacesSchema)
    .handler(async ({ input, context }) => {
      if (!context.geocoding) {
        throw new ORPCError('SERVICE_UNAVAILABLE', {
          message: 'Place search is not configured',
        })
      }

      try {
        return await locations.searchPlaces(context.geocoding, input)
      } catch {
        /**
         * None of the free geocoders offer an availability guarantee, so an
         * outage is an expected state rather than a fault. Reported as such
         * so the UI can say "search is unavailable, enter coordinates
         * manually" instead of showing a generic error.
         */
        throw new ORPCError('SERVICE_UNAVAILABLE', {
          message: 'Place search is temporarily unavailable',
        })
      }
    }),

  /**
   * Sun times for a saved location.
   *
   * Computed locally from the stored coordinates, so this keeps working when
   * place search does not.
   */
  sunTimes: authed
    .route({ method: 'GET', path: '/locations/{locationId}/sun', summary: 'Sun times' })
    .input(sunTimesSchema)
    .handler(({ input, context }) =>
      locations.sunTimesForLocation(context.db, context.tenant, input.locationId, input.on),
    ),
}
