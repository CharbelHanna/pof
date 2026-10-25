import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import type { RouterClient } from '@orpc/server'
import type { AppRouter } from '@pof/api'

/**
 * The typed API client — shared verbatim between the web app and the future
 * Expo app.
 *
 * This package and `@pof/schemas` are the two the mobile build will bundle
 * with Metro, so **nothing here may import a Node builtin at runtime**. Type
 * imports from `@pof/api` are fine: they are erased before bundling. Runtime
 * imports of `fs`, `crypto`, `path` or `Buffer` are not — see the `portable`
 * CI job.
 *
 * Sharing the contract rather than the chrome is the whole strategy: the
 * client, the types and the query keys are identical across platforms; the UI
 * is not.
 */

export type ApiClient = RouterClient<AppRouter>

export interface CreateApiClientOptions {
  /**
   * The RPC endpoint. Either absolute (`https://host/api/rpc`) or
   * origin-relative (`/api/rpc`).
   *
   * A relative value is resolved against the current origin lazily, at
   * request time. It has to be lazy: the underlying link builds a `URL`, which
   * throws on a relative string, and a client component's module scope also
   * executes during server rendering where there is no origin to resolve
   * against. React Native has no `window`, so the Expo client passes an
   * absolute URL and never takes that path.
   */
  url: string
  /**
   * Extra headers per request. The web app relies on cookies and needs none;
   * the Expo client will supply a bearer token read from SecureStore.
   */
  headers?: () => Record<string, string> | Promise<Record<string, string>>
  /**
   * Overridable so React Native can supply its own fetch, and so tests can
   * inject one without a running server.
   */
  fetch?: typeof globalThis.fetch
}

const isAbsolute = (url: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(url)

export function createApiClient(options: CreateApiClientOptions): ApiClient {
  const link = new RPCLink({
    url: () => {
      if (isAbsolute(options.url)) return options.url

      const origin = globalThis.location?.origin
      if (!origin) {
        throw new Error(
          `createApiClient was given the relative URL "${options.url}" but there is no ` +
            `origin to resolve it against. Pass an absolute URL when calling from a ` +
            `non-browser environment.`,
        )
      }

      return new URL(options.url, origin).toString()
    },
    headers: options.headers,
    fetch: options.fetch
      ? (request, init) => options.fetch!(request, init)
      : // Send cookies on same-origin requests — how the web app authenticates.
        (request, init) => globalThis.fetch(request, { ...init, credentials: 'include' }),
  })

  return createORPCClient(link)
}

/**
 * TanStack Query bindings: typed query/mutation options and query keys.
 *
 * Query keys include the workspace implicitly via the server's tenant scoping,
 * but any client-side cache that is keyed manually must include the workspace
 * id — otherwise switching workspace (once teams exist) would serve one
 * tenant's data to another from cache.
 */
export function createApiQueryUtils(client: ApiClient) {
  return createTanstackQueryUtils(client)
}
