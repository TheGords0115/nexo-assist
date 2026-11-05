import { KeyRound, Lock, Mail } from 'lucide-react'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/server/auth/session'

// Tela "Meu perfil" do protótipo. Os dados vêm da sessão; a senha é gerenciada pela TI.

export default async function ProfilePage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[420px] px-5 py-10">
        <h1 className="text-[22px] font-semibold">Meu perfil</h1>
        <p className="mt-1 text-[13px] text-muted">Seus dados de acesso ao service desk de TI.</p>

        <div className="mt-6 divide-y divide-line rounded-xl border border-line text-[13px] shadow-sm">
          <div className="flex items-center px-4 py-3.5">
            <span className="w-32 text-muted">Nome</span>
            <span className="font-medium">{user.name}</span>
          </div>
          <div className="flex items-center px-4 py-3.5">
            <span className="w-32 text-muted">E-mail corporativo</span>
            <span className="font-medium">{user.email}</span>
            <span className="ml-auto flex items-center gap-1 text-[11.5px] text-muted">
              <Lock className="h-3 w-3" /> Gerenciado pela TI
            </span>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-line shadow-sm">
          <div className="flex items-center gap-3 px-4 py-3.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-canvas">
              <KeyRound className="h-4 w-4 text-muted" />
            </span>
            <div>
              <p className="text-[13px] font-semibold">Senha</p>
              <p className="text-[11.5px] text-muted">A mesma da rede, do e-mail e da VPN</p>
            </div>
            <a href="#redefinir" className="ml-auto rounded-md border border-line px-3 py-1.5 text-[12px] font-medium hover:bg-canvas">
              Redefinir senha
            </a>
          </div>
          <p className="flex items-center gap-2 bg-canvas px-4 py-2.5 text-[11.5px] text-muted">
            <Mail className="h-3.5 w-3.5" /> Enviaremos um link de redefinição para {user.email}.
          </p>
        </div>
      </div>
    </div>
  )
}
