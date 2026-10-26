'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { signIn, signUp } from '~/lib/auth-client.ts'

/**
 * Sign-in / sign-up form.
 *
 * One component for both modes: the fields differ by a name input and the
 * endpoint, and keeping them together stops the two screens drifting apart.
 */
export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const isSignUp = mode === 'sign-up'

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)

    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '')
    const password = String(form.get('password') ?? '')
    const name = String(form.get('name') ?? '')

    try {
      const result = isSignUp
        ? await signUp.email({ email, password, name })
        : await signIn.email({ email, password })

      if (result.error) {
        setError(messageFor(result.error))
        return
      }

      // The workspace is provisioned lazily on the first authenticated request
      // (see lib/session.ts), so there is nothing to wait for here.
      router.push('/shoots')
      router.refresh()
    } catch {
      // Without this, a thrown error (dropped connection, a rate-limit
      // response the client surfaces by throwing) leaves the button stuck on
      // "Please wait…" forever, with nothing explaining why and no way to
      // retry short of reloading the page.
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      // `finally`, not a call on each branch: the success path navigates away,
      // but if that navigation is interrupted the form must not stay disabled.
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {isSignUp && (
        <Field label="Name">
          <input
            name="name"
            type="text"
            required
            autoComplete="name"
            className={inputClass}
            placeholder="Alex Moreau"
          />
        </Field>
      )}

      <Field label="Email">
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className={inputClass}
          placeholder="you@studio.com"
        />
      </Field>

      <Field label="Password">
        <input
          name="password"
          type="password"
          required
          // Matches the server-side minimum in @pof/auth. Keeping them in step
          // means the browser catches it before a round trip.
          minLength={12}
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          className={inputClass}
          placeholder={isSignUp ? 'At least 12 characters' : ''}
        />
      </Field>

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
        {pending ? 'Please wait…' : isSignUp ? 'Create account' : 'Sign in'}
      </button>
    </form>
  )
}

/**
 * Turn an auth error into something a photographer can act on.
 *
 * 429 matters here: Better Auth rate-limits by default when NODE_ENV is
 * production, so a burst of attempts from one address gets throttled. Showing
 * the raw message ("too many requests") reads like a bug rather than something
 * that resolves by waiting.
 */
function messageFor(error: { status?: number; message?: string }): string {
  if (error.status === 429) {
    return 'Too many attempts. Please wait a moment and try again.'
  }
  return error.message ?? 'Something went wrong. Please try again.'
}

const inputClass =
  'border-ink-200 dark:border-ink-700 dark:bg-ink-900 w-full rounded-lg border bg-white px-3 py-2.5 text-base outline-none focus:border-accent-500'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-ink-700 dark:text-ink-300 mb-1.5 block text-sm font-medium">
        {label}
      </span>
      {children}
    </label>
  )
}
