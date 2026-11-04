/**
 * Turn a build identifier into something worth showing a user.
 *
 * The build id is whatever `git describe --tags --always --dirty` produced,
 * which is deliberately detailed:
 *
 *   v0.4.0                    exactly on the tag
 *   v0.4.0-3-g3c2c4af         three commits past it
 *   v0.4.0-3-g3c2c4af-dirty   ...with uncommitted changes
 *   3c2c4af                   no tags in the repository yet
 *   dev                       no build argument was passed
 *
 * All of that belongs in `/api/version`, where someone is diagnosing
 * something. In the interface it is noise — and worse, a client glancing at
 * a screen reads `-dirty` as "broken". So the UI shows the release and the
 * API keeps the detail.
 */

/**
 * A semver-ish tag, optionally with a prerelease label: `v1.0.0-beta.2`.
 *
 * The label is part of the release — someone chose to cut `beta.2` — which
 * is why it is kept while `-3-g3c2c4af` is not.
 */
const TAG = String.raw`v?\d+\.\d+\.\d+(?:-[A-Za-z][\dA-Za-z.]*)?`

/**
 * Strip the `--dirty` suffix, reporting whether it was there.
 *
 * This has to happen BEFORE the tag is parsed, because `-dirty` is
 * structurally indistinguishable from a prerelease label: on an exact tag
 * with uncommitted changes `git describe` emits `v0.4.0-dirty`, and the
 * prerelease branch of the pattern above matches `-dirty` perfectly happily.
 * Parsing first would therefore show `v0.4.0-dirty` on screen and call it a
 * clean release — both of which are the opposite of the truth.
 */
function undirty(buildId: string): { value: string; dirty: boolean } {
  const value = buildId.trim()
  return value.endsWith('-dirty')
    ? { value: value.slice(0, -'-dirty'.length), dirty: true }
    : { value, dirty: false }
}

/**
 * The release portion: `v0.4.0-3-g3c2c4af-dirty` becomes `v0.4.0`.
 *
 * Anything that is not a recognisable version is returned unchanged rather
 * than hidden. Before the first tag exists the build id is a bare commit
 * hash, and showing that is honest — there is no release to name yet, and
 * inventing one would be worse than admitting it.
 */
export function releaseName(buildId: string): string {
  // The dirty marker never reaches a screen: a client glancing at a header
  // reads it as "broken". It survives in the full build id, which is what
  // /api/version and the element's `title` are for.
  const { value } = undirty(buildId)

  return new RegExp(`^(${TAG})`).exec(value)?.[1] ?? value
}

/**
 * Whether this build is exactly a tagged release.
 *
 * `git describe` appends a commit count and hash the moment you are past the
 * tag, so the absence of that suffix is the signal. A dirty tree disqualifies
 * it too: the tag names a commit, and this build contains something that
 * commit does not.
 */
export function isTaggedRelease(buildId: string): boolean {
  const { value, dirty } = undirty(buildId)
  return !dirty && new RegExp(`^${TAG}$`).test(value)
}
