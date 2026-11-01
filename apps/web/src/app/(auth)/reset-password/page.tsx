import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'

import { ResetPasswordForm } from '~/components/reset-password-form.tsx'

export const metadata: Metadata = { title: 'Choose a new password' }

export default function ResetPasswordPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12">
      <h1 className="text-ink-950 dark:text-ink-50 text-2xl font-semibold">
        Choose a new password
      </h1>
      <p className="text-ink-500 mt-2 mb-8 text-sm">Then sign in with it.</p>

      {/*
        useSearchParams reads the token, which opts this subtree into client
        rendering. Without a Suspense boundary the whole route would be
        forced dynamic at build time.
      */}
      <Suspense fallback={<p className="text-ink-500 text-sm">Loading…</p>}>
        <ResetPasswordForm />
      </Suspense>

      <p className="text-ink-500 mt-6 text-sm">
        <Link href="/sign-in" className="text-accent-600 underline underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </main>
  )
}
