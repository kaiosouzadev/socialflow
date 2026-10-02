# Workflows n8n

Exports dos workflows ativos na instância (n8n.visioncode.cloud), versionados.
Fonte da verdade é a instância; ao mudar lá, re-exportar aqui.

> [!WARNING]
> **O SQL atual do WF-01 e do WF-03 requer a migração
> `system/migrations/2026-10-01-producao-e-publicacao.sql` aplicada ANTES no banco de
> produção — sem ela o WF-01 falha e TODA a publicação para.**
> As queries usam a coluna `clients.agency_publishes`, criada por essa migração.
> Ordem obrigatória: (1) migração no banco → (2) deploy do sistema → (3) atualizar o
> SQL na instância (seção "Como atualizar na instância", abaixo).

| Arquivo | ID na instância | Agenda | Função |
|---|---|---|---|
| WF-01-publicacao-multi-rede.json | kCzlOtv3Skdr2Lpu | 5 min | Lock da fila (`scheduled` → `publishing`), só de clientes com `agency_publishes = true`, e POST em `/api/internal/publish/:id` |
| WF-02-refresh-token.json | 9xufcJkfiLmA1u0S | 12 h | Renova tokens Meta vencendo em <7d (troca por long-lived e grava via API interna) |
| WF-03-retry.json | uhwppHJeDwVFWNY6 | 15 min | Destrava posts presos em `publishing` (>20min, todos os clientes) e reagenda `failed` com backoff (5m/30m/2h, máx 3), só de clientes com `agency_publishes = true` |
| WF-05-sync-midia-drive.json | 3Gt2GaMYxxcOywqE | 30 min | POST em `/api/internal/sync-media` (anexa mídia do Drive→R2 aos posts) |
| WF-06-limpeza-midia-30d.json | 3gGfkEuaIvJ3MVBa | diário 04:00 | POST em `/api/internal/cleanup-media` (exclui do R2 a mídia de posts publicados há 30+ dias; a miniatura-lembrança fica no Postgres) |

Notas:
- Todos os HTTP usam a credencial `SocialFlow Internal Key` (header `x-internal-key`) — nunca hardcoded.
- Um workflow genérico parametrizado; o que muda por cliente vem do banco.
- Use o MCP do n8n no Claude Code para criar/editar. Ver `docs/03-MCP-N8N.md`.

## Como atualizar na instância

Os JSON do WF-01 e do WF-03 nesta pasta foram alterados **antes** da instância
(filtro por cliente `agency_publishes = true`). Só a query de um nó Postgres muda
em cada workflow; gatilho, nós, conexões e credenciais continuam iguais.

**Antes de começar:** confirme que a migração está aplicada no banco de produção.
Esta consulta precisa devolver 1 linha:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'clients' AND column_name = 'agency_publishes';
```

Se devolver 0 linhas, **pare aqui** e aplique a migração primeiro.

### Passo a passo

1. Abra `https://n8n.visioncode.cloud` e entre no workflow
   **SocialFlow WF-01 Publicacao Multi-Rede** (ID `kCzlOtv3Skdr2Lpu`).
2. Abra o nó **"Busca fila (lock)"** (Postgres, operação *Execute Query*).
3. Apague todo o conteúdo do campo **Query** e cole o SQL do WF-01 (abaixo).
   Não mexa em nenhum outro campo.
4. Feche o nó e clique em **Save**. O workflow continua ativo.
5. Abra o workflow **SocialFlow WF-03 Retry com Backoff** (ID `uhwppHJeDwVFWNY6`).
6. Abra o nó **"Reagenda falhas (backoff)"**, apague todo o campo **Query** e cole
   o SQL do WF-03 (abaixo). Não mexa em nenhum outro campo.
7. Feche o nó e clique em **Save**.
8. **Não** use "Execute step" / "Test step" nesses nós: eles rodam o `UPDATE` de
   verdade no banco de produção (o WF-01 marcaria posts como `publishing` sem
   publicá-los).
9. Confira na aba **Executions**: a próxima execução do WF-01 (até 5 min) e a do
   WF-03 (até 15 min) devem aparecer verdes, sem erro de SQL.
   Se o WF-01 falhar com `column c.agency_publishes does not exist`, a migração
   não foi aplicada: aplique-a imediatamente ou volte a query anterior (abaixo).

Alternativa: importar o JSON cria um workflow **novo** na instância. Se escolher
esse caminho, desative e apague o workflow antigo antes de ativar o importado, senão
os dois rodam juntos.

### SQL do WF-01 — nó "Busca fila (lock)"

```sql
UPDATE posts SET status='publishing' WHERE id IN (SELECT p.id FROM posts p JOIN clients c ON c.id = p.client_id WHERE p.status='scheduled' AND p.scheduled_at <= now() AND c.agency_publishes = true ORDER BY p.scheduled_at LIMIT 10) RETURNING id
```

### SQL do WF-03 — nó "Reagenda falhas (backoff)"

```sql
WITH destrava AS (
  UPDATE posts
  SET status='failed', last_error='destravado: travado ao publicar por 20+ min'
  WHERE status='publishing' AND scheduled_at < now() - interval '20 minutes'
  RETURNING id
)
UPDATE posts
SET status='scheduled',
    scheduled_at = now() + (CASE retry_count WHEN 0 THEN interval '5 minutes' WHEN 1 THEN interval '30 minutes' ELSE interval '2 hours' END),
    retry_count = retry_count + 1
WHERE status='failed' AND retry_count < 3
  AND EXISTS (SELECT 1 FROM clients c WHERE c.id = posts.client_id AND c.agency_publishes = true)
RETURNING id, client_id, retry_count, last_error
```

### Voltar a query anterior (só em emergência)

Use só se o WF-01 estiver falhando e a migração não puder ser aplicada na hora.
Sem o filtro, posts de clientes "só produção" voltam a poder ser publicados pelo
n8n (o sistema ainda recusa na rota de publicação).

WF-01, nó "Busca fila (lock)":

```sql
UPDATE posts SET status='publishing' WHERE id IN (SELECT id FROM posts WHERE status='scheduled' AND scheduled_at <= now() ORDER BY scheduled_at LIMIT 10) RETURNING id
```

WF-03, nó "Reagenda falhas (backoff)":

```sql
WITH destrava AS (
  UPDATE posts
  SET status='failed', last_error='destravado: travado ao publicar por 20+ min'
  WHERE status='publishing' AND scheduled_at < now() - interval '20 minutes'
  RETURNING id
)
UPDATE posts
SET status='scheduled',
    scheduled_at = now() + (CASE retry_count WHEN 0 THEN interval '5 minutes' WHEN 1 THEN interval '30 minutes' ELSE interval '2 hours' END),
    retry_count = retry_count + 1
WHERE status='failed' AND retry_count < 3
RETURNING id, client_id, retry_count, last_error
```
