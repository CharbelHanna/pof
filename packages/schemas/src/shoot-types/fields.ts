import { z } from 'zod'

/**
 * Field metadata for the dynamic form renderer.
 *
 * A genre's definition supplies BOTH a Zod schema and this presentation
 * metadata, from one place. The alternative — a schema here and a hand-written
 * form over there — guarantees the two drift, and the symptom is a field that
 * validates but cannot be entered, or vice versa.
 */

export const FIELD_WIDGETS = ['text', 'textarea', 'number', 'date', 'select', 'toggle'] as const
export type FieldWidget = (typeof FIELD_WIDGETS)[number]

export interface FieldOption {
  value: string
  label: string
}

export interface FieldSpec {
  /** Must match a key in the genre's `detailsSchema`. */
  name: string
  label: string
  widget: FieldWidget
  /** Shown under the input. Use for things a photographer would otherwise ask. */
  help?: string
  placeholder?: string
  /** Required for `select`; ignored otherwise. */
  options?: readonly FieldOption[]
  /**
   * Bounds for `number`, mirrored onto the input so the browser enforces
   * them before a round trip.
   *
   * These MUST match the genre's Zod schema. Without them a field like
   * "Approach time (minutes)" accepted a negative in the browser, sent it,
   * and came back with a bare "Validation failed" — the schema was right,
   * but nothing told the user which field or why. `registry.test.ts` probes
   * the schema with `min - 1` and `max + 1` so the two cannot drift.
   */
  min?: number
  max?: number
}

export interface ShootTypeDefinition {
  key: string
  label: string
  /** One line, shown when choosing a type. */
  description: string
  /**
   * Bumped when the shape of `details` changes incompatibly. Stored per row as
   * `details_schema_version`, so old payloads can be migrated lazily on read
   * rather than in one large, risky backfill.
   */
  version: number
  detailsSchema: z.ZodType<Record<string, unknown>>
  fields: readonly FieldSpec[]
}
