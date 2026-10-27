import { asc } from 'drizzle-orm'
import { schema, unsafeUnscopedDatabase, type Database } from '@pof/db'
import { getShootTypeDefinition } from '@pof/schemas'

/**
 * The genre list.
 *
 * Global reference data — the same four rows for every workspace — so this is
 * the one read in the planning module that legitimately runs unscoped. It is
 * routed through `unsafeUnscopedDatabase` rather than quietly using a bare
 * handle, so the exception stays greppable and has to be justified at the
 * call site rather than being invisible.
 *
 * The table holds ordering and labels; the field definitions driving
 * validation and the dynamic form live in the registry in `@pof/schemas`.
 * This merges the two so a caller gets everything it needs in one shape,
 * without the UI having to know there are two sources.
 */
export async function listShootTypes(db: Database) {
  const rows = await unsafeUnscopedDatabase(db)
    .select()
    .from(schema.shootType)
    .orderBy(asc(schema.shootType.sort))

  return rows.map((row) => {
    const definition = getShootTypeDefinition(row.key)

    return {
      key: row.key,
      label: row.label,
      description: row.description,
      sort: row.sort,
      /**
       * Empty when this build has no definition for a genre in the database —
       * possible during a rolling deploy, where an older instance serves a
       * row a newer migration added. The genre still appears and remains
       * selectable; it simply offers no genre-specific fields until the code
       * catches up, which is better than omitting it and making existing
       * shoots look broken.
       */
      fields: definition?.fields ?? [],
      version: definition?.version ?? 1,
    }
  })
}
