import { templates } from '@pof/core'
import {
  applyTemplateSchema,
  createTemplateSchema,
  getTemplateSchema,
  listTemplatesSchema,
  listTemplateVersionsSchema,
  publishTemplateVersionSchema,
  saveSessionAsTemplateSchema,
  templateIdSchema,
  updateTemplateSchema,
} from '@pof/schemas'

import { authed } from '../base.ts'

/** Thin adapters over `@pof/core`. See routers/shoot.ts for the pattern. */
export const templateRouter = {
  create: authed
    .route({ method: 'POST', path: '/templates', summary: 'Create a session template' })
    .input(createTemplateSchema)
    .handler(({ input, context }) => templates.createTemplate(context.db, context.tenant, input)),

  list: authed
    .route({ method: 'GET', path: '/templates', summary: 'List session templates' })
    .input(listTemplatesSchema)
    .handler(({ input, context }) => templates.listTemplates(context.db, context.tenant, input)),

  get: authed
    .route({
      method: 'GET',
      path: '/templates/{id}',
      summary: 'Read a template and one version of its contents',
    })
    .input(getTemplateSchema)
    .handler(({ input, context }) => templates.getTemplate(context.db, context.tenant, input)),

  update: authed
    .route({ method: 'PATCH', path: '/templates/{id}', summary: 'Rename or re-genre a template' })
    .input(updateTemplateSchema)
    .handler(({ input, context }) => templates.updateTemplate(context.db, context.tenant, input)),

  delete: authed
    .route({ method: 'DELETE', path: '/templates/{id}', summary: 'Remove a template' })
    .input(templateIdSchema)
    .handler(({ input, context }) =>
      templates.deleteTemplate(context.db, context.tenant, input.id),
    ),

  versions: authed
    .route({
      method: 'GET',
      path: '/templates/{templateId}/versions',
      summary: 'List published versions, newest first',
    })
    .input(listTemplateVersionsSchema)
    .handler(({ input, context }) =>
      templates.listTemplateVersions(context.db, context.tenant, input),
    ),

  /**
   * POST to a collection, not a PATCH of the template: a version is a new
   * resource rather than an edit of an existing one, which is the whole
   * immutability point expressed in the route.
   */
  publish: authed
    .route({
      method: 'POST',
      path: '/templates/{templateId}/versions',
      summary: 'Publish a new version from a complete item list',
    })
    .input(publishTemplateVersionSchema)
    .handler(({ input, context }) =>
      templates.publishTemplateVersion(context.db, context.tenant, input),
    ),

  apply: authed
    .route({
      method: 'POST',
      path: '/templates/{templateId}/apply',
      summary: 'Copy a version into a session',
    })
    .input(applyTemplateSchema)
    .handler(({ input, context }) => templates.applyTemplate(context.db, context.tenant, input)),

  saveSession: authed
    .route({
      method: 'POST',
      path: '/templates/from-session',
      summary: 'Save a session as a new template',
    })
    .input(saveSessionAsTemplateSchema)
    .handler(({ input, context }) =>
      templates.saveSessionAsTemplate(context.db, context.tenant, input),
    ),
}
