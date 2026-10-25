/**
 * ===========================================================================
 * StoragePort — the file that decides whether Azure Blob is an adapter or a
 * rewrite.
 * ===========================================================================
 *
 * Deliberately expressed in terms of INTENT ("give me somewhere to upload
 * to"), never in S3 vocabulary. `PutObjectCommand`, SigV4, or a bare presigned
 * PUT URL must not appear in this interface, in `@pof/core`, or in any React
 * component. The moment they do, S3 stops being one implementation and starts
 * being the design.
 *
 * Why that matters concretely: S3, R2, MinIO, Backblaze B2 and Wasabi all
 * speak the S3 API, but **Azure Blob does not**. The whole point of the shape
 * below is that an Azure adapter is ~80 lines rather than a refactor of the
 * upload pipeline.
 *
 * The trick is `createUploadTarget` returning a *description of a request*
 * rather than a URL:
 *   - S3/R2 return a PUT with SigV4 headers
 *   - Azure returns a PUT with a SAS token in the query string and an
 *     `x-ms-blob-type` header
 *   - a future presigned-POST flow returns form `fields`
 * All three satisfy the same client code: issue `method` to `url` with
 * `headers`, optionally as multipart with `fields`.
 *
 * Nothing implements this yet — uploads are Phase 2. It exists now because
 * defining it later, after components have already grown S3-shaped
 * assumptions, is exactly the mistake it prevents.
 */

export interface UploadTarget {
  /** Where the client sends the bytes. Opaque — never parsed by callers. */
  url: string
  /** Usually PUT; presigned-POST flows use POST. */
  method: 'PUT' | 'POST'
  /** Headers the client must send verbatim for the signature to validate. */
  headers: Record<string, string>
  /** Multipart form fields, for providers that use presigned POST. */
  fields?: Record<string, string>
  /** After this instant the target is rejected and must be re-requested. */
  expiresAt: Date
}

export interface ObjectMetadata {
  size: number
  mime: string
  etag: string
}

export interface CreateUploadOptions {
  mime: string
  /** Enforced by the adapter where the provider supports it. */
  maxBytes: number
  ttlSeconds?: number
}

export interface StoragePort {
  /**
   * Describe a request the client can make to upload bytes directly, so large
   * files never transit our server.
   *
   * The caller is responsible for the security decision: keys embed
   * `workspaceId`, and the asset row must already exist and have been checked
   * through `withTenant` before a target is issued. Row-level security does
   * not protect a bucket — a guessable or leaked key is an unscoped read.
   */
  createUploadTarget(key: string, options: CreateUploadOptions): Promise<UploadTarget>

  /** Time-limited read URL, for private objects not served via the CDN. */
  createReadUrl(key: string, ttlSeconds: number): Promise<string>

  /** Server-side read, used by the worker's image pipeline. */
  get(key: string): Promise<ReadableStream<Uint8Array>>

  /** Server-side write, used by the worker to store derivatives. */
  put(
    key: string,
    body: Uint8Array | ReadableStream<Uint8Array>,
    meta: { mime: string },
  ): Promise<void>

  /** Batch delete. Used by workspace deletion and the GDPR erase job. */
  delete(keys: string[]): Promise<void>

  /** Existence and size check without transferring the object. */
  head(key: string): Promise<ObjectMetadata | null>
}
