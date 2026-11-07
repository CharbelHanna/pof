'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { orpc } from '~/lib/api.ts'
import { useHydrated } from '~/lib/use-hydrated.ts'

/**
 * Template actions for one session: apply one, or save this session as one.
 *
 * Deliberately small and under the session's own details rather than beside
 * the status and delete controls, which are already tight on a phone. These
 * are things you do once while setting a session up, not things you reach for
 * repeatedly.
 */
export function SessionTemplates({
  sessionId,
  sessionName,
}: {
  sessionId: string
  sessionName: string
}) {
  const queryClient = useQueryClient()
  const hydrated = useHydrated()

  const templates = useQuery(
    orpc.templates.list.queryOptions({ input: { limit: 200, includeDeleted: false } }),
  )

  /**
   * Applying writes shots and checklist items, so both of those have to
   * refresh — otherwise the work lands in the database and the page carries
   * on showing what was there before, which reads as nothing having happened.
   */
  const afterApply = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.shots.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.checklists.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.checklistItems.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.sessions.list.key() }),
    ])

  const apply = useMutation(orpc.templates.apply.mutationOptions({ onSuccess: afterApply }))
  const save = useMutation(
    orpc.templates.saveSession.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.templates.list.key() }),
    }),
  )

  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  // Only templates with something published can be applied; one that has been
  // named but never filled in would silently do nothing.
  const usable = (templates.data?.items ?? []).filter((template) => template.currentVersion > 0)

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {usable.length > 0 && (
          <select
            value=""
            aria-label={`Apply a template to ${sessionName}`}
            disabled={!hydrated || apply.isPending}
            onChange={(event) => {
              if (!event.target.value) return
              apply.mutate({ templateId: event.target.value, sessionId })
              // Back to the prompt: the select is an action, not a setting,
              // and leaving it on the last choice implies otherwise.
              event.target.value = ''
            }}
            className="border-ink-200 dark:border-ink-700 dark:bg-ink-900 rounded-md border bg-white px-2 py-1 text-xs disabled:opacity-60"
          >
            <option value="">Apply a template…</option>
            {usable.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        )}

        {!naming && (
          <button
            type="button"
            onClick={() => setNaming(true)}
            aria-label={`Save ${sessionName} as a template`}
            className="text-ink-500 hover:text-accent-600 text-xs transition-colors"
          >
            Save as template
          </button>
        )}
      </div>

      {naming && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (!name.trim()) return
            save.mutate(
              { sessionId, name: name.trim() },
              {
                onSuccess: () => {
                  setName('')
                  setNaming(false)
                },
              },
            )
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Template name"
            aria-label={`Name for the template from ${sessionName}`}
            className="border-ink-200 dark:border-ink-700 dark:bg-ink-900 rounded-md border bg-white px-2 py-1 text-xs"
          />
          <button
            type="submit"
            disabled={!hydrated || save.isPending || !name.trim()}
            className="bg-accent-600 hover:bg-accent-500 rounded-md px-3 py-1 text-xs font-medium text-white transition-colors disabled:opacity-60"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setNaming(false)
              setName('')
            }}
            className="text-ink-500 text-xs"
          >
            Cancel
          </button>
        </form>
      )}

      {/*
        Say what actually happened. "Applied" alone leaves someone scrolling
        to work out whether anything arrived, and a template whose shots were
        all checklist items is a genuinely confusing result otherwise.
      */}
      {apply.data && (
        <p role="status" className="text-accent-600 text-xs">
          Added {apply.data.shots} {apply.data.shots === 1 ? 'shot' : 'shots'} and{' '}
          {apply.data.checklistItems}{' '}
          {apply.data.checklistItems === 1 ? 'checklist item' : 'checklist items'}.
        </p>
      )}

      {save.data && (
        <p role="status" className="text-accent-600 text-xs">
          Saved as “{save.data.template.name}”, with {save.data.itemCount}{' '}
          {save.data.itemCount === 1 ? 'item' : 'items'}.
        </p>
      )}

      {(apply.error ?? save.error) && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {(apply.error ?? save.error)?.message}
        </p>
      )}
    </div>
  )
}
