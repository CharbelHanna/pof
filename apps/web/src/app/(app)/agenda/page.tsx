import type { Metadata } from 'next'

import { Agenda } from '~/components/agenda.tsx'

export const metadata: Metadata = { title: 'Agenda' }

export default function AgendaPage() {
  return <Agenda />
}
