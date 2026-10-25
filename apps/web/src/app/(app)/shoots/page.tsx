import type { Metadata } from 'next'

import { ShootList } from '~/components/shoot-list.tsx'

export const metadata: Metadata = { title: 'Shoots' }

export default function ShootsPage() {
  return <ShootList />
}
