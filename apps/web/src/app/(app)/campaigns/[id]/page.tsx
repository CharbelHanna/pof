import type { Metadata } from 'next'

import { CampaignDetail } from '~/components/campaign-detail.tsx'

export const metadata: Metadata = { title: 'Campaign' }

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  // `params` is a Promise in Next 16 and must be awaited.
  const { id } = await params

  return <CampaignDetail campaignId={id} />
}
