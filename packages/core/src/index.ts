export * from './errors.ts'

export { assertWithin, getPlan, PlanLimitExceededError } from './modules/identity/entitlements.ts'
export type { LimitKey, Plan } from './modules/identity/entitlements.ts'

export { findWorkspaceForUser, ensureWorkspaceForUser } from './modules/identity/workspace.ts'

export * as shoots from './modules/planning/shoot.service.ts'
export * as campaigns from './modules/planning/campaign.service.ts'
export * as sessions from './modules/planning/session.service.ts'
export * as shootTypes from './modules/planning/shoot-type.service.ts'
export * as crew from './modules/preparation/crew.service.ts'
export * as gear from './modules/preparation/gear.service.ts'
export * as shots from './modules/preparation/shot.service.ts'
export * as shotGear from './modules/preparation/shot-gear.service.ts'
export * as locations from './modules/places/location.service.ts'
export * as sessionLocations from './modules/places/session-location.service.ts'
export { createPhotonGeocoding } from './adapters/photon-geocoding.ts'
export { createNominatimGeocoding } from './adapters/nominatim-geocoding.ts'

export type { TenantContext, Database } from '@pof/db'

export { createMail, type MailConfig } from './modules/identity/mail.ts'
export { buildResetEmail } from './modules/identity/reset-email.ts'
export * as assets from './modules/assets/asset.service.ts'
export { createS3Storage, type S3StorageOptions } from './adapters/s3-storage.ts'
