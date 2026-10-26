import { z } from 'zod'

import type { ShootTypeDefinition } from './fields.ts'

/**
 * ===========================================================================
 * The shoot-type registry — what makes "works for every genre" true.
 * ===========================================================================
 *
 * A portrait shoot, an editorial shoot, a landscape shoot and a product shoot
 * share most of their structure (dates, status, client, location, delivery)
 * but each has a handful of fields nobody else cares about. The question is
 * where those live.
 *
 * Rejected approaches, and why:
 *
 *   - A Postgres enum or a hardcoded union of genres. Adding "wedding" or
 *     "architecture" becomes a migration and a deploy, which breaks the
 *     multi-genre promise on day one.
 *   - A table per genre. A join and a migration per genre, and polymorphic
 *     reads everywhere they are listed together.
 *   - EAV / generic custom fields. Maximally flexible, unqueryable, and the
 *     product becomes a form builder instead of a planning tool.
 *
 * What is here instead: a `shoot_type` REFERENCE TABLE (rows, not an enum —
 * so adding a genre is an INSERT) keyed by `shoot_type_key`, plus a `details`
 * jsonb column validated by the definitions below. One definition drives
 * validation, the dynamic form, and the inferred TypeScript type.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THAT KEEPS THIS FROM ROTTING
 * ---------------------------------------------------------------------------
 * Anything cross-genre or queryable is a REAL COLUMN — date, status, client,
 * location, delivery date, campaign. `details` holds only genre-specific
 * trivia that nothing sorts, filters or reports on.
 *
 * When a `details` field turns out to be cross-genre, PROMOTE IT to a column
 * in an ordinary migration and drop it from the definitions here. That
 * promotion path is the escape hatch that makes jsonb safe rather than a
 * dumping ground. If you find yourself wanting to filter a list by something
 * in `details`, that is the signal.
 */

/** Shared field builders, so limits stay consistent across genres. */
const shortText = z.string().trim().max(200)
const longText = z.string().trim().max(4000)
const count = z.number().int().min(0).max(10_000)

const portrait = {
  key: 'portrait',
  label: 'Portrait',
  description: 'People — headshots, personal branding, portfolio work.',
  version: 1,
  detailsSchema: z.object({
    subjectCount: count.optional(),
    wardrobeNotes: longText.optional(),
    makeupArtist: shortText.optional(),
    hairStylist: shortText.optional(),
  }),
  fields: [
    {
      name: 'subjectCount',
      label: 'Number of subjects',
      widget: 'number',
      help: 'Drives how much time and how many looks you need.',
    },
    { name: 'wardrobeNotes', label: 'Wardrobe notes', widget: 'textarea' },
    { name: 'makeupArtist', label: 'Makeup artist', widget: 'text' },
    { name: 'hairStylist', label: 'Hair stylist', widget: 'text' },
  ],
} satisfies ShootTypeDefinition

const editorial = {
  key: 'editorial',
  label: 'Editorial',
  description: 'Commissioned work for a publication or brand story.',
  version: 1,
  detailsSchema: z.object({
    publication: shortText.optional(),
    issueDate: z.string().date().optional(),
    artDirector: shortText.optional(),
    lookCount: count.optional(),
  }),
  fields: [
    { name: 'publication', label: 'Publication', widget: 'text', placeholder: 'Vogue Italia' },
    {
      name: 'issueDate',
      label: 'Issue date',
      widget: 'date',
      help: 'The publication date, not your delivery date.',
    },
    { name: 'artDirector', label: 'Art director', widget: 'text' },
    { name: 'lookCount', label: 'Number of looks', widget: 'number' },
  ],
} satisfies ShootTypeDefinition

const landscape = {
  key: 'landscape',
  label: 'Landscape',
  description: 'Outdoor and location work where light and access decide the day.',
  version: 1,
  detailsSchema: z.object({
    hikeMinutes: z.number().int().min(0).max(2880).optional(),
    tideState: z.enum(['any', 'low', 'rising', 'high', 'falling']).optional(),
    permitRequired: z.boolean().optional(),
    accessNotes: longText.optional(),
  }),
  fields: [
    {
      name: 'hikeMinutes',
      label: 'Approach time (minutes)',
      widget: 'number',
      help: 'Counted backwards from first light when planning the call time.',
    },
    {
      name: 'tideState',
      label: 'Tide',
      widget: 'select',
      options: [
        { value: 'any', label: 'Does not matter' },
        { value: 'low', label: 'Low' },
        { value: 'rising', label: 'Rising' },
        { value: 'high', label: 'High' },
        { value: 'falling', label: 'Falling' },
      ],
    },
    { name: 'permitRequired', label: 'Permit required', widget: 'toggle' },
    { name: 'accessNotes', label: 'Access notes', widget: 'textarea' },
  ],
} satisfies ShootTypeDefinition

const product = {
  key: 'product',
  label: 'Product',
  description: 'Catalogue, packshot and still-life work, usually at volume.',
  version: 1,
  detailsSchema: z.object({
    skuCount: count.optional(),
    surfaceFinish: z.enum(['matte', 'gloss', 'reflective', 'transparent', 'mixed']).optional(),
    turntable: z.boolean().optional(),
    propStylist: shortText.optional(),
  }),
  fields: [
    {
      name: 'skuCount',
      label: 'Number of SKUs',
      widget: 'number',
      help: 'The single biggest driver of how long a catalogue day takes.',
    },
    {
      name: 'surfaceFinish',
      label: 'Surface finish',
      widget: 'select',
      help: 'Reflective and transparent surfaces change the lighting setup entirely.',
      options: [
        { value: 'matte', label: 'Matte' },
        { value: 'gloss', label: 'Gloss' },
        { value: 'reflective', label: 'Reflective' },
        { value: 'transparent', label: 'Transparent' },
        { value: 'mixed', label: 'Mixed' },
      ],
    },
    { name: 'turntable', label: 'Turntable / 360°', widget: 'toggle' },
    { name: 'propStylist', label: 'Prop stylist', widget: 'text' },
  ],
} satisfies ShootTypeDefinition

/**
 * Genres shipped with the product. A workspace can add its own later (V2) —
 * `shoot_type` is a table, so that is an INSERT plus a definition supplied at
 * runtime, not a change here.
 */
export const SYSTEM_SHOOT_TYPES = { portrait, editorial, landscape, product } as const

export type SystemShootTypeKey = keyof typeof SYSTEM_SHOOT_TYPES

export const SYSTEM_SHOOT_TYPE_KEYS = Object.keys(SYSTEM_SHOOT_TYPES) as SystemShootTypeKey[]

/**
 * Details for a genre this build does not know about.
 *
 * Reached when a workspace-defined type exists, or when a row was written by a
 * newer deploy than the one reading it. Rejecting outright would make a shoot
 * uneditable; accepting anything would let arbitrary nested JSON in.
 *
 * The middle path: a flat map of JSON scalars, bounded in both key count and
 * value length. The data survives a round trip untouched, and nothing
 * unbounded or deeply nested gets stored.
 */
const unknownTypeDetailsSchema = z
  .record(z.string().max(64), z.union([z.string().max(4000), z.number(), z.boolean(), z.null()]))
  .refine((value) => Object.keys(value).length <= 50, {
    message: 'Too many custom fields (maximum 50)',
  })

export function getShootTypeDefinition(key: string): ShootTypeDefinition | undefined {
  return SYSTEM_SHOOT_TYPES[key as SystemShootTypeKey]
}

export function isSystemShootTypeKey(key: string): key is SystemShootTypeKey {
  return key in SYSTEM_SHOOT_TYPES
}

/**
 * Validate a `details` payload against its genre.
 *
 * Used by the service layer before a write, so an invalid payload never
 * reaches the column. Throws a ZodError, which the oRPC adapter maps to a 400.
 */
export function parseShootDetails(shootTypeKey: string, details: unknown): Record<string, unknown> {
  // Treat an absent payload as empty rather than an error: most shoots never
  // fill in genre fields, and requiring `{}` everywhere is noise.
  const candidate = details ?? {}
  const definition = getShootTypeDefinition(shootTypeKey)

  return definition
    ? definition.detailsSchema.parse(candidate)
    : unknownTypeDetailsSchema.parse(candidate)
}

/** Non-throwing variant, for rendering a row we may not be able to parse. */
export function safeParseShootDetails(
  shootTypeKey: string,
  details: unknown,
): Record<string, unknown> {
  const definition = getShootTypeDefinition(shootTypeKey)
  const schema = definition?.detailsSchema ?? unknownTypeDetailsSchema
  const result = schema.safeParse(details ?? {})

  // A row written under an older schema version must still be viewable. The
  // form shows what it understands; nothing is destroyed, because a read never
  // writes back.
  return result.success ? result.data : {}
}

/** The schema version to stamp on a row written now. */
export function currentDetailsVersion(shootTypeKey: string): number {
  return getShootTypeDefinition(shootTypeKey)?.version ?? 1
}
