import { inject } from 'vitest'

/**
 * Connection details for the S3-compatible store that `storage-setup.ts`
 * started.
 *
 * A function rather than a `declare module 'vitest'` augmentation, for the
 * same reason `testDatabaseUrls()` is: suites reference the global setup as a
 * config *string* and never import it, so an augmentation declared there
 * would not apply. One narrow cast here, explained, beats that fragility
 * spread across every suite.
 */
export function testStorage(): {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
} {
  return {
    endpoint: inject('storageEndpoint' as never) as unknown as string,
    bucket: inject('storageBucket' as never) as unknown as string,
    accessKeyId: inject('storageAccessKeyId' as never) as unknown as string,
    secretAccessKey: inject('storageSecretAccessKey' as never) as unknown as string,
  }
}
