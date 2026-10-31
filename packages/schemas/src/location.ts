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

// --- locations used by a session ------------------------------------------
//
// A session is often a route rather than a single place: park at the layby,
// walk to the lochside for blue hour, climb to the ridge for sunrise. The
// order is the plan — it decides what is reachable before the light goes —
// so position is part of the contract, not a display detail.

export const addSessionLocationSchema = z.object({
  id: z.uuid().optional(),
  sessionId: z.uuid(),
  locationId: z.uuid(),
  /** Omitted means "append as the next stop". */
  position: queryNumber.int().min(0).max(1_000_000_000).optional(),
  /** Why this stop — "park here", "permit needed", "20 min walk in". */
  notes: z.string().max(10_000).nullable().optional(),
})
export type AddSessionLocationInput = z.infer<typeof addSessionLocationSchema>

export const updateSessionLocationSchema = z.object({
  id: z.uuid(),
  position: queryNumber.int().min(0).max(1_000_000_000).optional(),
  notes: z.string().max(10_000).nullable().optional(),
})
export type UpdateSessionLocationInput = z.infer<typeof updateSessionLocationSchema>

export const listSessionLocationsSchema = z.object({
  sessionId: z.uuid().optional(),
  cursor: z.uuid().optional(),
  limit: queryNumber.int().min(1).max(200).default(100),
  updatedSince: z.coerce.date().optional(),
  includeDeleted: queryBoolean.default(false),
})
export type ListSessionLocationsInput = z.infer<typeof listSessionLocationsSchema>

export const sessionLocationIdSchema = z.object({ id: z.uuid() })

/**
 * Reordering is one operation, not a series of updates.
 *
 * Moving one stop up a route changes the position of every stop it passed.
 * Sent as independent patches the route would be briefly inconsistent, and
 * permanently so if one request failed.
 */
export const reorderSessionLocationsSchema = z.object({
  sessionId: z.uuid(),
  /** Every live stop on the session, in its new visiting order. */
  orderedIds: z.array(z.uuid()).min(1).max(100),
})
export type ReorderSessionLocationsInput = z.infer<typeof reorderSessionLocationsSchema>
