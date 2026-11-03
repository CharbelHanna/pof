import { assets } from '@pof/core'
import type { StoragePort } from '@pof/core/ports'
import {
  assetIdSchema,
  confirmUploadSchema,
  createUploadSchema,
  listAssetsSchema,
} from '@pof/schemas'
import { ORPCError } from '@orpc/server'

import { authed } from '../base.ts'

/**
 * Thin adapters over `@pof/core`. See routers/shoot.ts for the pattern.
 *
 * Uploads are the one surface that cannot degrade when its port is absent —
 * there is no reduced version of "store this file". So each procedure says
 * so explicitly rather than letting a missing adapter surface as a null
 * dereference three frames deeper.
 */
function requireStorage(storage: StoragePort | undefined): StoragePort {
  if (!storage) {
    throw new ORPCError('SERVICE_UNAVAILABLE', {
      message: 'File storage is not configured',
    })
  }
  return storage
}

export const assetRouter = {
  /**
   * Step one of three. Writes the row, hands back a description of a request
   * the browser can make directly to storage. The bytes never pass through
   * this server.
   */
  createUpload: authed
    .route({ method: 'POST', path: '/assets/upload', summary: 'Begin an upload' })
    .input(createUploadSchema)
    .handler(({ input, context }) =>
      assets.createUpload(context.db, context.tenant, requireStorage(context.storage), input),
    ),

  /**
   * Step three. Verifies with the provider that the object is really there
   * and records its true size — the client's word is not evidence.
   */
  confirmUpload: authed
    .route({ method: 'POST', path: '/assets/{id}/confirm', summary: 'Confirm an upload' })
    .input(confirmUploadSchema)
    .handler(({ input, context }) =>
      assets.confirmUpload(
        context.db,
        context.tenant,
        requireStorage(context.storage),
        input,
        context.jobs,
      ),
    ),

  list: authed
    .route({ method: 'GET', path: '/assets', summary: 'List assets' })
    .input(listAssetsSchema)
    .handler(({ input, context }) => assets.listAssets(context.db, context.tenant, input)),

  /**
   * A short-lived read URL. Not a permanent one: an asset's entitlement is
   * re-checked per request, and a URL that never expired would outlive the
   * membership that justified it.
   */
  readUrl: authed
    .route({ method: 'GET', path: '/assets/{id}/url', summary: 'Get a read URL' })
    .input(assetIdSchema)
    .handler(async ({ input, context }) => ({
      url: await assets.createReadUrl(
        context.db,
        context.tenant,
        requireStorage(context.storage),
        input.id,
      ),
    })),

  delete: authed
    .route({ method: 'DELETE', path: '/assets/{id}', summary: 'Delete an asset' })
    .input(assetIdSchema)
    .handler(({ input, context }) => assets.deleteAsset(context.db, context.tenant, input.id)),
}
