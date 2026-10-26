import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'

import { AppNav } from '~/components/app-nav.tsx'
import { SignOutButton } from '~/components/sign-out-button.tsx'
import { resolveSession } from '~/lib/session.ts'

/**
 * Authenticated shell.
 *
 * The guard runs on the server for every route in this group, so an
 * unauthenticated visitor never receives the page at all — rather than
 * receiving it and having client JavaScript hide it.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await resolveSession(await headers())
  if (!session) redirect('/sign-in')

  return (
    <div className="min-h-dvh">
      <header className="border-ink-200 dark:border-ink-800 border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-4">
          <Link href="/shoots" className="font-semibold tracking-tight">
            Point of Focus
          </Link>

          <div className="hidden sm:block">
            <AppNav />
          </div>

          <SignOutButton />
        </div>
      </header>

      {/* Bottom padding clears the fixed mobile nav bar. */}
      <main className="mx-auto max-w-3xl px-5 py-8 pb-24 sm:pb-8">{children}</main>

      <div className="sm:hidden">
        <AppNav />
      </div>
    </div>
  )
}
