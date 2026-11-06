'use client'

import { useEffect, useState } from 'react'

/**
 * Hold the screen awake while a component is mounted.
 *
 * A phone locking itself every thirty seconds is what makes a shot list
 * unusable on set: you put the phone down to adjust something, pick it up,
 * and have to unlock it with cold or wet hands before you can tick anything
 * off. Holding the lock is the difference between a tool you glance at and
 * one you fight.
 *
 * Returns whether the lock is currently held, so the interface can say so.
 * Silence would be worse than a plain "screen will sleep": someone who has
 * been told the screen stays on will put the phone down expecting it to.
 */
export function useWakeLock(enabled = true): { held: boolean; supported: boolean } {
  const [held, setHeld] = useState(false)
  const [supported, setSupported] = useState(false)

  useEffect(() => {
    setSupported('wakeLock' in navigator)
  }, [])

  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return

    let sentinel: WakeLockSentinel | null = null
    let cancelled = false

    const acquire = async () => {
      try {
        sentinel = await navigator.wakeLock.request('screen')
        if (cancelled) {
          void sentinel.release()
          return
        }
        setHeld(true)
        // The browser drops the lock on its own terms — tab hidden, battery
        // saver, a call coming in — and does not say so unless asked.
        sentinel.addEventListener('release', () => setHeld(false))
      } catch {
        /**
         * Rejection is normal rather than exceptional: battery saver and a
         * backgrounded tab both refuse. There is nothing to recover and
         * nothing worth showing an error about — `held` stays false and the
         * interface says the screen will sleep.
         */
        setHeld(false)
      }
    }

    /**
     * Re-acquire when the page becomes visible again. A lock is released
     * automatically whenever the tab is hidden, so without this it survives
     * exactly one glance at another app — which is the moment it was most
     * needed.
     */
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      void sentinel?.release().catch(() => {
        // Already released by the browser; nothing to do.
      })
      setHeld(false)
    }
  }, [enabled])

  return { held, supported }
}
