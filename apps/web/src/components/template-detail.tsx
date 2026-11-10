'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { CHECKLIST_KIND_LABELS, type ChecklistKind } from '@pof/schemas'

import { TemplateEditor } from '~/components/template-editor.tsx'
import { orpc } from '~/lib/api.ts'

/**
 * One template, and what is actually in it.
 *
 * The point of this page is answering "what will applying this do to my
 * shoot?" before you find out by doing it.
 *
 * Reading and editing are separate modes rather than inline fields. Contents
 * change only by publishing a complete new version, so a half-finished edit
 * must never be mistaken for the template — the draft lives in
 * `TemplateEditor` and reaches the server once, on publish.
 */
export function TemplateDetail({ templateId }: { templateId: string }) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const [editing, setEditing] = useState(false)

  const { data, isPending, error } = useQuery(
    orpc.templates.get.queryOptions({ input: { id: templateId } }),
  )
  const types = useQuery(orpc.shootTypes.list.queryOptions({ input: {} }))

  const remove = useMutation(
    orpc.templates.delete.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: orpc.templates.list.key() })
        router.push('/templates')
      },
    }),
  )

  if (isPending) return <p className="text-ink-500 text-sm">Loading…</p>
  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        {error.message}
      </p>
    )
  }
  if (!data) return null

  const { template, version, items } = data

  const typeLabel = types.data?.find((type) => type.key === template.shootTypeKey)?.label

  const shots = items.filter((item) => item.kind === 'shot')
  const checklistItems = items.filter((item) => item.kind === 'checklist_item')

  /**
   * Group the checklist lines back into the lists they will become, so the
   * page shows what the shoot will end up with rather than a flat run of
   * forty lines. Applying groups by the same pair.
   */
  const lists = new Map<string, { name: string; kind: ChecklistKind; labels: string[] }>()
  for (const item of checklistItems) {
    const payload = item.payload as {
      checklistName: string
      checklistKind: ChecklistKind
      label: string
    }
    const key = `${payload.checklistKind}:${payload.checklistName}`
    const group = lists.get(key)
    if (group) group.labels.push(payload.label)
    else
      lists.set(key, {
        name: payload.checklistName,
        kind: payload.checklistKind,
        labels: [payload.label],
      })
  }

  return (
    <div className="space-y-8">
      <div>
        <Link href="/templates" className="text-ink-500 text-sm hover:underline">
          ← All templates
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{template.name}</h1>
        <p className="text-ink-500 mt-1 text-sm">
          {typeLabel ?? 'Any type'}
          {version ? ` · Version ${version.version}` : ' · Nothing saved in it yet'}
        </p>
        {template.notes && <p className="mt-3 text-sm">{template.notes}</p>}
      </div>

      {editing ? (
        <TemplateEditor templateId={template.id} items={items} onDone={() => setEditing(false)} />
      ) : !version ? (
        <div className="space-y-3">
          <p className="text-ink-500 text-sm">
            This template has nothing in it yet, so there is nothing to apply. Either fill it in
            here, or open a shoot, find a session worth repeating and choose{' '}
            <strong>Save as template</strong>.
          </p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="bg-accent-600 hover:bg-accent-500 rounded-lg px-5 py-2.5 font-medium text-white transition-colors"
          >
            Add contents
          </button>
        </div>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-ink-500 text-xs font-medium tracking-wider uppercase">
              Shots
              <span className="ml-2 normal-case">{shots.length}</span>
            </h2>
            {shots.length > 0 ? (
              <ol className="divide-ink-200 dark:divide-ink-800 divide-y">
                {shots.map((item) => {
                  const payload = item.payload as {
                    title: string
                    framing?: string | null
                    subjects?: string | null
                    description?: string | null
                  }
                  return (
                    <li key={item.id} className="py-2.5">
                      <p className="font-medium">{payload.title}</p>
                      {(payload.framing ?? payload.subjects) && (
                        <p className="text-ink-500 mt-0.5 text-xs">
                          {[payload.framing, payload.subjects].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      {payload.description && <p className="mt-1 text-sm">{payload.description}</p>}
                    </li>
                  )
                })}
              </ol>
            ) : (
              <p className="text-ink-500 text-sm">No shots in this template.</p>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-ink-500 text-xs font-medium tracking-wider uppercase">
              Checklists
              <span className="ml-2 normal-case">{lists.size}</span>
            </h2>
            {lists.size > 0 ? (
              <div className="space-y-4">
                {[...lists.values()].map((list) => (
                  <div
                    key={`${list.kind}:${list.name}`}
                    className="border-ink-200 dark:border-ink-800 rounded-xl border p-4"
                  >
                    <h3 className="flex items-baseline gap-2 font-medium">
                      {list.name}
                      <span className="text-ink-500 text-xs tracking-wider uppercase">
                        {CHECKLIST_KIND_LABELS[list.kind]}
                      </span>
                    </h3>
                    <ul className="text-ink-500 mt-2 space-y-1 text-sm">
                      {list.labels.map((label, index) => (
                        <li key={`${label}-${index}`}>{label}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-ink-500 text-sm">No checklists in this template.</p>
            )}
          </section>
        </>
      )}

      <div className="flex flex-wrap items-center gap-4">
        {version && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`Edit contents of ${template.name}`}
            className="border-ink-200 dark:border-ink-700 hover:bg-ink-100 dark:hover:bg-ink-900 rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
          >
            Edit contents
          </button>
        )}
        <button
          type="button"
          onClick={() => remove.mutate({ id: template.id })}
          aria-label={`Delete template ${template.name}`}
          className="text-ink-500 text-sm transition-colors hover:text-red-600"
        >
          Delete template
        </button>
        {/*
          Said out loud, because it is the opposite of what people expect
          delete to mean and the reassurance is the whole reason the history
          is kept.
        */}
        <p className="text-ink-500 mt-1 text-xs">
          Shoots already built from this template keep everything they were given.
        </p>
      </div>
    </div>
  )
}
