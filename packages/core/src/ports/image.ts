/**
 * ===========================================================================
 * ImagePort — resizing and metadata, without naming a library.
 * ===========================================================================
 *
 * This port exists for a different reason than StoragePort. Storage is
 * behind a port because providers genuinely differ. Images are behind one
 * because `sharp` is a NATIVE module: it loads libvips, which cannot be
 * bundled for an edge runtime and has no business being resolved by the web
 * app at all.
 *
 * So the implementation lives in `apps/worker`, which is the only process
 * that needs it, and `@pof/core` depends on this interface instead. That
 * keeps the orchestration — what sizes, what order, which statuses, which
 * metadata survives — testable with a fake, and keeps a native binary out of
 * the Next.js build.
 */

/** A derivative to produce. */
export interface VariantSpec {
  /** Stable key used in the `variants` column and in URLs. */
  name: 'thumb' | 'grid' | 'full'
  /** Longest edge, in pixels. Aspect ratio is always preserved. */
  width: number
  format: 'avif' | 'webp'
}

export interface RenderedVariant {
  name: VariantSpec['name']
  format: VariantSpec['format']
  /** Actual dimensions, which differ from the spec for portrait images. */
  width: number
  height: number
  bytes: Uint8Array
}

/**
 * What is worth keeping from the original.
 *
 * Deliberately narrow. A camera file carries serial numbers, owner names,
 * lens history and software fingerprints; none of that belongs in a
 * database, and all of it is a privacy problem once an image is shared. Only
 * the two things photographers actually query are lifted out — when it was
 * taken, and where — and the rest is dropped with the derivatives.
 */
export interface ImageMetadata {
  width: number
  height: number
  /** From EXIF `DateTimeOriginal`, absent for a screenshot or an export. */
  capturedAt?: Date | undefined
  /** From EXIF GPS, absent far more often than present. */
  latitude?: number | undefined
  longitude?: number | undefined
}

export interface ImagePort {
  /** Read dimensions and capture metadata without producing output. */
  inspect(input: Uint8Array): Promise<ImageMetadata>

  /**
   * Produce one derivative.
   *
   * Implementations MUST strip metadata from the output. The capture date
   * and coordinates are already in columns by this point; leaving them
   * embedded would mean a shared thumbnail carried a client's home address.
   *
   * Never upscales: a 300px original asked for a 2400px `full` yields 300px.
   */
  render(input: Uint8Array, spec: VariantSpec): Promise<RenderedVariant>
}
