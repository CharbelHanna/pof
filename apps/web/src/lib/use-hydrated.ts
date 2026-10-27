'use client'

import { useEffect, useState } from 'react'

/**
 * True once React has hydrated on the client.
 *
 * Forms here submit through an `onSubmit` handler that calls
 * `preventDefault`. Before hydration that handler is not attached, so a click
 * on the submit button performs a NATIVE form submission: the browser
 * navigates, the page reloads, every controlled input resets, and nothing is
 * saved. The user sees their typing vanish with no error.
 *
 * Gating the submit button on this makes the window impossible to hit. It is
 * a narrow window on a fast connection, but it widens on a slow device or
 * under load — and losing what someone just typed is a bad failure.
 *
 * Returns false on the server and on the first client render, which is what
 * keeps the markup identical across both and avoids a hydration mismatch.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
  }, [])

  return hydrated
}
