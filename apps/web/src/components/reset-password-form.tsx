'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { authClient } from '~/lib/auth-client.ts'

/**
 * Choose a new password, using the token from the emailed link.
 *
 * The token arrives as a query parameter. An absent or already-used one is a
 * normal state — people bookmark the page, or follow a link twice — so it is
 * explained rather than treated as an error.
 */
export function ResetPasswordForm() {
  const router = useRouter()
  const params = useSearchParams()
  const token = params.get('token')
  /**
   * Better Auth redirects here with `?error=INVALID_TOKEN` when the link has
   * expired or been used, rather than passing a token through.
   */
  const linkError = params.get('error')

  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    const form = new FormData(event.currentTarget)
    const password = String(form.get('password') ?? '')
    const confirm = String(form.get('confirm') ?? '')

    // Checked here rather than server-side: the server has no second field to
    // compare against, and a mistyped password that silently becomes the real
    // one locks someone out of their own account.
    if (password !== confirm) {
      setError('Those two passwords do not match.')
      return
    }

    setPending(true)

    try {
      const result = await authClient.resetPassword({ newPassword: password, token: token! })

      if (result.error) {
        setError(
          result.error.status === 429
            ? 'Too many attempts. Please wait a moment and try again.'
            : 'That reset link is no longer valid. Request a new one.',
        )
        return
      }

      // Better Auth does not sign you in after a reset, so send them to
      // sign-in rather than to a page that would bounce them there anyway.
      router.push('/sign-in')
      router.refresh()
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setPending(false)
    }
  }

  if (!token || linkError) {
    return (
      <div className="space-y-3" role="status">
        <p className="text-ink-900 dark:text-ink-100 text-sm">
          That reset link is no longer valid.
        </p>
        <p className="text-ink-500 text-sm">
          Links expire after an hour and can only be used once.{' '}
          <a href="/forgot-password" className="text-accent-600 dark:text-accent-400 underline">
            Request a new one
          </a>
          .
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-ink-700 dark:text-ink-300 block text-sm font-medium">
          New password
          <input
            name="password"
            type="password"
            required
            // Matches the server-side minimum in @pof/auth, so the browser
            // catches it before a round trip.
            minLength={12}
            autoComplete="new-password"
            className={inputClass}
            placeholder="At least 12 characters"
          />
        </label>
      </div>

      <div className="space-y-1.5">
        <label className="text-ink-700 dark:text-ink-300 block text-sm font-medium">
          Confirm new password
          <input
            name="confirm"
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            className={inputClass}
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="bg-accent-600 hover:bg-accent-500 w-full rounded-lg px-4 py-3 font-medium text-white transition-colors disabled:opacity-60"
      >
        {pending ? 'Please wait…' : 'Set new password'}
      </button>
    </form>
  )
}

const inputClass =
  'border-ink-200 dark:border-ink-700 dark:bg-ink-900 mt-1.5 w-full rounded-lg border bg-white px-3 py-2.5 text-base outline-none focus:border-accent-500'
