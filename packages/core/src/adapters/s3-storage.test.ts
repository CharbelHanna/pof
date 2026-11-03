import { describe, expect, it } from 'vitest'

import { testStorage } from '../testing/storage.ts'
import { createS3Storage } from './s3-storage.ts'

/**
 * Real storage, not a mocked SDK.
 *
 * The things most likely to be wrong here — whether a presigned PUT accepts
 * the headers we tell the client to send, whether a missing object raises or
 * returns null, whether path-style addressing is needed — are exactly the
 * things a mock would answer the way we expect rather than the way the
 * server does. So this runs against the SeaweedFS container in
 * docker-compose, which speaks the same API as R2 and S3.
 */

const { endpoint, bucket, accessKeyId, secretAccessKey } = testStorage()

const storage = createS3Storage({
  bucket,
  region: 'auto',
  accessKeyId,
  secretAccessKey,
  endpoint,
  forcePathStyle: true,
})

/** Unique per run so parallel workers cannot collide on a key. */
const prefix = `w/test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

describe('createUploadTarget', () => {
  it('issues a target the browser can actually PUT to', async () => {
    const key = `${prefix}/a/upload/original.jpg`
    const target = await storage.createUploadTarget(key, {
      mime: 'image/jpeg',
      maxBytes: 1_000_000,
    })

    expect(target.method).toBe('PUT')
    expect(target.expiresAt.getTime()).toBeGreaterThan(Date.now())

    // The headers are part of the signature, so sending exactly what the
    // target specifies has to work — this is the contract the upload
    // component depends on.
    const response = await fetch(target.url, {
      method: target.method,
      headers: target.headers,
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    })

    expect(response.ok).toBe(true)
  })

  it('rejects a PUT whose content type differs from the signed one', async () => {
    const key = `${prefix}/a/mismatch/original.jpg`
    const target = await storage.createUploadTarget(key, {
      mime: 'image/jpeg',
      maxBytes: 1_000_000,
    })

    /**
     * This is what stops a target issued for a JPEG being reused to upload
     * something else — HTML served from our own origin, say.
     *
     * An earlier version of this test asserted only `response.ok === false`
     * and passed for entirely the wrong reason: every presigned PUT was
     * failing on a checksum bug, so it proved nothing about content types.
     * It now also asserts the matching type SUCCEEDS against the same
     * target, which is what makes the rejection meaningful.
     */
    const wrongType = await fetch(target.url, {
      method: target.method,
      headers: { 'Content-Type': 'text/html' },
      body: '<script>alert(1)</script>',
    })
    expect(wrongType.ok).toBe(false)

    const rightType = await fetch(target.url, {
      method: target.method,
      headers: target.headers,
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    })
    expect(rightType.ok).toBe(true)

    // And nothing was written by the rejected request.
    const meta = await storage.head(key)
    expect(meta?.mime).toBe('image/jpeg')
  })
})

describe('head', () => {
  it('returns null for an object that is not there', async () => {
    // A normal answer, not a fault — it is how confirmUpload detects an
    // upload that never completed.
    await expect(storage.head(`${prefix}/a/missing/original.jpg`)).resolves.toBeNull()
  })

  it('reports the true size, whatever the client claimed', async () => {
    const key = `${prefix}/a/sized/original.jpg`
    const body = new Uint8Array(2048)

    await storage.put(key, body, { mime: 'image/jpeg' })

    const meta = await storage.head(key)
    expect(meta).not.toBeNull()
    expect(meta!.size).toBe(2048)
    expect(meta!.mime).toBe('image/jpeg')
  })
})

describe('put and get', () => {
  it('round-trips bytes unchanged', async () => {
    const key = `${prefix}/a/roundtrip/original.png`
    const body = new Uint8Array([1, 2, 3, 4, 5, 250, 251, 252])

    await storage.put(key, body, { mime: 'image/png' })

    const stream = await storage.get(key)
    const read = await new Response(stream).arrayBuffer()

    expect(new Uint8Array(read)).toEqual(body)
  })

  it('serves a read url that works without credentials', async () => {
    const key = `${prefix}/a/readable/original.png`
    await storage.put(key, new Uint8Array([9, 9, 9]), { mime: 'image/png' })

    const url = await storage.createReadUrl(key, 60)
    const response = await fetch(url)

    expect(response.ok).toBe(true)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([9, 9, 9]))
  })
})

describe('delete', () => {
  it('removes objects and tolerates an empty list', async () => {
    const key = `${prefix}/a/doomed/original.png`
    await storage.put(key, new Uint8Array([1]), { mime: 'image/png' })
    expect(await storage.head(key)).not.toBeNull()

    await storage.delete([key])
    expect(await storage.head(key)).toBeNull()

    // Called by the erase job with whatever it found, which may be nothing.
    await expect(storage.delete([])).resolves.toBeUndefined()
  })
})
