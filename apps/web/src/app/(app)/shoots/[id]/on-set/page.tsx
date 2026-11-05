import type { Metadata } from 'next'

import { OnSet } from '~/components/on-set.tsx'

export const metadata: Metadata = { title: 'On set' }

export default async function OnSetPage({ params }: { params: Promise<{ id: string }> }) {
  // `params` is a Promise in Next 16 and must be awaited.
  const { id } = await params

  return <OnSet shootId={id} />
}
