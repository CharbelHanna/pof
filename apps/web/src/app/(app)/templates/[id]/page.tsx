import type { Metadata } from 'next'

import { TemplateDetail } from '~/components/template-detail.tsx'

export const metadata: Metadata = { title: 'Template' }

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  // `params` is a Promise in Next 16 and must be awaited.
  const { id } = await params

  return <TemplateDetail templateId={id} />
}
