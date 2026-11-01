/**
 * The treatment for a link that names a record in a list.
 *
 * The active navigation link's orange at rest, with the inactive link's
 * hover behaviour: a colour shift, not an opacity fade, and in the direction
 * that increases contrast against the background — darker on a light page,
 * lighter on a dark one. That mirrors how the inactive nav link moves
 * towards `ink-900` in light mode and `ink-100` in dark.
 *
 * `accent-700` was added to the palette for this. The scale stopped at 600,
 * so the only neighbouring step was *lighter* — hovering would have
 * brightened the link exactly when it should feel pressed.
 *
 * One exported string rather than a copy per list, because three copies had
 * already drifted apart: each used `hover:opacity-70`, which faded the whole
 * row, metadata included, instead of responding on the name.
 *
 * The secondary line in each row sets its own `text-ink-500`, so it stays
 * muted and only the name carries the colour.
 */
export const recordLinkClass =
  'text-accent-600 transition-colors hover:text-accent-700 dark:hover:text-accent-400'
