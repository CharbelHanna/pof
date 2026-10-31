/**
 * The mental model, shown to someone who has not created anything yet.
 *
 * A new account opens on an empty list, which is the moment the structure is
 * least obvious and most worth explaining — "No shoots yet" told nobody what a
 * shoot was for or why sessions exist.
 *
 * Deliberately plain markup rather than a rendered diagram. A drawing library
 * would be roughly a megabyte of JavaScript to paint a picture that never
 * changes, would force this into a client component, and its auto-layout
 * sprawls horizontally — the opposite of what a phone needs. Boxes built from
 * the existing tokens cost nothing, reflow on their own, theme themselves in
 * dark mode, and leave the words as real text that a screen reader can read, a
 * browser can translate and a user can select.
 *
 * It speaks the user's vocabulary, not the schema's: "shoot", not
 * `shoot_session`; "what goes in the bag", not `shoot_gear`. The entity
 * diagram in ARCHITECTURE.md serves the other audience.
 *
 * Only palette steps defined in globals.css are used here. Tailwind silently
 * emits nothing for an undefined one — `text-ink-600` would not fail a build,
 * it would just inherit a colour and look subtly wrong.
 */

/** Vertical rule between tiers. Decorative, so hidden from assistive tech. */
function Connector() {
  return <div aria-hidden="true" className="bg-ink-300 dark:bg-ink-700 mx-auto h-5 w-px" />
}

const parts = [
  {
    name: 'Sessions',
    blurb:
      'When and where you actually shoot. A shoot can have several — a studio day, then a sunrise.',
  },
  {
    name: 'Shots',
    blurb: 'The frames you mean to come away with. Tick them off as you capture them.',
  },
  {
    name: 'Crew and gear',
    blurb: 'Who is coming, and what goes in the bag. Your kit list is reusable across shoots.',
  },
]

export function HowItWorks() {
  return (
    <section
      aria-labelledby="how-it-works-heading"
      className="border-ink-200 dark:border-ink-700 dark:bg-ink-900 mt-6 rounded-xl border bg-white p-5 sm:p-6"
    >
      <h2
        id="how-it-works-heading"
        className="text-ink-900 dark:text-ink-100 text-base font-semibold"
      >
        How Point of Focus fits together
      </h2>
      <p className="text-ink-700 dark:text-ink-300 mt-1 text-sm text-pretty">
        Start with a shoot. Everything else is optional.
      </p>

      <div className="mt-5">
        {/* The optional parent, drawn dashed and muted because it can be skipped. */}
        <div className="border-ink-300 dark:border-ink-700 mx-auto max-w-xs rounded-lg border border-dashed px-4 py-3 text-center">
          <p className="text-ink-900 dark:text-ink-100 text-sm font-medium">
            Campaign <span className="text-ink-500 font-normal">— optional</span>
          </p>
          <p className="text-ink-700 dark:text-ink-300 mt-1 text-xs text-pretty">
            Groups related shoots, like a season or a client project. Skip it if you are planning
            one shoot.
          </p>
        </div>

        <Connector />

        {/* The aggregate root, and the thing to create first — so it carries the accent. */}
        <div className="border-accent-500 bg-accent-500/10 mx-auto max-w-xs rounded-lg border-2 px-4 py-3 text-center">
          <p className="text-ink-900 dark:text-ink-50 text-sm font-semibold">
            Shoot{' '}
            <span className="text-accent-600 dark:text-accent-400 ml-1 text-xs font-medium tracking-wide uppercase">
              start here
            </span>
          </p>
          <p className="text-ink-700 dark:text-ink-300 mt-1 text-xs text-pretty">
            The job itself. Choose a type — portrait, editorial, landscape, product or boudoir — and
            the fields change to match.
          </p>
        </div>

        <Connector />

        {/*
         * What hangs off a shoot.
         *
         * A grid rather than drawn branch lines: keeping three CSS connectors
         * aligned from a 320px phone to a wide desktop is a lot of fragility
         * to buy one flourish, and it is the first thing to break when the
         * wording changes.
         */}
        <ul className="grid gap-3 sm:grid-cols-3">
          {parts.map((part) => (
            <li
              key={part.name}
              className="border-ink-200 dark:border-ink-700 dark:bg-ink-950 rounded-lg border bg-white px-4 py-3"
            >
              <p className="text-ink-900 dark:text-ink-100 text-sm font-medium">{part.name}</p>
              <p className="text-ink-700 dark:text-ink-300 mt-1 text-xs text-pretty">
                {part.blurb}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
