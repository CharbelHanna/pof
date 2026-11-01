'use client'

import { useState, type FormEvent } from 'react'

import { authClient } from '~/lib/auth-client.ts'

/**
 * Request a password reset link.
 *
 * Always reports success, even for an address with no account. Saying "no
 * such user" would turn this form into a way to test whether someone has an
 * account here — which for a boudoir photographer's client list is a real
 * privacy problem, not a theoretical one. Better Auth behaves the same way
 * server-side; this keeps the UI from leaking what the API deliberately does
 * not.
 */
export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)

    const email = String(new FormData(event.currentTarget).get('email') ?? '')

    try {
      const result = await authClient.requestPasswordReset({
        email,
        /**
         * Where the emailed link lands. Relative, so it resolves against
         * whatever origin the user is actually on — which is what makes this
         * work from a phone on the LAN as well as from localhost.
         */
        redirectTo: '/reset-password',
      })

      // A rejected request still means "we are not telling you whether that
      // address exists", with one exception worth surfacing: rate limiting.
      if (result.error && result.error.status === 429) {
        setError('Too many attempts. Please wait a moment and try again.')
        return
      }

      setSent(true)
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setPending(false)
    }
  }

  if (sent) {
    return (
      <div className="space-y-3" role="status">
        <p className="text-ink-900 dark:text-ink-100 text-sm">
          If that address has an account, a reset link is on its way.
        </p>
        <p className="text-ink-500 text-sm">
          The link stops working in one hour. Check your spam folder if it does not arrive.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-ink-700 dark:text-ink-300 block text-sm font-medium">
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="border-ink-200 dark:border-ink-700 dark:bg-ink-900 focus:border-accent-500 mt-1.5 w-full rounded-lg border bg-white px-3 py-2.5 text-base outline-none"
            placeholder="you@studio.com"
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
        {pending ? 'Please wait…' : 'Send reset link'}
      </button>
    </form>
  )
}
