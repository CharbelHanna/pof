import { describe, expect, it } from 'vitest'

import { isTaggedRelease, releaseName } from './version.ts'

/**
 * These pin the exact strings `git describe --tags --always --dirty`
 * produces, because that is the only input this ever gets and getting it
 * wrong shows a user something confusing rather than failing loudly.
 */

describe('releaseName', () => {
  it('passes a clean tag through', () => {
    expect(releaseName('v0.4.0')).toBe('v0.4.0')
  })

  it('drops the commits-past-tag suffix', () => {
    // The commit count and hash are diagnostics; the UI wants the release.
    expect(releaseName('v0.4.0-3-g3c2c4af')).toBe('v0.4.0')
  })

  it('drops the dirty marker too', () => {
    // A client glancing at a screen reads "-dirty" as "broken".
    expect(releaseName('v0.4.0-3-g3c2c4af-dirty')).toBe('v0.4.0')
  })

  it('keeps a prerelease label, which is part of the release', () => {
    // v1.0.0-beta.2 is a release someone chose to cut; -3-gabc1234 is not.
    expect(releaseName('v1.0.0-beta.2')).toBe('v1.0.0-beta.2')
    expect(releaseName('v1.0.0-beta.2-5-gabc1234')).toBe('v1.0.0-beta.2')
  })

  it('tolerates a version with no leading v', () => {
    expect(releaseName('1.2.3-4-gdeadbee')).toBe('1.2.3')
  })

  /**
   * Before the first tag, `--always` yields a bare commit hash. Showing it
   * is honest — there is no release to name, and inventing one would be
   * worse than admitting it.
   */
  it('returns a bare commit hash unchanged', () => {
    expect(releaseName('3c2c4af')).toBe('3c2c4af')
  })

  it('strips the dirty marker from a bare commit too', () => {
    // Before the first tag this is the normal local build id, and `-dirty`
    // reads as "broken" to anyone who is not the person who built it.
    expect(releaseName('3c2c4af-dirty')).toBe('3c2c4af')
  })

  it('returns the unbuilt marker unchanged', () => {
    // A deployed image still saying `dev` means the build argument was
    // never passed, which is worth seeing rather than hiding.
    expect(releaseName('dev')).toBe('dev')
  })
})

describe('isTaggedRelease', () => {
  it('is true only for an exact tag', () => {
    expect(isTaggedRelease('v0.4.0')).toBe(true)
    expect(isTaggedRelease('v1.0.0-beta.2')).toBe(true)
  })

  it('is false once past the tag', () => {
    expect(isTaggedRelease('v0.4.0-3-g3c2c4af')).toBe(false)
    expect(isTaggedRelease('v0.4.0-3-g3c2c4af-dirty')).toBe(false)
  })

  it('is false with no tag at all', () => {
    expect(isTaggedRelease('3c2c4af')).toBe(false)
    expect(isTaggedRelease('dev')).toBe(false)
  })
})
