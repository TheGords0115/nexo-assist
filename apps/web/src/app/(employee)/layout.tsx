import { redirect } from 'next/navigation'
import { EmployeeShell } from '@/components/EmployeeShell'
import { getSessionUser } from '@/server/auth/session'

// Área do funcionário (Telas 2, 3 e Meu perfil). Analista que cair aqui vai para o console.

export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (user.role !== 'employee') redirect('/console')
  return <EmployeeShell user={user}>{children}</EmployeeShell>
}
