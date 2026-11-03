import { z } from 'zod'

/**
 * Asset contracts.
 *
 * An upload is three steps: ask for a target, PUT the bytes straight to
 * storage, then confirm. The bytes never transit our server, which is what
 * keeps a 40MB raw file from occupying a request handler.
 */

export const ASSET_STATUSES = ['pending', 'uploaded', 'ready', 'failed'] as const
export const assetStatusSchema = z.enum(ASSET_STATUSES)
export type AssetStatus = z.infer<typeof assetStatusSchema>

/**
 * What may be uploaded.
 *
 * An allow-list, not a block-list. The browser's reported type is not
 * trustworthy, but it is what the upload target's signature is bound to, so
 * constraining it here constrains what the issued target can be used for.
 *
 * HEIC is included because it is what an iPhone produces by default, and a
 * photographer uploading from a phone is the common case rather than an edge
 * one. SVG is deliberately absent: it is a script-execution vector dressed
 * as an image.
 */
export const ALLOWED_IMAGE_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
  'image/tiff',
] as const

export const assetMimeSchema = z.enum(ALLOWED_IMAGE_MIME)

/**
 * 50MB. Comfortably clears a 45-megapixel raw-converted JPEG or a 16-bit
 * TIFF, while staying far below the point where a browser upload becomes
 * unreliable on a phone connection.
 */
export const MAX_ASSET_BYTES = 50 * 1024 * 1024

const queryNumber = z.coerce.number()
const queryBoolean = z.union([z.boolean(), z.stringbool()])

export const createUploadSchema = z.object({
  /** Client-minted so a retry of the same upload is idempotent. */
  id: z.uuid().optional(),
  mime: assetMimeSchema,
  /**
   * Advisory only — the real size is read back from storage on confirm.
   * Checked here so an over-sized file is refused before the user waits
   * through the upload rather than after.
   */
  bytes: queryNumber.int().positive().max(MAX_ASSET_BYTES).optional(),
  filename: z.string().trim().max(400).optional(),
})
export type CreateUploadInput = z.infer<typeof createUploadSchema>

export const confirmUploadSchema = z.object({ id: z.uuid() })
export type ConfirmUploadInput = z.infer<typeof confirmUploadSchema>

export const listAssetsSchema = z.object({
  status: assetStatusSchema.optional(),
  cursor: z.uuid().optional(),
  limit: queryNumber.int().min(1).max(200).default(100),
  updatedSince: z.coerce.date().optional(),
  includeDeleted: queryBoolean.default(false),
})
export type ListAssetsInput = z.infer<typeof listAssetsSchema>

export const assetIdSchema = z.object({ id: z.uuid() })

// --- derivatives ----------------------------------------------------------
//
// The worker writes `asset.variants` as jsonb; this is the shape it promises
// and the one the UI reads. Declared here rather than inferred from the
// column so a renderer gets a type rather than `unknown`, and so a change to
// what the worker writes breaks at the contract instead of at a blank tile.

export const VARIANT_NAMES = ['thumb', 'grid', 'full'] as const
export const VARIANT_FORMATS = ['avif', 'webp'] as const

export const variantSchema = z.object({
  /** Object key, relative to the bucket. */
  key: z.string(),
  /** Actual rendered size — differs from the requested width for portraits. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().nonnegative(),
})
export type Variant = z.infer<typeof variantSchema>

/**
 * Every level is optional, including the whole map.
 *
 * An asset is `pending` or `uploaded` long before it has derivatives, and a
 * processing failure leaves it with none at all. A schema that demanded them
 * would make the normal in-between states unrepresentable.
 */
export const variantsSchema = z.partialRecord(
  z.enum(VARIANT_NAMES),
  z.partialRecord(z.enum(VARIANT_FORMATS), variantSchema),
)
export type Variants = z.infer<typeof variantsSchema>

/**
 * Read the variants off an asset row, tolerating anything unexpected.
 *
 * `variants` is jsonb, so the database cannot enforce the shape and an older
 * row may predate a change to it. Returning an empty map rather than
 * throwing means a malformed value costs one missing thumbnail, not a failed
 * page render.
 */
export function parseVariants(value: unknown): Variants {
  const result = variantsSchema.safeParse(value)
  return result.success ? result.data : {}
}
