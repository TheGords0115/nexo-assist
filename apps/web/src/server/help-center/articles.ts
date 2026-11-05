// Central de ajuda (Anexo B). Artigos curtos, escritos por mim, que o agent consulta antes de
// abrir chamado. Alguns têm condição (ex.: erro 809 só vale para Windows 10), justamente para
// testar se o agent lê a condição e não sai aplicando o artigo para todo mundo.

export interface Article {
  id: string
  title: string
  body: string
  /** Palavras que ajudam a achar o artigo mesmo quando o funcionário escreve de outro jeito. */
  keywords: string[]
}

export const ARTICLES: Article[] = [
  {
    id: 'KB-001',
    title: 'VPN com erro 809',
    body: 'Reinstale o cliente de VPN pelo portal de softwares (portal.nexo.com.br/softwares) e reinicie o computador. Vale apenas para Windows 10; no Windows 11, abra um chamado.',
    keywords: ['vpn', '809', 'conectar', 'conexao', 'remoto', 'home office'],
  },
  {
    id: 'KB-002',
    title: 'Horário do service desk',
    body: 'O service desk atende de segunda a sexta, das 8h às 18h. Chamados críticos têm plantão 24 horas. Telefone: ramal 4000.',
    keywords: ['horario', 'atendimento', 'plantao', 'funciona', 'ramal', 'telefone'],
  },
  {
    id: 'KB-003',
    title: 'Trocar ou desbloquear a senha da rede',
    body: 'Acesse senha.nexo.com.br, informe seu e-mail corporativo e confirme o código enviado ao celular cadastrado. A nova senha precisa de 12 caracteres, com letras e números, e vale para rede, e-mail e VPN. Se o celular cadastrado estiver desatualizado, abra um chamado de Acesso.',
    keywords: ['senha', 'bloqueada', 'expirou', 'expirada', 'trocar', 'esqueci', 'rede', 'login', 'desbloquear'],
  },
  {
    id: 'KB-004',
    title: 'Configurar o e-mail corporativo no celular',
    body: 'Instale o app Outlook, entre com o e-mail corporativo e aprove o acesso no Authenticator. Se parar de sincronizar, remova a conta do app e adicione de novo. Apps de e-mail nativos (Mail, Gmail) não são suportados.',
    keywords: ['email', 'outlook', 'celular', 'sincroniza', 'sincronizar', 'iphone', 'android', 'app'],
  },
  {
    id: 'KB-005',
    title: 'Adicionar a impressora do andar',
    body: 'No Windows, abra Configurações > Impressoras e adicione \\\\print.nexo.local\\ANDAR-X (troque X pelo número do andar). No Mac, use Preferências > Impressoras > IP print.nexo.local. Atolamento ou falta de toner: avise a recepção do andar.',
    keywords: ['impressora', 'imprimir', 'impressao', 'toner', 'papel'],
  },
  {
    id: 'KB-006',
    title: 'Pedir instalação de software',
    body: 'Softwares homologados (Office, Teams, Zoom, 7-Zip, Chrome, Acrobat Reader) se instalam sozinhos pelo portal de softwares, sem chamado. Softwares pagos ou fora da lista precisam de uma requisição (REQ) com a aprovação do gestor.',
    keywords: ['instalar', 'software', 'programa', 'licenca', 'aplicativo', 'portal'],
  },
  {
    id: 'KB-007',
    title: 'Computador lento',
    body: 'Reinicie o computador (não só bloqueie) e rode o "Diagnóstico Nexo" pelo portal de softwares. Ele limpa temporários e verifica atualizações pendentes. Se continuar lento depois do diagnóstico, abra um chamado de Hardware.',
    keywords: ['lento', 'lentidao', 'travando', 'trava', 'devagar', 'desempenho', 'notebook', 'computador'],
  },
  {
    id: 'KB-008',
    title: 'Wi-Fi do escritório',
    body: 'Funcionários usam a rede "Nexo-Corp", que autentica com o e-mail e a senha da rede. Visitantes usam "Nexo-Visitante"; a senha do dia fica na recepção. Se a Nexo-Corp não aparecer ou recusar a senha, troque a senha da rede (KB-003) e tente de novo.',
    keywords: ['wifi', 'wi-fi', 'internet', 'rede sem fio', 'visitante', 'conexao'],
  },
  {
    id: 'KB-009',
    title: 'Assuntos que não são de TI',
    body: 'O service desk de TI não atende RH, financeiro ou facilities. RH (férias, folha, benefícios): portal rh.nexo.com.br. Financeiro (reembolso, adiantamento): financeiro@nexo.com.br. Facilities (ar-condicionado, limpeza, crachá, mesa): ramal 4100.',
    keywords: ['ferias', 'salario', 'holerite', 'beneficio', 'reembolso', 'ar condicionado', 'cracha', 'limpeza', 'rh', 'financeiro', 'facilities'],
  },
]
