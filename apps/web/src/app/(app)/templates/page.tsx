import type { Metadata } from 'next'

import { TemplateList } from '~/components/template-list.tsx'

export const metadata: Metadata = { title: 'Templates' }

export default function TemplatesPage() {
  return <TemplateList />
}
