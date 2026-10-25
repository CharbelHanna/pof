import type { Metadata } from 'next'
import Link from 'next/link'

import { AuthForm } from '~/components/auth-form.tsx'

export const metadata: Metadata = { title: 'Create an account' }

export default function SignUpPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12">
      <h1 className="text-ink-950 dark:text-ink-50 text-2xl font-semibold">Create your account</h1>
      <p className="text-ink-500 mt-2 mb-8 text-sm">Your own workspace is set up automatically.</p>

      <AuthForm mode="sign-up" />

      <p className="text-ink-500 mt-6 text-sm">
        Already have an account?{' '}
        <Link href="/sign-in" className="text-accent-600 underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </main>
  )
}
