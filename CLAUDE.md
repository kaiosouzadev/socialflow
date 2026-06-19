# CLAUDE.md — Contexto para o Claude Code

## O que é este projeto
Automação de postagens em redes sociais (Instagram, Facebook, LinkedIn) para
clientes de uma agência. Escalável para 400+ posts/dia distribuídos entre clientes.

## Arquitetura (NÃO desviar disso sem discutir)
Híbrida: **sistema web** = fonte da verdade (clientes, tokens, fila de posts no
Postgres). **n8n** = executor (publica nas redes, gera texto/calendário com IA).
Comunicação por webhook + Postgres compartilhado. Ver `docs/00-ARQUITETURA.md`.

## Regras de implementação
- **Um workflow genérico parametrizado**, NUNCA um workflow por cliente.
- O que muda por cliente vem do banco (`targets`, conta, mídia), não do workflow.
- Rate limit do Instagram é **por conta** e configurável (`daily_post_limit`).
  Sempre checar `content_publishing_limit` antes de publicar.
- Tokens OAuth: criptografados no Postgres. Nunca em URL/query string. Nunca commitar.
- Instagram exige Business/Creator vinculado a Página FB.
- Mídia para Graph API precisa ser URL pública do arquivo (vídeo do YouTube NÃO
  funciona direto — baixar e hospedar em R2 primeiro).
- LinkedIn é fase 1.5 (depende de App Review). Começar por IG+FB.

## Fase atual
Fase 1: workflows de publicação no n8n. Testar postagem real numa conta cobaia da
agência, nunca direto em cliente.

## Ferramentas
- Workflows: n8n self-hosted (VPS). MCP configurado em `.mcp.json`.
- Banco: PostgreSQL.
- IA (fase 2): Gemini ou OpenAI.

## Segredos
Tudo em `.env` (gitignored). Ver `docs/03-MCP-N8N.md` para a lista.
