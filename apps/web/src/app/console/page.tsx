import { redirect } from 'next/navigation'
import { Console } from '@/components/console/Console'
import { getSessionUser } from '@/server/auth/session'

// Console do analista (Telas 4 e 5). Só para quem entrou com perfil de analista.
export default async function ConsolePage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (user.role !== 'analyst') redirect('/atendimento')
  return <Console analyst={user} />
}
