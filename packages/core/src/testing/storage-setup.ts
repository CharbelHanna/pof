import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import type { TestProject } from 'vitest/node'

/**
 * Spins up one real S3-compatible store for the whole run.
 *
 * The same reasoning as the Postgres setup next door: Testcontainers needs no
 * vendor account, behaves identically on a laptop and in CI, and keeps the
 * test story as portable as the deployment story. It also means `pnpm test`
 * works for someone who has never run docker-compose.
 *
 * This matters more than it might look. The storage tests exist precisely to
 * catch what a mocked SDK cannot — whether a presigned PUT accepts the
 * headers we tell the client to send, whether a missing object raises or
 * returns null. Pointing them at a compose container would make them pass
 * locally and fail in CI, where only Postgres is started; pointing them at a
 * mock would make them pass everywhere and prove nothing.
 *
 * SeaweedFS rather than MinIO for the same reason docker-compose uses it:
 * MinIO's images were pulled from Docker Hub in September 2026.
 */

const ACCESS_KEY = 'pofdev'
const SECRET_KEY = 'pofdevsecret'
const BUCKET = 'pof-assets'
const S3_PORT = 8333

let container: StartedTestContainer | undefined

export default async function setup({ provide }: TestProject) {
  const identities = JSON.stringify({
    identities: [
      {
        name: 'pof-test',
        credentials: [{ accessKey: ACCESS_KEY, secretKey: SECRET_KEY }],
        actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'],
      },
    ],
  })

  container = await new GenericContainer('chrislusf/seaweedfs:latest')
    .withCopyContentToContainer([
      { content: identities, target: '/etc/seaweedfs/s3-identities.json' },
    ])
    .withCommand([
      'server',
      '-dir=/data',
      '-s3',
      `-s3.port=${S3_PORT}`,
      '-s3.config=/etc/seaweedfs/s3-identities.json',
    ])
    .withExposedPorts(S3_PORT)
    /**
     * 403 counts as ready. Anonymous requests are denied once identities are
     * configured, so demanding a 2xx would wait forever — the same trap the
     * compose healthcheck documents.
     */
    .withWaitStrategy(
      Wait.forHttp('/', S3_PORT).forStatusCodeMatching((code) => code === 200 || code === 403),
    )
    .start()

  const endpoint = `http://${container.getHost()}:${container.getMappedPort(S3_PORT)}`

  /**
   * Create the bucket here rather than in each suite. A fresh container has
   * none, and leaving it to suites means every new storage test starts by
   * rediscovering that — and racing its neighbours to do it, since Vitest
   * runs files in parallel workers.
   */
  const client = new S3Client({
    region: 'auto',
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
    endpoint,
    forcePathStyle: true,
  })
  try {
    await client.send(new CreateBucketCommand({ Bucket: BUCKET }))
  } finally {
    client.destroy()
  }

  provide('storageEndpoint' as never, endpoint as never)
  provide('storageBucket' as never, BUCKET as never)
  provide('storageAccessKeyId' as never, ACCESS_KEY as never)
  provide('storageSecretAccessKey' as never, SECRET_KEY as never)

  return async () => {
    await container?.stop()
  }
}
