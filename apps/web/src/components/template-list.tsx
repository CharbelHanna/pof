'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useState } from 'react'
import { newId } from '@pof/schemas'

import { orpc } from '~/lib/api.ts'
import { useHydrated } from '~/lib/use-hydrated.ts'

/**
 * Every template in the workspace.
 *
 * Templates are mostly made by saving a session that worked, from the shoot
 * page — nobody sits down to author one from nothing. This page is where they
 * are looked at afterwards, and where you check what one actually contains
 * before applying it to a job.
 */
export function TemplateList() {
  const queryClient = useQueryClient()
  const hydrated = useHydrated()

  const { data, isPending } = useQuery(
    orpc.templates.list.queryOptions({ input: { limit: 200, includeDeleted: false } }),
  )
  const types = useQuery(orpc.shootTypes.list.queryOptions({ input: {} }))

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: orpc.templates.list.key() })

  const create = useMutation(orpc.templates.create.mutationOptions({ onSuccess: invalidate }))

  const [name, setName] = useState('')
  const [shootTypeKey, setShootTypeKey] = useState('')

  const templates = data?.items ?? []
  const typeLabel = (key: string | null) =>
    types.data?.find((type) => type.key === key)?.label ?? null

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Templates</h1>
        <p className="text-ink-500 mt-2 text-sm">
          A template is the prep you would otherwise rebuild every time — the shot list and the
          checklists a recurring kind of shoot always needs. Most are made by saving a session that
          worked, from the shoot page.
        </p>
      </div>

      <form
        className="grid gap-2 sm:grid-cols-[1fr_auto_auto]"
        onSubmit={(event) => {
          event.preventDefault()
          if (!name.trim()) return
          create.mutate({
            id: newId(),
            name: name.trim(),
            ...(shootTypeKey ? { shootTypeKey } : {}),
          })
          setName('')
        }}
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New template — “Newborn session”"
          aria-label="Template name"
          className={controlClass}
        />
        <select
          value={shootTypeKey}
          onChange={(event) => setShootTypeKey(event.target.value)}
          aria-label="Template shoot type"
          className={controlClass}
        >
          <option value="">Any type</option>
          {(types.data ?? []).map((type) => (
            <option key={type.key} value={type.key}>
              {type.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={!hydrated || create.isPending || !name.trim()}
          className="bg-accent-600 hover:bg-accent-500 rounded-lg px-5 py-2.5 font-medium text-white transition-colors disabled:opacity-60"
        >
          Add template
        </button>
      </form>

      {create.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {create.error.message}
        </p>
      )}

      {isPending ? (
        <p className="text-ink-500 text-sm">Loading…</p>
      ) : templates.length > 0 ? (
        <ul className="divide-ink-200 dark:divide-ink-800 divide-y">
          {templates.map((template) => (
            <li key={template.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/templates/${template.id}`}
                  className="hover:text-accent-600 truncate font-medium transition-colors"
                >
                  {template.name}
                </Link>
                <p className="text-ink-500 mt-0.5 text-xs">
                  {typeLabel(template.shootTypeKey) ?? 'Any type'}
                  {' · '}
                  {/*
                    An empty template is a normal state — named now, filled in
                    later — and saying so plainly beats showing "version 0",
                    which reads like something went wrong.
                  */}
                  {template.currentVersion === 0
                    ? 'Nothing saved in it yet'
                    : `Version ${template.currentVersion}`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-500 text-sm">
          No templates yet. The usual way to make one is to open a shoot, find a session you would
          happily repeat, and choose <strong>Save as template</strong>.
        </p>
      )}
    </div>
  )
}

const controlClass =
  'border-ink-200 dark:border-ink-700 dark:bg-ink-900 w-full rounded-lg border bg-white px-3 py-2.5 text-base outline-none focus:border-accent-500'
