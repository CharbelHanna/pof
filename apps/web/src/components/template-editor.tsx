'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  CHECKLIST_KINDS,
  newId,
  CHECKLIST_KIND_LABELS,
  SHOT_FRAMING_SUGGESTIONS,
  type ChecklistKind,
  type TemplateItemPayload,
} from '@pof/schemas'

import { orpc } from '~/lib/api.ts'
import { useHydrated } from '~/lib/use-hydrated.ts'

/**
 * Edit a template's contents and publish them as a new version.
 *
 * Everything here is a local draft until **Publish** is pressed. That is not a
 * UI convenience — it is how the immutability rule is kept. A published
 * version is never modified, so editing means assembling a complete list and
 * publishing it beside the old one. Sessions already built from the previous
 * version keep exactly what they were given.
 */

/**
 * React keys for draft rows, which never reach the server.
 *
 * `newId()` rather than `crypto.randomUUID()`, and that is not a style
 * preference. `randomUUID` exists only in a secure context — HTTPS or
 * localhost — so on a phone reaching the dev stack at the host's LAN IP over
 * plain http:// it is `undefined`, and calling it throws. That shipped in
 * v0.6.0: adding a checklist to a template crashed the page on a handset
 * while working perfectly on the machine it was written on.
 *
 * `newId()` is uuidv7 over `crypto.getRandomValues`, which carries no such
 * restriction, and it is what the rest of the app already uses.
 */
type DraftShot = {
  key: string
  title: string
  description: string
  framing: string
  subjects: string
  props: string
}

type DraftLine = { key: string; label: string; quantity: number }

type DraftList = { key: string; name: string; kind: ChecklistKind; lines: DraftLine[] }

const emptyShot = (): DraftShot => ({
  key: newId(),
  title: '',
  description: '',
  framing: '',
  subjects: '',
  props: '',
})

/** Move an item one place, without mutating in place. */
function moved<T>(items: T[], index: number, delta: number): T[] {
  const to = index + delta
  if (to < 0 || to >= items.length) return items
  const next = [...items]
  const [item] = next.splice(index, 1)
  next.splice(to, 0, item!)
  return next
}

export function TemplateEditor({
  templateId,
  items,
  onDone,
}: {
  templateId: string
  /** The current version's contents, which the draft starts from. */
  items: { id: string; kind: string; payload: unknown }[]
  /**
   * Called when the editor closes. Carries the version number on a
   * successful publish so the page can confirm it — leaving the editor is
   * otherwise the only sign anything happened, which looks identical to the
   * button having done nothing.
   */
  onDone: (published?: { version: number; itemCount: number }) => void
}) {
  const queryClient = useQueryClient()
  const hydrated = useHydrated()

  /**
   * Seeded once, from the version being edited.
   *
   * Every field of the payload is carried into the draft even where the form
   * below barely shows it, because publishing replaces the whole list. A
   * field the editor forgot would be silently dropped from a template that
   * had it — the kind of loss nobody notices until the next shoot.
   */
  const [shots, setShots] = useState<DraftShot[]>(() =>
    items
      .filter((item) => item.kind === 'shot')
      .map((item) => {
        const payload = item.payload as Partial<DraftShot> & { title: string }
        return {
          key: newId(),
          title: payload.title,
          description: payload.description ?? '',
          framing: payload.framing ?? '',
          subjects: payload.subjects ?? '',
          props: payload.props ?? '',
        }
      }),
  )

  const [lists, setLists] = useState<DraftList[]>(() => {
    const grouped = new Map<string, DraftList>()
    for (const item of items.filter((row) => row.kind === 'checklist_item')) {
      const payload = item.payload as {
        checklistName: string
        checklistKind: ChecklistKind
        label: string
        quantity?: number
      }
      const groupKey = `${payload.checklistKind}:${payload.checklistName}`
      const line = {
        key: newId(),
        label: payload.label,
        quantity: payload.quantity ?? 1,
      }
      const existing = grouped.get(groupKey)
      if (existing) existing.lines.push(line)
      else
        grouped.set(groupKey, {
          key: newId(),
          name: payload.checklistName,
          kind: payload.checklistKind,
          lines: [line],
        })
    }
    return [...grouped.values()]
  })

  const [openShot, setOpenShot] = useState<string | null>(null)
  const [newListName, setNewListName] = useState('')
  const [newListKind, setNewListKind] = useState<ChecklistKind>('gear')
  const [note, setNote] = useState('')

  const publish = useMutation(
    orpc.templates.publish.mutationOptions({
      onSuccess: async (result) => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: orpc.templates.get.key() }),
          queryClient.invalidateQueries({ queryKey: orpc.templates.list.key() }),
        ])
        onDone({ version: result.version, itemCount: result.itemCount })
      },
    }),
  )

  const usableShots = shots.filter((shot) => shot.title.trim().length > 0)
  const usableLists = lists
    .map((list) => ({ ...list, lines: list.lines.filter((line) => line.label.trim().length > 0) }))
    .filter((list) => list.name.trim().length > 0 && list.lines.length > 0)

  const total = usableShots.length + usableLists.reduce((sum, list) => sum + list.lines.length, 0)

  function handlePublish() {
    const payloads: TemplateItemPayload[] = [
      ...usableShots.map((shot) => ({
        kind: 'shot' as const,
        title: shot.title.trim(),
        description: shot.description.trim() || null,
        framing: shot.framing.trim() || null,
        subjects: shot.subjects.trim() || null,
        props: shot.props.trim() || null,
      })),
      ...usableLists.flatMap((list) =>
        list.lines.map((line) => ({
          kind: 'checklist_item' as const,
          checklistName: list.name.trim(),
          checklistKind: list.kind,
          label: line.label.trim(),
          quantity: line.quantity,
        })),
      ),
    ]

    publish.mutate({
      templateId,
      items: payloads,
      ...(note.trim() ? { note: note.trim() } : {}),
    })
  }

  return (
    <div className="space-y-8">
      {/* --- shots ------------------------------------------------------- */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-ink-500 text-xs font-medium tracking-wider uppercase">Shots</h2>
          <button
            type="button"
            onClick={() => {
              const shot = emptyShot()
              setShots((current) => [...current, shot])
              setOpenShot(shot.key)
            }}
            className="text-accent-600 hover:text-accent-500 text-sm transition-colors"
          >
            Add a shot
          </button>
        </div>

        {shots.length > 0 ? (
          <ol className="space-y-2">
            {shots.map((shot, index) => (
              <li
                key={shot.key}
                className="border-ink-200 dark:border-ink-800 rounded-xl border p-3"
              >
                <div className="flex items-center gap-2">
                  <input
                    value={shot.title}
                    onChange={(event) =>
                      setShots((current) =>
                        current.map((row) =>
                          row.key === shot.key ? { ...row, title: event.target.value } : row,
                        ),
                      )
                    }
                    placeholder="Shot title"
                    aria-label={`Shot ${index + 1} title`}
                    className="focus:border-accent-500 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 font-medium outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShots((current) => moved(current, index, -1))}
                    disabled={index === 0}
                    aria-label={`Move shot ${index + 1} up`}
                    className="text-ink-500 px-2 py-1.5 text-sm disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => setShots((current) => moved(current, index, 1))}
                    disabled={index === shots.length - 1}
                    aria-label={`Move shot ${index + 1} down`}
                    className="text-ink-500 px-2 py-1.5 text-sm disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpenShot(openShot === shot.key ? null : shot.key)}
                    aria-expanded={openShot === shot.key}
                    aria-label={`Details for shot ${index + 1}`}
                    className="text-ink-500 hover:text-accent-600 px-2 py-1.5 text-sm transition-colors"
                  >
                    {openShot === shot.key ? 'Less' : 'Details'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setShots((current) => current.filter((row) => row.key !== shot.key))
                    }
                    aria-label={`Remove shot ${index + 1}`}
                    className="text-ink-500 px-2 py-1.5 text-sm transition-colors hover:text-red-600"
                  >
                    Remove
                  </button>
                </div>

                {openShot === shot.key && (
                  <div className="mt-3 grid gap-2 pl-2 sm:grid-cols-2">
                    <DraftField
                      label="Framing"
                      index={index}
                      value={shot.framing}
                      listId="template-framing"
                      onChange={(value) =>
                        setShots((current) =>
                          current.map((row) =>
                            row.key === shot.key ? { ...row, framing: value } : row,
                          ),
                        )
                      }
                    />
                    <DraftField
                      label="Subjects"
                      index={index}
                      value={shot.subjects}
                      onChange={(value) =>
                        setShots((current) =>
                          current.map((row) =>
                            row.key === shot.key ? { ...row, subjects: value } : row,
                          ),
                        )
                      }
                    />
                    <DraftField
                      label="Props"
                      index={index}
                      value={shot.props}
                      onChange={(value) =>
                        setShots((current) =>
                          current.map((row) =>
                            row.key === shot.key ? { ...row, props: value } : row,
                          ),
                        )
                      }
                    />
                    <label className="text-ink-500 block text-xs sm:col-span-2">
                      Description
                      <textarea
                        value={shot.description}
                        rows={2}
                        aria-label={`Description for shot ${index + 1}`}
                        onChange={(event) =>
                          setShots((current) =>
                            current.map((row) =>
                              row.key === shot.key
                                ? { ...row, description: event.target.value }
                                : row,
                            ),
                          )
                        }
                        className={`${controlClass} mt-1`}
                      />
                    </label>
                  </div>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-ink-500 text-sm">No shots yet.</p>
        )}

        <datalist id="template-framing">
          {SHOT_FRAMING_SUGGESTIONS.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      </section>

      {/* --- checklists -------------------------------------------------- */}
      <section className="space-y-3">
        <h2 className="text-ink-500 text-xs font-medium tracking-wider uppercase">Checklists</h2>

        {lists.map((list, listIndex) => (
          <div key={list.key} className="border-ink-200 dark:border-ink-800 rounded-xl border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={list.name}
                onChange={(event) =>
                  setLists((current) =>
                    current.map((row) =>
                      row.key === list.key ? { ...row, name: event.target.value } : row,
                    ),
                  )
                }
                placeholder="List name"
                aria-label={`Checklist ${listIndex + 1} name`}
                className="focus:border-accent-500 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 font-medium outline-none"
              />
              <select
                value={list.kind}
                aria-label={`Checklist ${listIndex + 1} kind`}
                onChange={(event) =>
                  setLists((current) =>
                    current.map((row) =>
                      row.key === list.key
                        ? { ...row, kind: event.target.value as ChecklistKind }
                        : row,
                    ),
                  )
                }
                className="border-ink-200 dark:border-ink-700 dark:bg-ink-900 rounded-md border bg-white px-2 py-1.5 text-sm"
              >
                {CHECKLIST_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {CHECKLIST_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setLists((current) => current.filter((row) => row.key !== list.key))}
                aria-label={`Remove checklist ${listIndex + 1}`}
                className="text-ink-500 px-2 py-1.5 text-sm transition-colors hover:text-red-600"
              >
                Remove list
              </button>
            </div>

            {list.lines.length > 0 && (
              <ul className="divide-ink-200 dark:divide-ink-800 mt-2 divide-y">
                {list.lines.map((line, lineIndex) => (
                  <li key={line.key} className="flex items-center gap-2 py-2">
                    <input
                      value={line.label}
                      onChange={(event) =>
                        setLists((current) =>
                          current.map((row) =>
                            row.key === list.key
                              ? {
                                  ...row,
                                  lines: row.lines.map((existing) =>
                                    existing.key === line.key
                                      ? { ...existing, label: event.target.value }
                                      : existing,
                                  ),
                                }
                              : row,
                          ),
                        )
                      }
                      aria-label={`Checklist ${listIndex + 1} item ${lineIndex + 1}`}
                      className="focus:border-accent-500 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setLists((current) =>
                          current.map((row) =>
                            row.key === list.key
                              ? { ...row, lines: row.lines.filter((l) => l.key !== line.key) }
                              : row,
                          ),
                        )
                      }
                      aria-label={`Remove checklist ${listIndex + 1} item ${lineIndex + 1}`}
                      className="text-ink-500 px-2 py-1 text-sm transition-colors hover:text-red-600"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/*
              One per line, the same as adding items to a real checklist. A
              template's kit list is written in one go from memory, exactly
              like the list it will become.
            */}
            <AddLines
              listIndex={listIndex}
              onAdd={(labels) =>
                setLists((current) =>
                  current.map((row) =>
                    row.key === list.key
                      ? {
                          ...row,
                          lines: [
                            ...row.lines,
                            ...labels.map((label) => ({
                              key: newId(),
                              label,
                              quantity: 1,
                            })),
                          ],
                        }
                      : row,
                  ),
                )
              }
            />
          </div>
        ))}

        <form
          className="grid gap-2 sm:grid-cols-[1fr_auto_auto]"
          onSubmit={(event) => {
            event.preventDefault()
            if (!newListName.trim()) return
            setLists((current) => [
              ...current,
              {
                key: newId(),
                name: newListName.trim(),
                kind: newListKind,
                lines: [],
              },
            ])
            setNewListName('')
          }}
        >
          <input
            value={newListName}
            onChange={(event) => setNewListName(event.target.value)}
            placeholder="Add a checklist — “Camera bag”"
            aria-label="New checklist name"
            className={controlClass}
          />
          <select
            value={newListKind}
            onChange={(event) => setNewListKind(event.target.value as ChecklistKind)}
            aria-label="New checklist kind"
            className={controlClass}
          >
            {CHECKLIST_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {CHECKLIST_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!newListName.trim()}
            className="border-ink-200 dark:border-ink-700 hover:bg-ink-100 dark:hover:bg-ink-900 rounded-lg border px-5 py-2.5 font-medium transition-colors disabled:opacity-60"
          >
            Add list
          </button>
        </form>
      </section>

      {/* --- publish ------------------------------------------------------ */}
      <section className="border-ink-200 dark:border-ink-800 space-y-3 border-t pt-5">
        <label className="text-ink-500 block text-xs">
          What changed (optional)
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Added the winter kit"
            aria-label="What changed"
            className={`${controlClass} mt-1`}
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handlePublish}
            disabled={!hydrated || publish.isPending || total === 0}
            className="bg-accent-600 hover:bg-accent-500 rounded-lg px-5 py-2.5 font-medium text-white transition-colors disabled:opacity-60"
          >
            Publish
          </button>
          <button type="button" onClick={() => onDone()} className="text-ink-500 text-sm">
            Cancel
          </button>
          <span className="text-ink-500 text-xs">
            {total === 0
              ? 'Add at least one shot or checklist item.'
              : `${total} ${total === 1 ? 'item' : 'items'} will be published.`}
          </span>
        </div>

        {/*
          Said before they press it, not after. Publishing creates a version
          rather than overwriting one, and someone expecting an edit to apply
          retroactively should find out here rather than from a shoot that
          did not change.
        */}
        <p className="text-ink-500 text-xs">
          This publishes a new version. Shoots already built from an earlier one keep what they were
          given.
        </p>

        {publish.error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {publish.error.message}
          </p>
        )}
      </section>
    </div>
  )
}

/** One of the smaller shot fields, labelled so it is reachable in a test. */
function DraftField({
  label,
  index,
  value,
  listId,
  onChange,
}: {
  label: string
  index: number
  value: string
  listId?: string
  onChange: (value: string) => void
}) {
  return (
    <label className="text-ink-500 block text-xs">
      {label}
      <input
        value={value}
        list={listId}
        aria-label={`${label} for shot ${index + 1}`}
        onChange={(event) => onChange(event.target.value)}
        className={`${controlClass} mt-1`}
      />
    </label>
  )
}

/** The one-per-line bulk add, matching how real checklists are filled. */
function AddLines({ listIndex, onAdd }: { listIndex: number; onAdd: (labels: string[]) => void }) {
  const [draft, setDraft] = useState('')

  return (
    <form
      className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]"
      onSubmit={(event) => {
        event.preventDefault()
        const labels = draft
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
        if (labels.length === 0) return
        onAdd(labels)
        setDraft('')
      }}
    >
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={2}
        placeholder={'Add items, one per line'}
        aria-label={`Add items to checklist ${listIndex + 1}`}
        className={controlClass}
      />
      <button
        type="submit"
        disabled={draft.trim().length === 0}
        className="border-ink-200 dark:border-ink-700 hover:bg-ink-100 dark:hover:bg-ink-900 h-fit rounded-lg border px-5 py-2.5 font-medium transition-colors disabled:opacity-60"
      >
        Add
      </button>
    </form>
  )
}

const controlClass =
  'border-ink-200 dark:border-ink-700 dark:bg-ink-900 w-full rounded-lg border bg-white px-3 py-2.5 text-base outline-none focus:border-accent-500'
