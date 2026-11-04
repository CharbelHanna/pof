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
 * The release portion: `v0.4.0-3-g3c2c4af-dirty` becomes `v0.4.0`.
 *
 * Anything that is not a recognisable version is returned unchanged rather
 * than hidden. Before the first tag exists the build id is a bare commit
 * hash, and showing that is honest — there is no release to name yet, and
 * inventing one would be worse than admitting it.
 */
export function releaseName(buildId: string): string {
  const trimmed = buildId.trim()

  const match = /^(v?\d+\.\d+\.\d+(?:-[A-Za-z][\dA-Za-z.]*)?)/.exec(trimmed)
  if (match?.[1]) return match[1]

  /**
   * No tag yet, so the build id is a bare commit — possibly with `-dirty`
   * appended. The hash is worth showing; the dirty marker is a build-time
   * detail that belongs in diagnostics, and a client reading it on a
   * screen hears "broken".
   */
  return trimmed.replace(/-dirty$/, '')
}

/**
 * Whether this build is exactly a tagged release.
 *
 * `git describe` appends a commit count and hash the moment you are past
 * the tag, so the absence of that suffix is the signal. Used to decide
 * whether the interface may claim a clean version at all.
 */
export function isTaggedRelease(buildId: string): boolean {
  return /^v?\d+\.\d+\.\d+(?:-[A-Za-z][\dA-Za-z.]*)?$/.test(buildId.trim())
}
