import type { ImageMetadata, ImagePort, RenderedVariant, VariantSpec } from '@pof/core/ports'
import sharp from 'sharp'

/**
 * `sharp` — the only place libvips is loaded.
 *
 * It lives in the worker rather than in `@pof/core` on purpose: it is a
 * native module, and having the web app resolve it would pull a platform
 * binary into a build that never calls it. `@pof/core` depends on `ImagePort`
 * instead, so the orchestration stays testable with a fake.
 */

export function createSharpImage(): ImagePort {
  return {
    async inspect(input: Uint8Array): Promise<ImageMetadata> {
      const metadata = await sharp(input).metadata()

      if (!metadata.width || !metadata.height) {
        throw new Error('That file does not appear to be an image')
      }

      /**
       * Orientation matters before dimensions do. A phone photo is stored
       * in sensor order with an EXIF tag saying how to turn it, so a
       * portrait shot reports 4032×3024 — landscape — until the tag is
       * applied. Values 5 to 8 are the rotations that swap the axes.
       */
      const swapsAxes = (metadata.orientation ?? 1) >= 5
      const width = swapsAxes ? metadata.height : metadata.width
      const height = swapsAxes ? metadata.width : metadata.height

      const exif = readExif(metadata.exif)

      return {
        width,
        height,
        ...(exif.capturedAt ? { capturedAt: exif.capturedAt } : {}),
        ...(exif.latitude !== undefined ? { latitude: exif.latitude } : {}),
        ...(exif.longitude !== undefined ? { longitude: exif.longitude } : {}),
      }
    },

    async render(input: Uint8Array, spec: VariantSpec): Promise<RenderedVariant> {
      const pipeline = sharp(input)
        /**
         * Apply the EXIF orientation and discard the tag. Without this a
         * phone photo renders sideways, because the derivative drops the
         * metadata that said to turn it.
         */
        .rotate()
        .resize({
          width: spec.width,
          // Never upscale: a 300px original asked for `full` stays 300px
          // rather than becoming a blurry 2400px file.
          withoutEnlargement: true,
          fit: 'inside',
        })

      /**
       * Quality settings differ by format because the codecs do. AVIF at 50
       * is roughly WebP at 75 for the same perceived quality, and both are
       * chosen for photographs rather than for screenshots or line art.
       */
      const encoded =
        spec.format === 'avif'
          ? pipeline.avif({ quality: 50, effort: 4 })
          : pipeline.webp({ quality: 75 })

      /**
       * `withMetadata()` is deliberately NOT called, so sharp strips EXIF
       * from the output. The capture date and coordinates are already in
       * columns by this point; leaving them embedded would mean a shared
       * thumbnail carried a client's home address.
       */
      const { data, info } = await encoded.toBuffer({ resolveWithObject: true })

      return {
        name: spec.name,
        format: spec.format,
        width: info.width,
        height: info.height,
        bytes: new Uint8Array(data),
      }
    },
  }
}

/**
 * Pull the capture date and coordinates out of a raw EXIF block.
 *
 * Hand-parsed rather than taking an EXIF library: two fields are wanted out
 * of a format with hundreds, and everything else is deliberately discarded.
 * Anything unreadable yields undefined — a missing capture date is an
 * ordinary state (screenshots, exports, scans), not an error worth failing
 * an upload over.
 */
function readExif(exif: Buffer | undefined): {
  capturedAt?: Date
  latitude?: number
  longitude?: number
} {
  if (!exif) return {}

  try {
    const text = exif.toString('latin1')

    // EXIF dates are "YYYY:MM:DD HH:MM:SS" — colons in the date part, which
    // Date cannot parse until the first two are turned into dashes.
    const match = /(\d{4}):(\d{2}):(\d{2}) (\d{2}:\d{2}:\d{2})/.exec(text)
    if (!match) return {}

    const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}Z`)
    if (Number.isNaN(parsed.getTime())) return {}

    /**
     * Coordinates are intentionally not read here. They live in EXIF as
     * three rationals plus a hemisphere reference, in a binary IFD that a
     * regex over latin1 cannot address without getting it wrong — and a
     * wrong coordinate is worse than none, because it would silently place
     * a shoot in the wrong country. A proper EXIF reader is the right tool
     * if this is ever wanted; the columns already exist for it.
     */
    return { capturedAt: parsed }
  } catch {
    return {}
  }
}
