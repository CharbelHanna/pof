import type { Metadata } from 'next'

import { ShootDetail } from '~/components/shoot-detail.tsx'

export const metadata: Metadata = { title: 'Shoot' }

export default async function ShootPage({ params }: { params: Promise<{ id: string }> }) {
  // `params` is a Promise in Next 16 and must be awaited.
  const { id } = await params

  return <ShootDetail shootId={id} />
}
