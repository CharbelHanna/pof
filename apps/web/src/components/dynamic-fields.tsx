'use client'

import type { FieldSpec } from '@pof/schemas'
import { useId } from 'react'

/**
 * Renders a genre's fields from its registry definition.
 *
 * Nothing here knows that "editorial" or "product" exist. Adding a genre —
 * or a field to one — is a change in `@pof/schemas/shoot-types/registry.ts`
 * and nothing else: no component edit, no migration, no deploy coupling
 * between the two.
 *
 * Values are held by the caller so this stays a controlled, presentational
 * component. It deliberately does not validate: the registry's Zod schema is
 * the single authority, applied on the server, and a second half-implemented
 * copy of the rules here is how the two drift apart.
 */
export function DynamicFields({
  fields,
  values,
  onChange,
  disabled,
}: {
  fields: readonly FieldSpec[]
  values: Record<string, unknown>
  onChange: (name: string, value: unknown) => void
  disabled?: boolean
}) {
  if (fields.length === 0) return null

  return (
    <div className="space-y-4">
      {fields.map((field) => (
        <Field
          key={field.name}
          field={field}
          value={values[field.name]}
          onChange={(value) => onChange(field.name, value)}
          disabled={disabled}
        />
      ))}
    </div>
  )
}

function Field({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FieldSpec
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
}) {
  const id = useId()
  const helpId = `${id}-help`

  /**
   * Help text is associated with `aria-describedby` and kept OUTSIDE the
   * label, not nested inside it.
   *
   * A `<label>` wrapping both the control and the help text folds that help
   * into the field's accessible NAME, so a screen reader announces "Issue
   * date The publication date, not your delivery date" as the name of the
   * field. The description belongs in the description slot, which is what
   * aria-describedby is for.
   */
  return (
    <div>
      <label
        htmlFor={id}
        className="text-ink-700 dark:text-ink-300 mb-1.5 block text-sm font-medium"
      >
        {field.label}
      </label>

      <FieldInput
        id={id}
        describedBy={field.help ? helpId : undefined}
        field={field}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />

      {field.help && (
        <p id={helpId} className="text-ink-500 mt-1 text-xs">
          {field.help}
        </p>
      )}
    </div>
  )
}

function FieldInput({
  id,
  describedBy,
  field,
  value,
  onChange,
  disabled,
}: {
  id: string
  describedBy: string | undefined
  field: FieldSpec
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
}) {
  const base =
    'border-ink-200 dark:border-ink-700 dark:bg-ink-900 w-full rounded-lg border bg-white px-3 py-2.5 text-base outline-none focus:border-accent-500 disabled:opacity-60'

  const shared = { id, 'aria-describedby': describedBy, disabled, className: base }

  switch (field.widget) {
    case 'textarea':
      return (
        <textarea
          {...shared}
          rows={3}
          placeholder={field.placeholder}
          value={asText(value)}
          onChange={(event) => onChange(emptyToUndefined(event.target.value))}
        />
      )

    case 'number':
      return (
        <input
          {...shared}
          type="number"
          inputMode="numeric"
          placeholder={field.placeholder}
          value={asText(value)}
          onChange={(event) => {
            const raw = event.target.value
            // An empty box means "not specified", not zero. Sending 0 would
            // record a deliberate-looking answer the user never gave.
            onChange(raw === '' ? undefined : Number(raw))
          }}
        />
      )

    case 'date':
      return (
        <input
          {...shared}
          type="date"
          value={asText(value)}
          onChange={(event) => onChange(emptyToUndefined(event.target.value))}
        />
      )

    case 'toggle':
      return (
        <input
          id={id}
          aria-describedby={describedBy}
          disabled={disabled}
          type="checkbox"
          className="accent-accent-600 size-5 rounded"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked ? true : undefined)}
        />
      )

    case 'select':
      return (
        <select
          {...shared}
          value={asText(value)}
          onChange={(event) => onChange(emptyToUndefined(event.target.value))}
        >
          {/* Genre fields are all optional, so "not specified" must be
              reachable — otherwise the first option becomes a silent default
              nobody chose. */}
          <option value="">—</option>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )

    default:
      return (
        <input
          {...shared}
          type="text"
          placeholder={field.placeholder}
          value={asText(value)}
          onChange={(event) => onChange(emptyToUndefined(event.target.value))}
        />
      )
  }
}

/** Keeps inputs controlled: null and undefined both render as empty. */
function asText(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

/**
 * Cleared fields are omitted rather than sent as "". The registry schemas
 * treat absence as "not specified"; an empty string is a value, and for a
 * `select` backed by an enum it is an invalid one.
 */
function emptyToUndefined(value: string): string | undefined {
  return value === '' ? undefined : value
}
