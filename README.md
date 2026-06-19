# SocialFlow — Automação de Postagens

Sistema de automação de produção e publicação de conteúdo em redes sociais
(Instagram, Facebook, LinkedIn) para clientes da agência. Escalável para 400+ posts.

## Arquitetura em uma frase

**Sistema web (fonte da verdade: clientes, tokens, fila) + n8n (executor: publica,
gera texto/calendário com IA), compartilhando um Postgres.**

## Documentação

| Doc | Conteúdo |
|---|---|
| `PROMPT-INICIO.md` | **Comece por aqui** — prompt para colar no Claude Code |
| `docs/00-ARQUITETURA.md` | Decisão híbrida, escala, pontos de atenção |
| `docs/01-DADOS-E-TOKENS.md` | Schema Postgres + onde guardar tokens OAuth |
| `docs/02-WORKFLOWS.md` | Workflows n8n da fase 1 (publicação) |
| `docs/03-MCP-N8N.md` | Conectar n8n ao Claude Code via MCP |
| `docs/04-METODO-DO-VIDEO.md` | Método do print/vídeo mapeado ao projeto |
| `docs/05-MULTI-REDE-E-ESCALA.md` | 3 redes no mesmo fluxo + escala 1→todos |
| `docs/06-SETUP-META.md` | Criar App Meta, conectar conta, gerar token |

## Arquivos prontos para usar

| Arquivo | O que é |
|---|---|
| `system/schema.sql` | Schema Postgres (rode primeiro) |
| `system/seed-teste.sql` | 1 cliente + 1 post de teste na fila |
| `workflows/WF-01-instagram-publish.json` | Publicação só IG (polling completo) — para aprender |
| `workflows/WF-01-multi-rede-escalavel.json` | Produção: 3 redes + fila + lote |
| `workflows/WF-02-refresh-token.json` | Renova token Meta (1x/dia) |
| `workflows/WF-03-retry.json` | Retry de falhas com backoff |

## Fases do projeto

- **Fase 1 (AGORA):** workflows de publicação no n8n. Testar postagem real.
- **Fase 1.5:** LinkedIn (depende de App Review).
- **Fase 2:** IA gera calendário + textos (Gemini/OpenAI).
- **Fase 3 (se necessário):** migrar publicação do n8n para o sistema.

## Primeiros passos (ordem)

### Semana 1 — Fundação
1. [ ] Subir Postgres na VPS e rodar o schema de `01-DADOS-E-TOKENS.md`.
2. [ ] Criar **conta IG Business + Página FB de teste** (cobaia da agência).
3. [ ] Criar App na Meta for Developers, pegar `META_APP_ID`/`SECRET`.
4. [ ] Gerar token de longa duração da conta de teste e inserir em `social_accounts`.
5. [ ] Gerar API key do n8n e configurar o MCP (`docs/03-MCP-N8N.md`).

### Semana 2 — Primeiro post automático
6. [ ] WF-01 só com **Instagram imagem**: inserir 1 post manual na fila e publicar.
7. [ ] Validar `content_publishing_limit` antes do publish.
8. [ ] Adicionar branch **Facebook**.
9. [ ] Gravar resultado em `publications`.

### Semana 3 — Robustez
10. [ ] Adicionar **Instagram Reels/vídeo** (polling de status do container).
11. [ ] WF-02 refresh de token.
12. [ ] WF-03 retry com backoff.
13. [ ] Migrar seu fluxo YouTube→Instagram para o WF genérico.

### Depois
14. [ ] Esqueleto do sistema web (cadastro de cliente + inserir na fila).
15. [ ] LinkedIn (após App Review).
16. [ ] Fase 2: IA.

## Decisões já tomadas

- n8n **self-hosted** na VPS própria.
- Tokens OAuth no **Postgres criptografados** (não nas credentials do n8n).
- Sistema web e workflows começam **juntos**, mas a prioridade é workflow de publicação.
- IA fica para a **fase 2**.
