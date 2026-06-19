# Arquitetura — Sistema de Automação de Postagens

> Decisões técnicas e o **porquê** de cada uma. Leia isto antes de codar qualquer coisa.

## Decisão central: arquitetura híbrida

Sua "Opção A" (n8n como orquestrador) está **certa para começar**, mas o motivo
real não é "zero código". É **orquestração, retry e filas**. Os nodes nativos do
n8n para as 3 redes não resolvem tudo sozinhos — LinkedIn em especial é frágil.

A arquitetura escolhida é **híbrida com divisão clara de responsabilidades**:

```
┌─────────────────────┐         ┌──────────────────────────┐
│   SISTEMA WEB       │         │         n8n              │
│   (Claude Code)     │ webhook │   (self-hosted VPS)      │
│                     │ ──────► │                          │
│ - Cadastro clientes │         │ - WF Publicação (core)   │
│ - Banco (Postgres)  │ ◄────── │ - WF Geração texto (IA)  │
│ - Tokens OAuth      │ callback│ - WF Geração calendário  │
│ - Painel aprovação  │         │ - Retry / agendamento    │
│ - Fonte da verdade  │         │ - Chamadas Graph/LinkedIn│
└─────────────────────┘         └──────────────────────────┘
        │                                  │
        └──── Postgres compartilhado ───────┘
              (estado do ciclo, fila)
```

**Regra de ouro da divisão:**
- O **sistema** é a fonte da verdade: clientes, tokens, status do ciclo, fila de posts.
- O **n8n** é o executor: recebe ordem (webhook), executa (publica/gera), devolve
  resultado (callback ou escreve no Postgres).

Isso resolve o contra que você listou ("se o n8n cair, o sistema para"): se o n8n
cair, os posts ficam na fila no Postgres com status `pending`. Quando voltar, ele
retoma. Nada se perde.

## Por que NÃO postar direto do sistema (sem n8n) agora

Você levantou a opção de usar as docs do Facebook/LinkedIn e postar direto do
sistema. Isso é viável e dá mais controle — **mas é a fase 2**, não agora. Razões:

1. OAuth multi-conta + refresh de token de 400+ contas é trabalhoso de fazer do
   zero. O n8n já tem esse fluxo visual e testável.
2. Você quer **testar publicação rápido**. n8n te dá isso hoje.
3. A lógica de retry/reagendamento por falha de API é "de graça" no n8n.

Quando o volume justificar (ou o n8n virar gargalo), migra-se o WF de publicação
para código no sistema. A arquitetura híbrida permite isso sem reescrever o resto.

## Escala: 100 → 400+ posts

O número "400 posts" sozinho não é o gargalo. O que importa é **a distribuição**:

- **Limite real do Instagram**: por CONTA (não global). As fontes divergem entre
  25, 50 e 100 posts/24h por conta. A doc oficial da Meta diz 100, mas há relatos
  consistentes de throttle em 25–50. **Trate como configurável por conta** e leia
  os headers `X-App-Usage` / `content_publishing_limit` antes de publicar.
- 400 posts entre, digamos, 40 clientes = 10 posts/conta/dia. Folgado.
- O gargalo de verdade aparece se um único cliente tentar publicar 30+ no mesmo dia.

**Como escalar bem:**
1. Fila no Postgres com `scheduled_at` por post (nunca "publica tudo de uma vez").
2. n8n consome a fila respeitando o limite POR CONTA.
3. Cada post registra sucesso/falha; falha de API → reagenda (backoff).
4. Rate-limit check antes de cada publish (lê `content_publishing_limit`).

Com isso, 400 ou 4000 é só questão de espaçar no tempo — a arquitetura não muda.

## Fluxo de um post (caminho feliz)

```
1. Sistema cria registro de post na fila      → status: scheduled
2. Chega scheduled_at → sistema dispara webhook n8n (ou n8n faz polling)
3. n8n checa rate limit da conta              → ok?
4. n8n cria container de mídia (Graph API)
5. n8n publica container                       → media_publish
6. n8n grava resultado no Postgres             → status: published / failed
7. Se failed por API → reagenda com backoff
```

## Stack confirmada

| Camada | Tecnologia | Observação |
|---|---|---|
| Orquestração | n8n self-hosted | Já tem na VPS |
| Sistema web | Claude Code (a definir framework) | Ver 02-SISTEMA |
| Banco | PostgreSQL | Fonte da verdade + fila |
| IA | Gemini ou OpenAI | Fase 2 (texto + calendário) |
| Publicação | Graph API (IG/FB) + LinkedIn API | Via n8n nodes na fase 1 |
| Assist. dev | n8n-mcp (Claude Code) | Ver 04-MCP-N8N |

## Pontos de atenção que vão te morder se ignorar

1. **Instagram precisa de Business/Creator vinculado a uma Página FB.** Conta
   pessoal não publica via API.
2. **Vídeo do YouTube → Instagram não é direto.** A Graph API faz cURL na URL da
   mídia; precisa ser URL pública do arquivo de vídeo, não link do YouTube. Você
   terá que baixar e hospedar (R2/S3) antes. Ver 03-WORKFLOWS.
3. **LinkedIn API exige App Review** para `w_member_social`/`w_organization_social`.
   É o elo mais frágil e o que mais quebra. Comece por IG+FB, deixe LinkedIn por último.
4. **Token de longa duração (60 dias)** precisa ser renovado programaticamente.
   Agende um WF de refresh. Token curto vai expirar no meio de um job.
5. **Page Publishing Authorization (PPA)** pode bloquear publicação em algumas
   Páginas até ser concluída manualmente pelo dono.
