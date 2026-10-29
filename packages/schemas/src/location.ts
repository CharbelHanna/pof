import { z } from 'zod'

/** Location contracts. */

const locationName = z.string().trim().min(1, 'Name is required').max(200)

/**
 * Bounds are checked rather than assumed. Transposed latitude and longitude
 * is the classic geocoding bug — GeoJSON orders them [lon, lat] while people
 * say "lat, long" — and a latitude of 120 is the symptom.
 */
export const latitudeSchema = z.coerce.number().min(-90).max(90)
export const longitudeSchema = z.coerce.number().min(-180).max(180)

const queryNumber = z.coerce.number()
const queryBoolean = z.union([z.boolean(), z.stringbool()])

export const createLocationSchema = z.object({
  id: z.uuid().optional(),
  name: locationName,
  address: z.string().max(500).nullable().optional(),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  provider: z.string().max(40).nullable().optional(),
  providerId: z.string().max(120).nullable().optional(),
  accessNotes: z.string().max(10_000).nullable().optional(),
  parkingNotes: z.string().max(10_000).nullable().optional(),
  permitRequired: queryBoolean.default(false),
  notes: z.string().max(10_000).nullable().optional(),
})
export type CreateLocationInput = z.infer<typeof createLocationSchema>

export const updateLocationSchema = z.object({
  id: z.uuid(),
  name: locationName.optional(),
  address: z.string().max(500).nullable().optional(),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  accessNotes: z.string().max(10_000).nullable().optional(),
  parkingNotes: z.string().max(10_000).nullable().optional(),
  permitRequired: queryBoolean.optional(),
  notes: z.string().max(10_000).nullable().optional(),
})
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>

export const listLocationsSchema = z.object({
  cursor: z.uuid().optional(),
  limit: queryNumber.int().min(1).max(200).default(100),
  updatedSince: z.coerce.date().optional(),
  includeDeleted: queryBoolean.default(false),
})
export type ListLocationsInput = z.infer<typeof listLocationsSchema>

export const locationIdSchema = z.object({ id: z.uuid() })

/** Place search, proxied through the server so the provider stays swappable. */
export const searchPlacesSchema = z.object({
  query: z.string().trim().min(3, 'Type at least three characters').max(200),
  limit: queryNumber.int().min(1).max(10).default(8),
})
export type SearchPlacesInput = z.infer<typeof searchPlacesSchema>

/** Sun times for a location on a given day. */
export const sunTimesSchema = z.object({
  locationId: z.uuid(),
  /** Any instant on the day of interest — typically a session's start. */
  on: z.coerce.date(),
})
export type SunTimesInput = z.infer<typeof sunTimesSchema>
