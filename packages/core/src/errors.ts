/**
 * Domain errors.
 *
 * Thrown by services in `@pof/core`, which knows nothing about HTTP. The oRPC
 * adapter layer maps these to status codes, so the same service is reusable
 * from a server component, the worker, or a future public API without each
 * growing its own error handling.
 */

export class NotFoundError extends Error {
  constructor(resource: string, id?: string) {
    super(id ? `${resource} ${id} not found` : `${resource} not found`)
    this.name = 'NotFoundError'
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'Not permitted') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message)
    this.name = 'ValidationError'
  }
}
