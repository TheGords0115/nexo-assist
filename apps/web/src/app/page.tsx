import { redirect } from 'next/navigation'
import { getSessionUser } from '@/server/auth/session'

// Raiz: manda cada perfil para a sua área.
export default async function Home() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  redirect(user.role === 'analyst' ? '/console' : '/atendimento')
}
