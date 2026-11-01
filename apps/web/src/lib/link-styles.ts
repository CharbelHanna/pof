/**
 * The treatment for a link that names a record in a list.
 *
 * Accent orange, matching the active navigation link and the primary
 * buttons, with the underline-on-hover this app already uses for every text
 * link.
 *
 * An earlier version shifted the colour on hover instead. That was out of
 * step with the rest of the app in two ways, both visible in a survey of it:
 * the only accent hover anywhere is `hover:bg-accent-500` on buttons, which
 * goes *lighter* from 600, and no text link changes colour on hover at all —
 * they underline. `hover:text-accent-*` existed nowhere else.
 *
 * One exported constant rather than a copy per list, because three copies
 * drifting apart is how the inconsistency this replaced came about: each
 * list had `hover:opacity-70`, which faded the whole row, metadata included,
 * rather than responding on the name.
 *
 * The secondary line in each row sets its own `text-ink-500`, so it stays
 * muted and only the name is the link.
 */
export const recordLinkClass = 'text-accent-600 underline-offset-4 hover:underline'
