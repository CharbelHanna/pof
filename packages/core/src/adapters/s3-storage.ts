import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import type {
  CreateUploadOptions,
  ObjectMetadata,
  StoragePort,
  UploadTarget,
} from '../ports/storage.ts'

/**
 * S3-compatible storage.
 *
 * One adapter covers AWS S3, Cloudflare R2, Backblaze B2, Wasabi, Hetzner
 * and SeaweedFS (which is what docker-compose runs locally) — they all speak
 * the same API, so moving between them is three environment variables.
 *
 * Azure Blob is NOT in that list, and that is precisely what `StoragePort`
 * is shaped for: `createUploadTarget` returns a described request rather
 * than a URL, so an Azure adapter returns a PUT with a SAS query token and
 * an `x-ms-blob-type` header and satisfies identical client code. Nothing
 * S3-specific may escape this file.
 */

export interface S3StorageOptions {
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  /** Omitted for AWS; set for R2, SeaweedFS and anything self-hosted. */
  endpoint?: string
  /**
   * The host a BROWSER should send to, when that differs from the one this
   * server uses.
   *
   * They differ whenever storage is reachable under two names — which is
   * exactly the case in docker-compose, where the server talks to
   * `http://storage:8333` on the compose network and the browser can only
   * reach `http://localhost:8333` on the host. A presigned URL signs its
   * host, so one signed for the internal name is not merely inconvenient
   * for the browser, it is unusable: the name does not resolve, and even if
   * it did the signature would be for the wrong host.
   *
   * Unset in production, where a bucket has one public endpoint and both
   * sides use it.
   */
  publicEndpoint?: string
  /**
   * MinIO, SeaweedFS and most self-hosted servers address buckets by path
   * (`host/bucket/key`) rather than by subdomain. AWS and R2 do not.
   */
  forcePathStyle?: boolean
}

const DEFAULT_UPLOAD_TTL_SECONDS = 15 * 60

export function createS3Storage(options: S3StorageOptions): StoragePort {
  const client = new S3Client({
    region: options.region,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
    /**
     * Do not add integrity checksums unless the operation requires them.
     *
     * Recent AWS SDK versions default to WHEN_SUPPORTED, which computes a
     * CRC32 at call time and, for a presigned URL, bakes it into the query
     * string — a checksum of the EMPTY body, because at signing time there
     * is no body. The browser then PUTs real bytes, they do not match, and
     * the provider rejects the upload with a 400 that says nothing useful.
     *
     * Found by a test that performs the presigned PUT for real; a mocked
     * SDK would have signed and verified nothing.
     */
    requestChecksumCalculation: 'WHEN_REQUIRED',
    ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    ...(options.forcePathStyle ? { forcePathStyle: true } : {}),
  })

  /**
   * A second client used ONLY for signing, pointed at the browser-facing
   * host. Signing is pure computation — it opens no connection — so this
   * costs nothing when the two endpoints are the same.
   */
  const signingClient =
    options.publicEndpoint && options.publicEndpoint !== options.endpoint
      ? new S3Client({
          region: options.region,
          credentials: {
            accessKeyId: options.accessKeyId,
            secretAccessKey: options.secretAccessKey,
          },
          requestChecksumCalculation: 'WHEN_REQUIRED',
          endpoint: options.publicEndpoint,
          ...(options.forcePathStyle ? { forcePathStyle: true } : {}),
        })
      : client

  return {
    async createUploadTarget(
      key: string,
      uploadOptions: CreateUploadOptions,
    ): Promise<UploadTarget> {
      const ttl = uploadOptions.ttlSeconds ?? DEFAULT_UPLOAD_TTL_SECONDS

      /**
       * `ContentType` is bound into the signature below via
       * `signableHeaders`, so the browser MUST send the identical header or
       * the provider rejects the request. That is the point: it stops a
       * target issued for a JPEG being used to upload something else.
       *
       * `ContentLength` is deliberately NOT signed. Signing it would force
       * the client to know the exact byte count before starting, and a
       * mismatch of one byte fails the whole upload. Size is enforced after
       * the fact in `confirm`, which reads the real size from `head` rather
       * than trusting anything the client says.
       */
      const command = new PutObjectCommand({
        Bucket: options.bucket,
        Key: key,
        ContentType: uploadOptions.mime,
      })

      /**
       * `content-type` has to be named explicitly. By default the presigner
       * signs only `host`, which would leave the content type advisory — a
       * target issued for a JPEG could then be used to upload anything,
       * including HTML that a browser would render from our origin.
       * Signing it means the browser must send exactly this type or the
       * signature fails.
       */
      const url = await getSignedUrl(signingClient, command, {
        expiresIn: ttl,
        signableHeaders: new Set(['content-type']),
      })

      return {
        url,
        method: 'PUT',
        headers: { 'Content-Type': uploadOptions.mime },
        expiresAt: new Date(Date.now() + ttl * 1000),
      }
    },

    async createReadUrl(key: string, ttlSeconds: number): Promise<string> {
      return getSignedUrl(
        signingClient,
        new GetObjectCommand({ Bucket: options.bucket, Key: key }),
        {
          expiresIn: ttlSeconds,
        },
      )
    },

    async get(key: string): Promise<ReadableStream<Uint8Array>> {
      const response = await client.send(new GetObjectCommand({ Bucket: options.bucket, Key: key }))
      if (!response.Body) throw new Error(`No object at ${key}`)

      // `transformToWebStream` keeps the return type a web ReadableStream
      // rather than a Node stream, so the port stays runtime-neutral.
      return response.Body.transformToWebStream()
    },

    async put(
      key: string,
      body: Uint8Array | ReadableStream<Uint8Array>,
      meta: { mime: string },
    ): Promise<void> {
      /**
       * A streamed body needs its length declared up front, and S3 cannot
       * infer it from a stream. The worker writes derivatives it has already
       * rendered into memory, so buffering here is honest rather than
       * wasteful — and it keeps the port's signature from leaking a
       * `ContentLength` the caller would have to compute.
       */
      const bytes = body instanceof Uint8Array ? body : await collect(body)

      await client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: key,
          Body: bytes,
          ContentType: meta.mime,
          ContentLength: bytes.byteLength,
        }),
      )
    },

    async delete(keys: string[]): Promise<void> {
      if (keys.length === 0) return

      // DeleteObjects caps at 1000 keys per request.
      for (let i = 0; i < keys.length; i += 1000) {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: options.bucket,
            Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })) },
          }),
        )
      }
    },

    async head(key: string): Promise<ObjectMetadata | null> {
      try {
        const response = await client.send(
          new HeadObjectCommand({ Bucket: options.bucket, Key: key }),
        )

        return {
          size: response.ContentLength ?? 0,
          mime: response.ContentType ?? 'application/octet-stream',
          etag: response.ETag?.replaceAll('"', '') ?? '',
        }
      } catch (error) {
        /**
         * Absent is a normal answer, not a fault — it is how `confirm`
         * detects an upload that never completed. Only genuine errors
         * propagate.
         */
        if (isNotFound(error)) return null
        throw error
      }
    },
  }
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/**
 * Providers disagree on how a missing object is reported: AWS raises
 * `NotFound`, some return `NoSuchKey`, and others only set the status code.
 * Checking all three keeps a missing file from surfacing as a 500.
 */
function isNotFound(error: unknown): boolean {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  return (
    candidate?.name === 'NotFound' ||
    candidate?.name === 'NoSuchKey' ||
    candidate?.$metadata?.httpStatusCode === 404
  )
}
