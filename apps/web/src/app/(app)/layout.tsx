import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'

import { serverEnv } from '@pof/config/env'
import { releaseName } from '@pof/schemas'

import { AppNav } from '~/components/app-nav.tsx'
import { SignOutButton } from '~/components/sign-out-button.tsx'
import { SignedInAs } from '~/components/signed-in-as.tsx'
import { resolveViewer } from '~/lib/session.ts'

/**
 * Authenticated shell.
 *
 * The guard runs on the server for every route in this group, so an
 * unauthenticated visitor never receives the page at all — rather than
 * receiving it and having client JavaScript hide it.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await resolveViewer(await headers())
  if (!viewer) redirect('/sign-in')

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

          <div className="flex min-w-0 items-center gap-3">
            <SignedInAs name={viewer.user.name} email={viewer.user.email} />
            <SignOutButton />
          </div>
        </div>
      </header>

      {/*
        The release, small and out of the way. Present on every page because
        the moment it is wanted is the moment something is wrong, and
        hunting for a settings screen is the wrong thing to be doing then.

        The RELEASE, not the build id: `git describe` output carries a
        commit count, a hash and sometimes `-dirty`, which is exactly what
        /api/version is for and exactly what a client reading a screen
        should not be shown. `-dirty` in particular reads as "broken".
      */}
      <p
        className="text-ink-500 mx-auto max-w-3xl px-5 pt-3 text-right text-xs"
        // The full build id, for anyone who hovers or inspects — so the
        // detail is one gesture away rather than gone.
        title={serverEnv().APP_VERSION}
      >
        {releaseName(serverEnv().APP_VERSION)}
      </p>

      {/* Bottom padding clears the fixed mobile nav bar. */}
      <main className="mx-auto max-w-3xl px-5 py-8 pb-24 sm:pb-8">{children}</main>

      <div className="sm:hidden">
        <AppNav />
      </div>
    </div>
  )
}
