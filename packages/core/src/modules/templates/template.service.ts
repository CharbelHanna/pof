import { and, asc, desc, eq, gt, gte, isNull, max, sql, type SQL } from 'drizzle-orm'
import { schema, withTenant, type Database, type TenantContext, type TenantDb } from '@pof/db'
import {
  templateItemPayloadSchema,
  type ApplyTemplateInput,
  type CreateTemplateInput,
  type GetTemplateInput,
  type ListTemplatesInput,
  type ListTemplateVersionsInput,
  type PublishTemplateVersionInput,
  type SaveSessionAsTemplateInput,
  type TemplateItemPayload,
  type UpdateTemplateInput,
} from '@pof/schemas'

import { NotFoundError, ValidationError } from '../../errors.ts'

/**
 * Session templates.
 *
 * Two rules the rest of this file exists to keep:
 *
 *   1. A published version is never modified. Changing a template publishes a
 *      new version beside the old one.
 *   2. Applying COPIES. It writes real `shot` and `checklist_item` rows, and
 *      stamps each with the template item it came from.
 *
 * Together those make a finished shoot a historical artefact rather than a
 * live view of whatever the template says today — which is the difference
 * between records you can rely on in a dispute and records that quietly
 * rewrite themselves.
 */

const {
  sessionTemplate,
  sessionTemplateVersion,
  templateItem,
  shootSession,
  shot,
  checklist,
  checklistItem,
} = schema

const POSITION_STEP = 10

function visibility(workspaceId: string, includeDeleted: boolean): SQL | undefined {
  const scope = eq(sessionTemplate.workspaceId, workspaceId)
  return includeDeleted ? scope : and(scope, isNull(sessionTemplate.deletedAt))
}

async function findTemplate(tx: TenantDb, workspaceId: string, id: string) {
  const [row] = await tx
    .select()
    .from(sessionTemplate)
    .where(and(eq(sessionTemplate.id, id), visibility(workspaceId, true)))
    .limit(1)

  return row
}

export async function createTemplate(db: Database, ctx: TenantContext, input: CreateTemplateInput) {
  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .insert(sessionTemplate)
      .values({
        ...(input.id ? { id: input.id } : {}),
        workspaceId: ctx.workspaceId,
        name: input.name,
        shootTypeKey: input.shootTypeKey ?? null,
        notes: input.notes ?? null,
      })
      .onConflictDoNothing({ target: sessionTemplate.id })
      .returning()

    if (row) return row

    const existing = input.id ? await findTemplate(tx, ctx.workspaceId, input.id) : undefined
    if (!existing) throw new NotFoundError('Template', input.id)
    return existing
  })
}

export async function listTemplates(db: Database, ctx: TenantContext, input: ListTemplatesInput) {
  return withTenant(db, ctx, async (tx) => {
    const predicates: (SQL | undefined)[] = [visibility(ctx.workspaceId, input.includeDeleted)]

    if (input.shootTypeKey) predicates.push(eq(sessionTemplate.shootTypeKey, input.shootTypeKey))
    if (input.updatedSince) predicates.push(gte(sessionTemplate.updatedAt, input.updatedSince))
    if (input.cursor) predicates.push(gt(sessionTemplate.id, input.cursor))

    const rows = await tx
      .select()
      .from(sessionTemplate)
      .where(and(...predicates))
      .orderBy(asc(sessionTemplate.id))
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

/** A template plus the contents of one version — current unless asked otherwise. */
export async function getTemplate(db: Database, ctx: TenantContext, input: GetTemplateInput) {
  return withTenant(db, ctx, async (tx) => {
    const template = await findTemplate(tx, ctx.workspaceId, input.id)
    if (!template) throw new NotFoundError('Template', input.id)

    const wanted = input.version ?? template.currentVersion

    // A template that has been named but never published has nothing to show,
    // which is a legitimate state rather than an error.
    if (wanted === 0) return { template, version: null, items: [] }

    const [version] = await tx
      .select()
      .from(sessionTemplateVersion)
      .where(
        and(
          eq(sessionTemplateVersion.templateId, template.id),
          eq(sessionTemplateVersion.version, wanted),
          eq(sessionTemplateVersion.workspaceId, ctx.workspaceId),
        ),
      )
      .limit(1)

    if (!version) throw new NotFoundError('Template version', String(wanted))

    const items = await tx
      .select()
      .from(templateItem)
      .where(
        and(eq(templateItem.versionId, version.id), eq(templateItem.workspaceId, ctx.workspaceId)),
      )
      .orderBy(asc(templateItem.position))

    return { template, version, items }
  })
}

export async function listTemplateVersions(
  db: Database,
  ctx: TenantContext,
  input: ListTemplateVersionsInput,
) {
  return withTenant(db, ctx, async (tx) => {
    const template = await findTemplate(tx, ctx.workspaceId, input.templateId)
    if (!template) throw new NotFoundError('Template', input.templateId)

    return tx
      .select()
      .from(sessionTemplateVersion)
      .where(
        and(
          eq(sessionTemplateVersion.templateId, template.id),
          eq(sessionTemplateVersion.workspaceId, ctx.workspaceId),
        ),
      )
      .orderBy(desc(sessionTemplateVersion.version))
      .limit(input.limit)
  })
}

export async function updateTemplate(db: Database, ctx: TenantContext, input: UpdateTemplateInput) {
  const { id, ...patch } = input

  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .update(sessionTemplate)
      .set(patch)
      .where(and(eq(sessionTemplate.id, id), visibility(ctx.workspaceId, false)))
      .returning()

    if (!row) throw new NotFoundError('Template', id)
    return row
  })
}

export async function deleteTemplate(db: Database, ctx: TenantContext, id: string) {
  return withTenant(db, ctx, async (tx) => {
    const [row] = await tx
      .update(sessionTemplate)
      .set({ deletedAt: new Date() })
      .where(and(eq(sessionTemplate.id, id), visibility(ctx.workspaceId, false)))
      .returning()

    if (!row) throw new NotFoundError('Template', id)

    /**
     * Versions and items are deliberately left alone.
     *
     * Sessions still point at them, and a session that reports "built from
     * Studio Portrait v2" has to be able to show what v2 actually was. The
     * template disappears from the picker; its history does not evaporate.
     */
    return row
  })
}

/**
 * Publish a new version from a complete item list.
 *
 * Atomic by construction: the version row and all of its items are written in
 * one transaction, and `current_version` moves only once they are there. A
 * half-written version is the one thing that would break the immutability
 * promise, because something could then be added to a version already
 * applied somewhere.
 */
export async function publishTemplateVersion(
  db: Database,
  ctx: TenantContext,
  input: PublishTemplateVersionInput,
) {
  return withTenant(db, ctx, async (tx) => {
    const template = await findTemplate(tx, ctx.workspaceId, input.templateId)
    if (!template) throw new NotFoundError('Template', input.templateId)
    if (template.deletedAt) {
      throw new ValidationError('Cannot publish a version of a deleted template', 'templateId')
    }

    /**
     * Read the highest version from the version table rather than trusting
     * `current_version` on the template. The two should agree, and the unique
     * constraint on (workspace, template, version) is what guarantees it —
     * but deriving the next number from the rows that actually exist means a
     * concurrent publish fails on the constraint rather than silently
     * overwriting.
     */
    const [highest] = await tx
      .select({ version: max(sessionTemplateVersion.version) })
      .from(sessionTemplateVersion)
      .where(
        and(
          eq(sessionTemplateVersion.templateId, template.id),
          eq(sessionTemplateVersion.workspaceId, ctx.workspaceId),
        ),
      )

    const next = (highest?.version ?? 0) + 1

    const [version] = await tx
      .insert(sessionTemplateVersion)
      .values({
        workspaceId: ctx.workspaceId,
        templateId: template.id,
        version: next,
        note: input.note ?? null,
      })
      .returning()

    await tx.insert(templateItem).values(
      input.items.map((payload, index) => ({
        workspaceId: ctx.workspaceId,
        versionId: version!.id,
        kind: payload.kind,
        payload,
        position: index * POSITION_STEP,
      })),
    )

    await tx
      .update(sessionTemplate)
      .set({ currentVersion: next })
      .where(
        and(eq(sessionTemplate.id, template.id), eq(sessionTemplate.workspaceId, ctx.workspaceId)),
      )

    return { ...version!, itemCount: input.items.length }
  })
}

/** Narrow a stored jsonb payload back to the union, or reject it loudly. */
function parsePayload(raw: unknown, itemId: string): TemplateItemPayload {
  const parsed = templateItemPayloadSchema.safeParse(raw)
  if (!parsed.success) {
    /**
     * Only reachable if something wrote a payload that bypassed validation.
     * Failing here beats copying a malformed item into a real shoot, where it
     * would surface as a shot with no title days later.
     */
    throw new ValidationError(`Template item ${itemId} has an unreadable payload`, 'items')
  }
  return parsed.data
}

/**
 * Copy a version's contents into a session.
 *
 * Every created row carries `source_template_item_id`, and the session records
 * which template and version it was built from. That provenance is the whole
 * reason copying is not worse than linking: it is what makes a later diff
 * possible without ever touching a shoot that has already happened.
 */
export async function applyTemplate(
  db: Database,
  ctx: TenantContext,
  input: ApplyTemplateInput,
): Promise<{ shots: number; checklistItems: number; version: number }> {
  return withTenant(db, ctx, async (tx) => {
    const template = await findTemplate(tx, ctx.workspaceId, input.templateId)
    if (!template) throw new NotFoundError('Template', input.templateId)

    const wanted = input.version ?? template.currentVersion
    if (wanted === 0) {
      throw new ValidationError('This template has no published version yet', 'templateId')
    }

    const [version] = await tx
      .select()
      .from(sessionTemplateVersion)
      .where(
        and(
          eq(sessionTemplateVersion.templateId, template.id),
          eq(sessionTemplateVersion.version, wanted),
          eq(sessionTemplateVersion.workspaceId, ctx.workspaceId),
        ),
      )
      .limit(1)

    if (!version) throw new NotFoundError('Template version', String(wanted))

    const [session] = await tx
      .select({
        id: shootSession.id,
        shootId: shootSession.shootId,
        deletedAt: shootSession.deletedAt,
      })
      .from(shootSession)
      .where(
        and(eq(shootSession.id, input.sessionId), eq(shootSession.workspaceId, ctx.workspaceId)),
      )
      .limit(1)

    if (!session) throw new NotFoundError('Session', input.sessionId)
    if (session.deletedAt) {
      throw new ValidationError('Cannot apply a template to a deleted session', 'sessionId')
    }

    const items = await tx
      .select()
      .from(templateItem)
      .where(
        and(eq(templateItem.versionId, version.id), eq(templateItem.workspaceId, ctx.workspaceId)),
      )
      .orderBy(asc(templateItem.position))

    const payloads = items.map((item) => ({
      id: item.id,
      payload: parsePayload(item.payload, item.id),
    }))

    // --- shots ------------------------------------------------------------
    const shotItems = payloads.filter(
      (item): item is { id: string; payload: Extract<TemplateItemPayload, { kind: 'shot' }> } =>
        item.payload.kind === 'shot',
    )

    if (shotItems.length > 0) {
      // Append after whatever is already planned rather than renumbering it.
      const [existing] = await tx
        .select({ highest: max(shot.position) })
        .from(shot)
        .where(and(eq(shot.shootId, session.shootId), eq(shot.workspaceId, ctx.workspaceId)))

      const start = (existing?.highest ?? -POSITION_STEP) + POSITION_STEP

      await tx.insert(shot).values(
        shotItems.map((item, index) => ({
          workspaceId: ctx.workspaceId,
          shootId: session.shootId,
          sessionId: session.id,
          title: item.payload.title,
          description: item.payload.description ?? null,
          framing: item.payload.framing ?? null,
          subjects: item.payload.subjects ?? null,
          props: item.payload.props ?? null,
          position: start + index * POSITION_STEP,
          sourceTemplateItemId: item.id,
        })),
      )
    }

    // --- checklist items --------------------------------------------------
    const listItems = payloads.filter(
      (
        item,
      ): item is {
        id: string
        payload: Extract<TemplateItemPayload, { kind: 'checklist_item' }>
      } => item.payload.kind === 'checklist_item',
    )

    let checklistItemCount = 0

    if (listItems.length > 0) {
      /**
       * Group by (name, kind) and reuse a list that already exists on this
       * shoot with the same name and kind.
       *
       * Applying two templates that both want a "Camera bag" should produce
       * one camera bag, not two — the second is the same real bag, and
       * splitting it is how something gets left behind.
       */
      const groups = new Map<
        string,
        {
          name: string
          kind: (typeof listItems)[number]['payload']['checklistKind']
          items: typeof listItems
        }
      >()

      for (const item of listItems) {
        const key = `${item.payload.checklistKind}:${item.payload.checklistName}`
        const group = groups.get(key)
        if (group) group.items.push(item)
        else
          groups.set(key, {
            name: item.payload.checklistName,
            kind: item.payload.checklistKind,
            items: [item],
          })
      }

      for (const group of groups.values()) {
        const [existingList] = await tx
          .select({ id: checklist.id })
          .from(checklist)
          .where(
            and(
              eq(checklist.shootId, session.shootId),
              eq(checklist.workspaceId, ctx.workspaceId),
              eq(checklist.name, group.name),
              eq(checklist.kind, group.kind),
              isNull(checklist.deletedAt),
            ),
          )
          .limit(1)

        let listId = existingList?.id

        if (!listId) {
          const [created] = await tx
            .insert(checklist)
            .values({
              workspaceId: ctx.workspaceId,
              shootId: session.shootId,
              sessionId: session.id,
              name: group.name,
              kind: group.kind,
            })
            .returning({ id: checklist.id })
          listId = created!.id
        }

        const [existingItems] = await tx
          .select({ highest: max(checklistItem.position) })
          .from(checklistItem)
          .where(
            and(
              eq(checklistItem.checklistId, listId),
              eq(checklistItem.workspaceId, ctx.workspaceId),
            ),
          )

        const start = (existingItems?.highest ?? -POSITION_STEP) + POSITION_STEP

        await tx.insert(checklistItem).values(
          group.items.map((item, index) => ({
            workspaceId: ctx.workspaceId,
            checklistId: listId,
            label: item.payload.label,
            quantity: item.payload.quantity ?? 1,
            position: start + index * POSITION_STEP,
            sourceTemplateItemId: item.id,
          })),
        )

        checklistItemCount += group.items.length
      }
    }

    /**
     * Stamp the session last, once the copy has succeeded.
     *
     * Recording "built from v2" before the rows exist would leave a session
     * claiming a provenance it does not have if anything below failed — and
     * the whole transaction rolls back anyway, so the only ordering that can
     * mislead is the one that writes the claim first.
     */
    await tx
      .update(shootSession)
      .set({ appliedTemplateId: template.id, appliedTemplateVersion: version.version })
      .where(and(eq(shootSession.id, session.id), eq(shootSession.workspaceId, ctx.workspaceId)))

    return {
      shots: shotItems.length,
      checklistItems: checklistItemCount,
      version: version.version,
    }
  })
}

/**
 * Turn a session that worked into a template.
 *
 * This is how templates actually get written: nobody authors one from
 * nothing, they finish a shoot, realise they will do it again, and want what
 * they just built.
 */
export async function saveSessionAsTemplate(
  db: Database,
  ctx: TenantContext,
  input: SaveSessionAsTemplateInput,
) {
  return withTenant(db, ctx, async (tx) => {
    const [session] = await tx
      .select({
        id: shootSession.id,
        shootId: shootSession.shootId,
        deletedAt: shootSession.deletedAt,
      })
      .from(shootSession)
      .where(
        and(eq(shootSession.id, input.sessionId), eq(shootSession.workspaceId, ctx.workspaceId)),
      )
      .limit(1)

    if (!session) throw new NotFoundError('Session', input.sessionId)
    if (session.deletedAt) {
      throw new ValidationError('Cannot save a deleted session as a template', 'sessionId')
    }

    const shotRows = await tx
      .select()
      .from(shot)
      .where(
        and(
          eq(shot.sessionId, session.id),
          eq(shot.workspaceId, ctx.workspaceId),
          isNull(shot.deletedAt),
        ),
      )
      .orderBy(asc(shot.position))

    /**
     * Checklists come from the whole shoot, not just this session.
     *
     * A gear list is almost always attached to the shoot rather than the day
     * — that is the default the checklist schema encodes — so taking only the
     * session's own lists would produce a template with a shot list and no
     * kit, which is the half nobody wants to retype.
     */
    const listRows = await tx
      .select({
        id: checklist.id,
        name: checklist.name,
        kind: checklist.kind,
        position: checklist.position,
      })
      .from(checklist)
      .where(
        and(
          eq(checklist.shootId, session.shootId),
          eq(checklist.workspaceId, ctx.workspaceId),
          isNull(checklist.deletedAt),
        ),
      )
      .orderBy(asc(checklist.position))

    const items: TemplateItemPayload[] = shotRows.map((row) => ({
      kind: 'shot' as const,
      title: row.title,
      description: row.description,
      framing: row.framing,
      subjects: row.subjects,
      props: row.props,
    }))

    for (const list of listRows) {
      const lines = await tx
        .select()
        .from(checklistItem)
        .where(
          and(
            eq(checklistItem.checklistId, list.id),
            eq(checklistItem.workspaceId, ctx.workspaceId),
            isNull(checklistItem.deletedAt),
          ),
        )
        .orderBy(asc(checklistItem.position))

      for (const line of lines) {
        items.push({
          kind: 'checklist_item' as const,
          checklistName: list.name,
          checklistKind: list.kind,
          label: line.label,
          quantity: line.quantity,
        })
      }
    }

    if (items.length === 0) {
      throw new ValidationError('This session has no shots or checklist items to save', 'sessionId')
    }

    const [template] = await tx
      .insert(sessionTemplate)
      .values({
        workspaceId: ctx.workspaceId,
        name: input.name,
        shootTypeKey: input.shootTypeKey ?? null,
        notes: input.notes ?? null,
        currentVersion: 1,
      })
      .returning()

    const [version] = await tx
      .insert(sessionTemplateVersion)
      .values({
        workspaceId: ctx.workspaceId,
        templateId: template!.id,
        version: 1,
        note: 'Saved from a session',
      })
      .returning()

    await tx.insert(templateItem).values(
      items.map((payload, index) => ({
        workspaceId: ctx.workspaceId,
        versionId: version!.id,
        kind: payload.kind,
        payload,
        position: index * POSITION_STEP,
      })),
    )

    return { template: template!, version: version!, itemCount: items.length }
  })
}
