'use client'

import { useRouter } from 'next/navigation'

import { signOut } from '~/lib/auth-client.ts'

export function SignOutButton() {
  const router = useRouter()

  return (
    <button
      type="button"
      onClick={async () => {
        await signOut()
        router.push('/sign-in')
        router.refresh()
      }}
      className="text-ink-500 hover:text-ink-900 dark:hover:text-ink-100 text-sm transition-colors"
    >
      Sign out
    </button>
  )
}
