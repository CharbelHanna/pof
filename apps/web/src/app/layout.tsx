import type { Metadata, Viewport } from 'next'

import { Providers } from './providers.tsx'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Point of Focus',
    template: '%s · Point of Focus',
  },
  description:
    'Plan photoshoots properly: campaigns, shoots, sessions and reusable session templates for portrait, editorial, landscape and product photographers.',
}

export const viewport: Viewport = {
  // V1 is phone-browser-first: photographers prepare on the move and use the
  // app on set, so the small viewport is the primary design target.
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
