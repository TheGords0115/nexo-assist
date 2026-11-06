# Nexo Assist

Agent de atendimento do service desk de TI da Nexo. O funcionário descreve o problema num chat e o agent consulta os chamados dele, busca na central de ajuda, abre ou atualiza chamados (sempre com confirmação) e chama um analista quando precisa. O analista tem um console para assumir, responder, devolver ao agent ou encerrar.

Desafio técnico do processo seletivo da Beyond the Bytes.

## Como rodar

Precisa de Node 22 ou mais novo e de uma chave de API do Gemini (gratuita, em https://aistudio.google.com/apikey).

```bash
git clone https://github.com/TheGords0115/nexo-assist.git
cd nexo-assist
npm install
cp .env.example .env      # preencha GOOGLE_GENERATIVE_AI_API_KEY e troque as duas chaves de exemplo
npm run seed              # cria os dados de exemplo (chamados) e zera as conversas
npm run dev               # sobe o serviço de chamados (4001) e a aplicação (3000)
```

Abra http://localhost:3000. Qualquer senha funciona para as contas de exemplo:

| Perfil | E-mail | Para testar |
|---|---|---|
| Funcionária | ana.souza@nexo.com.br | Windows 11; tem chamado vencido, em andamento, aprovado, resolvido recente e resolvido antigo |
| Funcionária | carla.mendes@nexo.com.br | Windows 10 (o artigo do erro 809 vale para ela) |
| Funcionário | bruno.tavares@nexo.com.br | macOS; tem um chamado de VPN aberto |
| Funcionário | diego.ramos@nexo.com.br | Logística (bom para testar caso crítico) |
| Analista N2 | rafael.lima@nexo.com.br | Console do analista |
| Analista N1 | julia.castro@nexo.com.br | Console do analista |

Outros comandos:

```bash
npm test          # testes automatizados (não chamam o modelo)
npm run eval      # cenários de conversa contra o modelo real (cabe no plano gratuito)
npm run typecheck
```

## Arquitetura

```
apps/web            Next.js: telas, rotas da API, agent e banco das conversas
  src/app             telas (login, atendimento, perfil, console) e rotas /api
  src/components      componentes de tela (chat, cards, painel de decisão, console)
  src/server/agent    o agent: definição (Mastra), prompt, tools e contexto do turno
  src/server/chat     fluxo do turno e operações de negócio (confirmar, transferir, analista)
  src/server/store    banco das conversas (libSQL em arquivo)
  src/server/tickets  cliente HTTP do serviço de chamados (timeout + retry)
  src/server/help-center  artigos da central de ajuda e busca
  evals               cenários de avaliação do agent
services/tickets    serviço de chamados simulado (Fastify + libSQL), o "sistema legado"
packages/domain     regras de domínio puras: tipos, prioridade, prazos em horário útil
```

Três camadas separadas:

- **Interface** (React/Next.js): só conversa com a API da própria aplicação. Recebe a resposta do agent em tempo real por Server-Sent Events.
- **Agent** (Mastra + Gemini): decide o que fazer a cada mensagem usando tools. Não acessa banco nem HTTP direto; tudo passa pelas tools.
- **Serviços**: o serviço de chamados é **outro processo**, com outro banco, e a aplicação fala com ele por HTTP com uma chave de serviço e a identidade de quem está agindo. Ele simula o legado instável: uma parte das requisições responde 503 e às vezes ele fica fora do ar por alguns segundos (configurável no `.env`).

Persistência: conversas, mensagens, rascunhos e o estado de cada conversa (com o agent, aguardando analista, com analista, encerrada) ficam em `data/app.db`; os chamados em `data/tickets.db`. Tudo sobrevive a um reinício. Ao voltar outro dia, o funcionário cai na mesma conversa.

### Fluxo de uma mensagem

1. `POST /api/chat` (`apps/web/src/app/api/chat/route.ts`) valida a sessão e abre o stream.
2. `runTurn` (`apps/web/src/server/chat/turn.ts`) confere se a conversa está com o agent. **Se estiver com um analista, salva a mensagem e não chama o modelo.** Também confere o limite de 30 mensagens.
3. O agent recebe as últimas 14 mensagens e um contexto curto do funcionário (nome, área, equipamento, rascunho pendente).
4. Cada tool que roda vira um passo na tela ("consultou seus chamados"), e o texto da resposta aparece aos poucos.
5. No fim, aplico as regras de saída em código (ex.: confiança baixa → transfere) e salvo a mensagem com os cards e o detalhe da decisão.

## Como o agent decide o que fazer

O agent tem 7 tools (`apps/web/src/server/agent/tools.ts`):

| Tool | Para quê |
|---|---|
| `buscar_central_ajuda` | Antes de abrir chamado, ver se um artigo resolve (e se as condições dele valem para o funcionário) |
| `listar_meus_chamados` | Status sem número, checar duplicidade, achar o chamado a complementar |
| `consultar_chamado` | Detalhe com prazo e atraso |
| `propor_novo_chamado` | Monta o **rascunho**; não cria nada |
| `propor_atualizacao` | Rascunho de complemento ou reabertura |
| `confirmar_rascunho` | Executa um rascunho que o funcionário já viu e confirmou por escrito |
| `transferir_para_analista` | Passa a conversa para um analista com um resumo |

O prompt (`apps/web/src/server/agent/prompt.ts`) descreve a condução: buscar na central antes de abrir chamado, checar chamados existentes, perguntar uma coisa por vez com opções rápidas, mostrar rascunho e esperar confirmação, oferecer analista em chamado vencido e redirecionar o que não é de TI.

Cada turno termina com uma **saída estruturada** (`turnOutputSchema` em `agent.ts`): primeiro a `decisao` (entendimento, intenção, ação, confiança de 0 a 1, justificativa e regras aplicadas), depois a `resposta` e as `opcoes_rapidas`. A decisão vem antes de propósito: o modelo decide e depois escreve.

### O que não depende do modelo

A parte que não pode errar ficou em código, não no prompt:

- **Privacidade**: o funcionário das tools vem da sessão (cookie assinado), nunca de um parâmetro do modelo. E o serviço de chamados também barra: chamado de outra pessoa responde 404, como se não existisse.
- **Confirmação antes de agir**: só `confirmDraft` (`server/chat/actions.ts`) cria ou atualiza chamado. Ele é chamado pelo botão Confirmar ou pela tool `confirmar_rascunho`, que só aceita rascunho mostrado numa mensagem **anterior** (o modelo não consegue montar e confirmar no mesmo turno).
- **Sem duplicidade**: `propor_novo_chamado` procura um chamado aberto da mesma categoria, ou resolvido há até 7 dias, e bloqueia o rascunho até o funcionário dizer que é outro problema.
- **Prioridade e prazo**: o modelo só classifica impacto (pessoa/equipe/empresa), bloqueio (parado/atrapalha/sem urgência) e se há compromisso hoje. A tabela do Anexo A é aplicada em `packages/domain/src/priority.ts`, e os prazos em horário útil (seg-sex, 8h-18h) em `sla.ts`.
- **Transferência**: caso crítico confirmado vai direto para o Suporte N2. Se o modelo declarar confiança abaixo de 50%, o sistema transfere sozinho.
- **Agent pausado**: com a conversa com um analista, o fluxo nem chama o modelo.
- **Legado instável**: o cliente tem timeout de 4 s e repete com espera crescente (300 ms, 900 ms, 2 s) só em falha temporária. Se mesmo assim falhar, o agent avisa com franqueza, e um rascunho que não pôde ser confirmado continua guardado.

## Transparência

Acima de cada resposta aparecem as ações do agent ("consultou seus chamados · montou o rascunho"). Clicando em **por quê?** abre o detalhe da decisão (`components/chat/DecisionPanel.tsx`):

- o que o agent entendeu, a intenção, a ação e a **segurança** (barra de 0 a 100%);
- a justificativa e as regras do service desk que ele citou;
- cada ferramenta usada, com a entrada, o resultado resumido, o tempo e as novas tentativas no legado;
- as **regras aplicadas pelo sistema** (ex.: "Rascunho bloqueado: já existe INC-20311");
- modelo, latência, tokens (com cache) e custo estimado do turno.

O analista vê o mesmo detalhe no console ("ver decisão"), e a lista mostra quando o agent pediu ajuda e com qual confiança.

## Como garanti a qualidade das decisões

1. **Regras críticas em código, com testes** (`npm test`, 42 testes): prioridade e prazos (inclusive virada de dia e fim de semana), privacidade no serviço, reabertura em 7 dias, duplicidade, confirmação só em turno seguinte, crítico indo para analista, agent pausado, limite de mensagens, retry do cliente. Os testes das tools sobem o serviço de chamados de verdade, em memória.
2. **Evals contra o modelo** (`npm run eval`, `apps/web/evals`): 12 conversas roteirizadas que verificam a **decisão**, não o texto. Por exemplo: o erro 809 no Windows 10 se resolve pela central sem chamado, mas no Windows 11 vira chamado com prioridade alta por causa da reunião; status sem número mostra a lista para escolher; lentidão com o INC-20311 aberto não pode virar chamado novo; o Outlook resolvido há 3 dias deve ser reaberto; o pedido de férias vai para o RH; o chamado de outra pessoa não vaza. Cada execução salva as transcrições e as decisões em `apps/web/evals/results/latest.json`.
3. **Teste manual** das telas e do fluxo analista ↔ funcionário.

<!-- RESULTADO_EVALS -->

## Escolha do modelo

Padrão: **Gemini Flash** (`google/gemini-3.5-flash`), configurável em `NEXO_MODEL`.

- **Plano gratuito**: quem for avaliar o projeto consegue rodar sem gastar nada, com uma chave do Google AI Studio que sai em um minuto e não pede cartão.
- **Rápido e bom com tools**, que é o centro desse agent.
- **Dá para usar um modelo pequeno** porque as decisões que não podem errar (prioridade, duplicidade, confirmação, privacidade) não dependem dele.
- **Trocar de modelo é só mudar o `.env`.** O código também suporta o Claude Haiku (`anthropic/claude-haiku-5-5`). A única diferença no código: o Gemini não aceita saída estruturada nativa junto com tools, então nele o formato da resposta vai como instrução no prompt de sistema (`SCHEMA_IN_PROMPT` em `agent.ts`).

As evals servem justamente para comparar modelos: troca o `NEXO_MODEL`, roda `npm run eval` e compara o placar e o custo.

### Custo por conversa

- O prompt fixo é o primeiro bloco de toda chamada, então entra no cache automático do Gemini (e no `cacheControl` da Anthropic, se usar Claude).
- Histórico limitado às últimas 14 mensagens, e os cards entram resumidos em uma linha.
- Os resultados das tools voltam compactos para o modelo.
- Ações pelos botões (Confirmar, Cancelar) e as do analista não chamam o modelo.
- Limite de 30 mensagens por sessão e no máximo 6 passos por turno.
- O custo de cada turno aparece no detalhe da decisão.

## Principais trade-offs

- **Busca por palavras-chave na central** em vez de embeddings: com 9 artigos, embeddings custariam uma chamada a mais por pergunta. A tool só conhece `searchArticles`, então dá para trocar depois.
- **Histórico próprio em vez da Memory do Mastra**: eu já precisava guardar as mensagens com cards e trace para a tela, então monto o histórico a partir do meu banco e controlo o tamanho (custo).
- **Polling em vez de WebSocket** no console e enquanto o analista atende (a cada 3-4 s). É simples e suficiente para a demo; em produção eu usaria SSE ou WebSocket.
- **Saída estruturada com a decisão** custa alguns tokens a mais por turno, mas é o que permite mostrar o porquê de cada resposta e transferir por baixa confiança.
- **Login simplificado**: qualquer senha para as contas de exemplo, como o PRD pede. A sessão é um cookie HMAC sem estado no servidor.
- **libSQL em arquivo**: roda local sem instalar banco e, para um deploy, a mesma lib conecta no Turso só trocando a URL.

## O que eu faria com mais tempo

- Deploy (Railway ou Render) com limite de uso por sessão e por dia, para proteger a chave.
- Rodar as evals no CI a cada mudança no prompt ou nas tools, comparando o placar.
- Notificações em tempo real (SSE) para o analista, no lugar do polling.
- Busca semântica na central quando ela crescer, e artigos editáveis pelos analistas.
- Métricas do atendimento num painel: resolução sem fila, tempo até a transferência, custo por conversa.
- Testes de interface (Playwright) para os fluxos principais.

## Onde está cada requisito do PRD

| Requisito | Onde |
|---|---|
| Login (Tela 1) | `apps/web/src/app/login/page.tsx`, `components/LoginForm.tsx`, `app/api/auth/login/route.ts` |
| Chat do funcionário (Telas 2 e 3) | `components/chat/Chat.tsx`, `MessageItem.tsx`, `cards.tsx` |
| Respostas em tempo real | `app/api/chat/route.ts` (SSE) e `server/chat/turn.ts` |
| Cards, seleção de chamado, rascunho, opções rápidas | `components/chat/cards.tsx` |
| Limite de 30 mensagens | `server/chat/turn.ts` (`MESSAGE_LIMIT`) e contador em `Chat.tsx` |
| O agent | `server/agent/agent.ts`, `prompt.ts`, `tools.ts` |
| Regras do Anexo A | `packages/domain/src/priority.ts`, `sla.ts` e `server/agent/tools.ts` |
| Serviço de chamados separado | `services/tickets/src/app.ts` |
| Dados de exemplo (Anexo B) | `services/tickets/src/seed.ts`, `server/help-center/articles.ts` |
| Transferência e agent pausado | `server/chat/actions.ts` (`transferConversation`) e `turn.ts` |
| Console do analista (Telas 4 e 5) | `components/console/Console.tsx`, `app/api/console/...` |
| Visibilidade das decisões | `components/chat/DecisionPanel.tsx`, trace montado em `turn.ts` |
| Persistência | `server/store/db.ts`, `server/store/conversations.ts` |
| Legado instável | `services/tickets/src/chaos.ts`, retry em `server/tickets/client.ts` |
| Privacidade | `services/tickets/src/app.ts` (`loadTicketFor`) e `server/agent/context.ts` |
| Testes e evals | `packages/domain/test`, `services/tickets/test`, `apps/web/test`, `apps/web/evals` |
