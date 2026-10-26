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
