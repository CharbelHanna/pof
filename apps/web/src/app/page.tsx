import Link from 'next/link'

/**
 * Marketing landing page.
 *
 * Lives inside apps/web rather than a separate app: one container, one deploy,
 * one domain, shared design tokens. It is statically generated at build time,
 * so it costs nothing at runtime and needs no shared cache — which is what
 * lets framework caching stay off (see next.config.ts).
 *
 * Deliberately minimal. This is a signup door, not a product site.
 */
export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-16">
      <p className="text-accent-600 text-sm font-medium tracking-widest uppercase">
        Point of Focus
      </p>

      <h1 className="text-ink-950 dark:text-ink-50 mt-4 text-4xl font-semibold text-balance sm:text-5xl">
        Plan the shoot before the shoot.
      </h1>

      <p className="text-ink-700 dark:text-ink-300 mt-6 text-lg text-pretty">
        Campaigns, shoots, sessions and reusable templates — for portrait, editorial, landscape and
        product photographers. Turn a shoot you do often into a one-tap setup.
      </p>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link
          href="/sign-up"
          className="bg-accent-600 hover:bg-accent-500 rounded-lg px-5 py-3 font-medium text-white transition-colors"
        >
          Create an account
        </Link>
        <Link
          href="/sign-in"
          className="border-ink-200 text-ink-900 hover:bg-ink-100 dark:border-ink-700 dark:text-ink-100 dark:hover:bg-ink-900 rounded-lg border px-5 py-3 font-medium transition-colors"
        >
          Sign in
        </Link>
      </div>

      <p className="text-ink-500 mt-12 text-sm">
        Early development — Phase 0.{' '}
        <a
          href="https://github.com/CharbelHanna/pof"
          className="underline underline-offset-4"
          target="_blank"
          rel="noreferrer"
        >
          Source on GitHub
        </a>
      </p>
    </main>
  )
}
