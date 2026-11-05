import { redirect } from 'next/navigation'
import { Logo } from '@/components/Logo'
import { LoginForm } from '@/components/LoginForm'
import { getSessionUser } from '@/server/auth/session'
import { getLoginStats } from '@/server/stats'

// Tela 1 do protótipo: apresentação do Nexo Assist à esquerda, formulário à direita.

export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  const user = await getSessionUser()
  if (user) redirect(user.role === 'analyst' ? '/console' : '/atendimento')
  const stats = await getLoginStats().catch(() => null)

  return (
    <main className="grid min-h-screen lg:grid-cols-[1fr_0.8fr]">
      <section className="relative hidden flex-col justify-between bg-navy px-14 py-12 text-white lg:flex">
        <Logo dark />
        <div className="max-w-xl">
          <p className="text-[13px] text-white/50">Service desk de TI da Nexo</p>
          <h1 className="mt-4 font-serif text-[44px] leading-[1.12] tracking-tight">Seu problema de TI, resolvido em uma conversa.</h1>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/60">
            Descreva o que está acontecendo. O assistente consulta seus chamados, busca na central de ajuda e chama um analista quando precisa.
          </p>
          <div className="mt-10 ml-16 max-w-sm rounded-xl bg-white/[0.06] p-4 ring-1 ring-white/10">
            <div className="ml-auto w-fit rounded-lg bg-white px-3 py-2 text-[12.5px] text-ink">Meu notebook não conecta na VPN. Erro 809.</div>
            <p className="mt-3 text-[11px] text-white/50">
              <span className="font-semibold text-white/80">Nexo Assist</span> consultou seus chamados · criou um chamado
            </p>
            <div className="mt-1.5 w-fit max-w-[85%] rounded-lg bg-white/10 px-3 py-2 text-[12.5px] text-white/85">
              Pronto: abri o chamado com prioridade alta. Um analista fala com você em até 4 h úteis.
            </div>
            <div className="mt-2 flex w-fit items-center gap-2 rounded-md bg-white px-2.5 py-1 text-[11px] text-ink">
              <span className="h-1.5 w-1.5 rounded-full bg-warn" />
              <span className="font-semibold">INC-20517</span>
              <span className="text-muted">Rede e VPN · Alta · em até 4 h</span>
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-3 border-t border-white/10 pt-6">
          <Stat value={stats?.avgFirstResponseSec != null ? `${stats.avgFirstResponseSec} s` : '—'} label="primeira resposta, em média" />
          <Stat value={stats?.resolvedWithoutQueuePct != null ? `${stats.resolvedWithoutQueuePct}%` : '—'} label="resolvidos sem fila" />
          <Stat value={String(stats?.conversationsToday ?? 0)} label="conversas hoje" dot />
        </dl>
      </section>

      <section className="flex flex-col px-6 py-8 sm:px-12">
        <div className="flex items-center justify-between">
          <div className="lg:hidden">
            <Logo />
          </div>
          <p className="ml-auto text-[12.5px] text-muted">
            Problema para entrar? <span className="font-semibold text-brand">Ligue no ramal 4000</span>
          </p>
        </div>
        <div className="mx-auto flex w-full max-w-[340px] flex-1 flex-col justify-center py-10">
          <h2 className="font-serif text-[32px] text-ink">Entrar</h2>
          <p className="mt-1 text-[13.5px] text-muted">Use seu e-mail corporativo e a senha da rede Nexo.</p>
          <LoginForm />
        </div>
        <div className="flex justify-between text-[11.5px] text-faint">
          <span>© 2026 Nexo · Service desk de TI</span>
          <span>Privacidade e uso de dados</span>
        </div>
      </section>
    </main>
  )
}

function Stat({ value, label, dot = false }: { value: string; label: string; dot?: boolean }) {
  return (
    <div className="border-l border-white/10 pl-5 first:border-0 first:pl-0">
      <dt className="flex items-center gap-1.5 font-serif text-[26px]">
        {value}
        {dot && <span className="h-1.5 w-1.5 rounded-full bg-ok" />}
      </dt>
      <dd className="text-[12px] text-white/50">{label}</dd>
    </div>
  )
}
