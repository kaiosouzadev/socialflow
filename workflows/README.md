# Workflows n8n

Exports dos workflows ativos na instância (n8n.visioncode.cloud), versionados.
Fonte da verdade é a instância; ao mudar lá, re-exportar aqui.

| Arquivo | ID na instância | Agenda | Função |
|---|---|---|---|
| WF-01-publicacao-multi-rede.json | kCzlOtv3Skdr2Lpu | 5 min | Lock da fila (`scheduled` → `publishing`) e POST em `/api/internal/publish/:id` |
| WF-02-refresh-token.json | 9xufcJkfiLmA1u0S | 12 h | Renova tokens Meta vencendo em <7d (troca por long-lived e grava via API interna) |
| WF-03-retry.json | uhwppHJeDwVFWNY6 | 15 min | Destrava posts presos em `publishing` (>20min) e reagenda `failed` com backoff (5m/30m/2h, máx 3) |
| WF-05-sync-midia-drive.json | 3Gt2GaMYxxcOywqE | 30 min | POST em `/api/internal/sync-media` (anexa mídia do Drive→R2 aos posts) |
| WF-06-limpeza-midia-30d.json | 3gGfkEuaIvJ3MVBa | diário 04:00 | POST em `/api/internal/cleanup-media` (exclui do R2 a mídia de posts publicados há 30+ dias; a miniatura-lembrança fica no Postgres) |

Notas:
- Todos os HTTP usam a credencial `SocialFlow Internal Key` (header `x-internal-key`) — nunca hardcoded.
- Um workflow genérico parametrizado; o que muda por cliente vem do banco.
- Use o MCP do n8n no Claude Code para criar/editar. Ver `docs/03-MCP-N8N.md`.
