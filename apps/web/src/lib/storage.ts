import 'server-only'

import { serverEnv } from '@pof/config/env'
import { createS3Storage } from '@pof/core'
import type { StoragePort } from '@pof/core/ports'

let instance: StoragePort | undefined

/**
 * The configured object store, built once per process.
 *
 * Not per request: the S3 client maintains a connection pool and resolves
 * credentials once, so rebuilding it per upload would add a handshake to
 * every file.
 *
 * One adapter serves every deployment this app targets — SeaweedFS in
 * docker-compose, R2, S3, B2, Wasabi — because they speak the same API.
 * Switching between them is `STORAGE_ENDPOINT` and credentials, with no code
 * change. Azure Blob is the exception and needs its own adapter, which is
 * exactly what `StoragePort` is shaped to make possible.
 */
export function getStorage(): StoragePort {
  if (!instance) {
    const env = serverEnv()

    instance = createS3Storage({
      bucket: env.STORAGE_BUCKET,
      region: env.STORAGE_REGION,
      accessKeyId: env.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
      /**
       * Absent for AWS, which derives the host from the region. Present for
       * everything else, including the local container.
       */
      ...(env.STORAGE_ENDPOINT ? { endpoint: env.STORAGE_ENDPOINT } : {}),
      /**
       * SeaweedFS and MinIO address buckets by path; AWS and R2 by
       * subdomain. Getting this wrong surfaces as a confusing DNS failure
       * rather than a storage error, which is why it is configuration
       * rather than a guess.
       */
      forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
    })
  }

  return instance
}
