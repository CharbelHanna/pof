import { and, asc, eq, gt, gte, isNull, sql, type SQL } from 'drizzle-orm'
import { schema, withTenant, type Database, type TenantContext } from '@pof/db'
import {
  sunReport,
  type CreateLocationInput,
  type ListLocationsInput,
  type SearchPlacesInput,
  type UpdateLocationInput,
} from '@pof/schemas'

import { NotFoundError } from '../../errors.ts'
import type { GeocodeResult, GeocodingPort } from '../../ports/geocoding.ts'

/**
 * Locations, place search, and the light.
 *
 * Search is proxied through the server rather than called from the browser.
 * Three reasons, all practical: the provider's usage policy requires an
 * identifying User-Agent that a browser will not let us set; results can be
 * cached server-side, which the same policy requires; and swapping provider
 * later touches one adapter rather than every client.
 */

const { location } = schema

function visibility(workspaceId: string, includeDeleted: boolean): SQL | undefined {
  const scope = eq(location.workspaceId, workspaceId)
  return includeDeleted ? scope : and(scope, isNull(location.deletedAt))
}

export async function createLocation(db: Database, ctx: TenantContext, input: CreateLocationInput) {
  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .insert(location)
      .values({
        ...(input.id ? { id: input.id } : {}),
        workspaceId: ctx.workspaceId,
        name: input.name,
        address: input.address ?? null,
        latitude: input.latitude,
        longitude: input.longitude,
        provider: input.provider ?? null,
        providerId: input.providerId ?? null,
        accessNotes: input.accessNotes ?? null,
        parkingNotes: input.parkingNotes ?? null,
        permitRequired: input.permitRequired,
        notes: input.notes ?? null,
      })
      .onConflictDoNothing({ target: location.id })
      .returning()

    if (row) return row

    const existing = input.id ? await find(tx, ctx.workspaceId, input.id) : undefined
    if (!existing) throw new NotFoundError('Location', input.id)
    return existing
  })
}

async function find(
  tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  workspaceId: string,
  id: string,
) {
  const [row] = await tx
    .select()
    .from(location)
    .where(and(eq(location.id, id), visibility(workspaceId, true)))
    .limit(1)

  return row
}

export async function getLocation(db: Database, ctx: TenantContext, id: string) {
  return withTenant(db, ctx, async (tx) => {
    const row = await find(tx, ctx.workspaceId, id)
    if (!row) throw new NotFoundError('Location', id)
    return row
  })
}

export async function listLocations(db: Database, ctx: TenantContext, input: ListLocationsInput) {
  return withTenant(db, ctx, async (tx) => {
    const predicates: (SQL | undefined)[] = [visibility(ctx.workspaceId, input.includeDeleted)]
    if (input.updatedSince) predicates.push(gte(location.updatedAt, input.updatedSince))
    if (input.cursor) predicates.push(gt(location.id, input.cursor))

    const rows = await tx
      .select()
      .from(location)
      .where(and(...predicates))
      .orderBy(asc(location.id))
      .limit(input.limit + 1)

    const [clock] = await tx.execute<{ now: string }>(sql`select transaction_timestamp() as now`)

    const hasMore = rows.length > input.limit
    const page = hasMore ? rows.slice(0, input.limit) : rows

    return {
      items: page,
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
      syncedAt: new Date(clock!.now),
    }
  })
}

export async function updateLocation(db: Database, ctx: TenantContext, input: UpdateLocationInput) {
  const { id, ...patch } = input

  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .update(location)
      .set(patch)
      .where(and(eq(location.id, id), visibility(ctx.workspaceId, false)))
      .returning()

    if (!row) throw new NotFoundError('Location', id)
    return row
  })
}

export async function deleteLocation(db: Database, ctx: TenantContext, id: string) {
  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .update(location)
      .set({ deletedAt: new Date() })
      .where(and(eq(location.id, id), visibility(ctx.workspaceId, false)))
      .returning()

    if (!row) throw new NotFoundError('Location', id)
    return row
  })
}

/**
 * Cache for place searches.
 *
 * The OSM usage policy requires caching and allows clients repeating
 * identical queries to be blocked, so this is an obligation rather than an
 * optimisation. In-process and bounded: a shared cache would be better under
 * multiple instances, but this already removes the repeated-keystroke traffic
 * the policy objects to, without adding Redis to a stack that deliberately
 * has none.
 */
const searchCache = new Map<string, { at: number; results: GeocodeResult[] }>()
const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_MAX_ENTRIES = 500

export async function searchPlaces(geocoding: GeocodingPort, input: SearchPlacesInput) {
  const key = `${input.query.toLowerCase()}::${input.limit}`
  const cached = searchCache.get(key)

  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { results: cached.results, attribution: geocoding.attribution }
  }

  const results = await geocoding.search({ query: input.query, limit: input.limit })

  if (searchCache.size >= CACHE_MAX_ENTRIES) {
    // Crude but adequate: drop the oldest insertion. Map preserves order.
    const oldest = searchCache.keys().next().value
    if (oldest) searchCache.delete(oldest)
  }
  searchCache.set(key, { at: Date.now(), results })

  return { results, attribution: geocoding.attribution }
}

/**
 * Sun times for a stored location on a given day.
 *
 * Computed locally from the stored coordinates — no provider involved, so
 * this keeps working regardless of whether any geocoder is reachable.
 */
export async function sunTimesForLocation(
  db: Database,
  ctx: TenantContext,
  locationId: string,
  on: Date,
) {
  const place = await getLocation(db, ctx, locationId)
  const report = sunReport(on, place.latitude, place.longitude)

  return {
    locationId: place.id,
    locationName: place.name,
    latitude: place.latitude,
    longitude: place.longitude,
    ...report,
  }
}
