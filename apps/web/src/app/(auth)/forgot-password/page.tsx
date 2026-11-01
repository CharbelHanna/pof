import type { Metadata } from 'next'
import Link from 'next/link'

import { ForgotPasswordForm } from '~/components/forgot-password-form.tsx'

export const metadata: Metadata = { title: 'Reset your password' }

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12">
      <h1 className="text-ink-950 dark:text-ink-50 text-2xl font-semibold">Reset your password</h1>
      <p className="text-ink-500 mt-2 mb-8 text-sm">
        We will email you a link to choose a new one.
      </p>

      <ForgotPasswordForm />

      <p className="text-ink-500 mt-6 text-sm">
        Remembered it?{' '}
        <Link href="/sign-in" className="text-accent-600 underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </main>
  )
}
