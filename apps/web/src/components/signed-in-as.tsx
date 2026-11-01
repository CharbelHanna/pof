/**
 * Who is signed in.
 *
 * The app showed no account at all: with a test account, a client's account
 * and a real one on the same machine, there was no way to tell which you
 * were acting as short of signing out. Worse, every workspace looks alike —
 * an empty shoot list means "new account", not "wrong account" — so the
 * mistake is silent.
 *
 * The email is what actually identifies the account; names repeat and are
 * optional at the database level. So the email is always rendered, and the
 * name only appears alongside it where there is room.
 *
 * A server component: the layout has already resolved the session, so
 * passing it down costs nothing, and doing this on the client would mean a
 * fetch and a flash of the wrong state on every page.
 */
export function SignedInAs({ name, email }: { name: string; email: string }) {
  /** When no name was given, `name` falls back to the email upstream. */
  const hasDistinctName = name !== email

  return (
    <div className="min-w-0 text-right">
      {hasDistinctName && (
        // Hidden on narrow screens: the header already carries the wordmark
        // and a sign-out control, and three items collide on a 320px phone.
        // The email below is the identifying part, so it is what survives.
        <p className="text-ink-900 dark:text-ink-100 hidden truncate text-sm leading-tight font-medium sm:block">
          {name}
        </p>
      )}
      <p
        className="text-ink-500 max-w-[10rem] truncate text-xs leading-tight sm:max-w-[16rem]"
        // Truncation is a visual compromise; the full address stays
        // available on hover and to assistive technology.
        title={email}
      >
        {email}
      </p>
    </div>
  )
}
