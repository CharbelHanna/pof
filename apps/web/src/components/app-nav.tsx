'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Primary navigation.
 *
 * Mobile-first: on a phone this is a bottom bar, because that is where a
 * thumb is when you are holding a camera in the other hand. It becomes an
 * inline row in the header at larger sizes.
 */
const LINKS = [
  { href: '/shoots', label: 'Shoots' },
  { href: '/campaigns', label: 'Campaigns' },
  { href: '/agenda', label: 'Agenda' },
] as const

export function AppNav() {
  const pathname = usePathname()

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  return (
    <nav
      aria-label="Primary"
      className="border-ink-200 dark:border-ink-800 dark:bg-ink-950 fixed inset-x-0 bottom-0 z-10 flex border-t bg-white sm:static sm:gap-1 sm:border-0 sm:bg-transparent dark:sm:bg-transparent"
    >
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={isActive(link.href) ? 'page' : undefined}
          className={[
            'flex-1 px-3 py-3 text-center text-sm font-medium transition-colors sm:flex-none sm:rounded-lg sm:py-1.5',
            isActive(link.href)
              ? 'text-accent-600 sm:bg-ink-100 dark:sm:bg-ink-900'
              : 'text-ink-500 hover:text-ink-900 dark:hover:text-ink-100',
          ].join(' ')}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  )
}
