'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

export function Providers({ children }: { children: ReactNode }) {
  /**
   * Created in state, not at module scope: a module-level client would be
   * shared across requests during server rendering and leak one user's cached
   * data into another's response.
   *
   * When workspace switching arrives, every cache key must also include the
   * workspace id — otherwise switching workspace serves the previous tenant's
   * data from cache.
   */
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  )

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
