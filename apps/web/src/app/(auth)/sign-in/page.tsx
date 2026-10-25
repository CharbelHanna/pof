import type { Metadata } from 'next'
import Link from 'next/link'

import { AuthForm } from '~/components/auth-form.tsx'

export const metadata: Metadata = { title: 'Sign in' }

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12">
      <h1 className="text-ink-950 dark:text-ink-50 text-2xl font-semibold">Welcome back</h1>
      <p className="text-ink-500 mt-2 mb-8 text-sm">Sign in to your shoots.</p>

      <AuthForm mode="sign-in" />

      <p className="text-ink-500 mt-6 text-sm">
        No account yet?{' '}
        <Link href="/sign-up" className="text-accent-600 underline underline-offset-4">
          Create one
        </Link>
      </p>
    </main>
  )
}
