import type { Employee, Ticket } from '@nexo/domain'
import { migrate, upsertTicket, type Db } from './db'

/**
 * Dados de exemplo (Anexo B). As datas são relativas ao momento do seed, para que os cenários
 * continuem válidos em qualquer dia: um chamado vencido, um resolvido há poucos dias (pode reabrir),
 * um resolvido há muito tempo (não pode) e chamados de outros funcionários (privacidade).
 */
export const EMPLOYEES: Employee[] = [
  { id: 'emp-ana', name: 'Ana Souza', email: 'ana.souza@nexo.com.br', role: 'employee', department: 'Financeiro', device: 'Notebook Dell Latitude, Windows 11' },
  { id: 'emp-carla', name: 'Carla Mendes', email: 'carla.mendes@nexo.com.br', role: 'employee', department: 'Comercial', device: 'Notebook Lenovo ThinkPad, Windows 10' },
  { id: 'emp-bruno', name: 'Bruno Tavares', email: 'bruno.tavares@nexo.com.br', role: 'employee', department: 'Marketing', device: 'MacBook Air, macOS' },
  { id: 'emp-diego', name: 'Diego Ramos', email: 'diego.ramos@nexo.com.br', role: 'employee', department: 'Logística', device: 'Desktop HP, Windows 10' },
  { id: 'ana-rafael', name: 'Rafael Lima', email: 'rafael.lima@nexo.com.br', role: 'analyst', department: 'Service Desk', device: '-', supportLevel: 'N2' },
  { id: 'ana-julia', name: 'Julia Castro', email: 'julia.castro@nexo.com.br', role: 'analyst', department: 'Service Desk', device: '-', supportLevel: 'N1' },
]

const DAY = 24 * 60 * 60 * 1000
const ago = (now: Date, days: number, hours = 0) => new Date(now.getTime() - days * DAY - hours * 3600000).toISOString()

export function buildTickets(now: Date): Ticket[] {
  const t = (partial: Omit<Ticket, 'updates' | 'resolvedAt' | 'assignedQueue'> & Partial<Pick<Ticket, 'resolvedAt' | 'assignedQueue' | 'updates'>>): Ticket => ({
    resolvedAt: null,
    assignedQueue: 'N1',
    updates: [],
    ...partial,
  })
  return [
    // Ana: um vencido, um em andamento, uma requisição aprovada, um resolvido recente e um antigo.
    t({
      id: 'INC-20311', type: 'INC', title: 'Notebook lento após atualização do Windows',
      description: 'Lentidão geral desde a atualização de 15/10. Reiniciar e rodar o diagnóstico da central não resolveu.',
      category: 'Hardware', priority: 'Média', status: 'Aguardando analista', requesterId: 'emp-ana',
      affected: 'Somente a solicitante', createdAt: ago(now, 20), lastActivityAt: ago(now, 6),
      updates: [{ at: ago(now, 6), author: 'Julia Castro', note: 'Coletados logs de desempenho. Aguardando análise do Suporte N1.' }],
    }),
    t({
      id: 'INC-20298', type: 'INC', title: 'Acesso à pasta Financeiro no SharePoint',
      description: 'Sem permissão de leitura na pasta Financeiro/Fechamento desde a troca de equipe.',
      category: 'Acesso', priority: 'Média', status: 'Em andamento', requesterId: 'emp-ana',
      affected: 'Somente a solicitante', createdAt: ago(now, 22), lastActivityAt: ago(now, 1),
      updates: [{ at: ago(now, 1), author: 'Julia Castro', note: 'Pedido enviado ao dono da pasta para aprovação.' }],
    }),
    t({
      id: 'REQ-10442', type: 'REQ', title: 'Segundo monitor para home office',
      description: 'Solicito um segundo monitor de 24" para trabalho em home office.',
      category: 'Hardware', priority: 'Baixa', status: 'Aprovado', requesterId: 'emp-ana',
      affected: 'Somente a solicitante', createdAt: ago(now, 27), lastActivityAt: ago(now, 2),
      updates: [{ at: ago(now, 2), author: 'Julia Castro', note: 'Aprovado pelo gestor. Aguardando entrega do fornecedor.' }],
    }),
    t({
      id: 'INC-19877', type: 'INC', title: 'Outlook não sincroniza no celular',
      description: 'O app do Outlook no celular parou de receber e-mails.',
      category: 'E-mail', priority: 'Média', status: 'Resolvido', requesterId: 'emp-ana',
      affected: 'Somente a solicitante', createdAt: ago(now, 9), lastActivityAt: ago(now, 3), resolvedAt: ago(now, 3),
      updates: [{ at: ago(now, 3), author: 'Julia Castro', note: 'Conta removida e adicionada de novo no app. Sincronização normalizada.' }],
    }),
    t({
      id: 'INC-19410', type: 'INC', title: 'Troca de senha da rede',
      description: 'Senha da rede expirada, sem conseguir trocar pelo portal.',
      category: 'Acesso', priority: 'Alta', status: 'Resolvido', requesterId: 'emp-ana',
      affected: 'Somente a solicitante', createdAt: ago(now, 118), lastActivityAt: ago(now, 117), resolvedAt: ago(now, 117),
    }),
    // Carla: senha do SAP resolvida há 4 dias (exemplo do PRD) e um pedido de acesso aberto.
    t({
      id: 'INC-20150', type: 'INC', title: 'Senha do SAP bloqueada',
      description: 'Senha do SAP bloqueada após tentativas erradas.',
      category: 'Acesso', priority: 'Média', status: 'Resolvido', requesterId: 'emp-carla',
      affected: 'Somente a solicitante', createdAt: ago(now, 6), lastActivityAt: ago(now, 4), resolvedAt: ago(now, 4),
    }),
    t({
      id: 'REQ-10457', type: 'REQ', title: 'Acesso ao módulo de vendas do SAP',
      description: 'Preciso de acesso ao módulo SD do SAP para emitir pedidos.',
      category: 'Acesso', priority: 'Alta', status: 'Aberto', requesterId: 'emp-carla',
      affected: 'Somente a solicitante', createdAt: ago(now, 0, 3), lastActivityAt: ago(now, 0, 3),
    }),
    // Bruno: VPN (para testar duplicidade com o mesmo problema) e uma requisição de software.
    t({
      id: 'INC-20330', type: 'INC', title: 'VPN cai a cada 10 minutos',
      description: 'A VPN conecta, mas cai a cada 10 minutos e precisa reconectar.',
      category: 'Rede e VPN', priority: 'Média', status: 'Em andamento', requesterId: 'emp-bruno',
      affected: 'Somente o solicitante', createdAt: ago(now, 2), lastActivityAt: ago(now, 1),
    }),
    t({
      id: 'REQ-10450', type: 'REQ', title: 'Licença do Adobe Illustrator',
      description: 'Solicito licença do Adobe Illustrator para peças da campanha de dezembro.',
      category: 'Software', priority: 'Baixa', status: 'Aberto', requesterId: 'emp-bruno',
      affected: 'Somente o solicitante', createdAt: ago(now, 4), lastActivityAt: ago(now, 4),
    }),
  ]
}

export async function seed(db: Db, now: Date = new Date()): Promise<void> {
  await migrate(db)
  await db.batch(['DELETE FROM tickets', 'DELETE FROM employees', 'DELETE FROM sequences'], 'write')
  for (const e of EMPLOYEES) {
    await db.execute({
      sql: 'INSERT INTO employees (id, name, email, role, department, device, support_level) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [e.id, e.name, e.email, e.role, e.department, e.device, e.supportLevel ?? null],
    })
  }
  for (const ticket of buildTickets(now)) await upsertTicket(db, ticket)
}
