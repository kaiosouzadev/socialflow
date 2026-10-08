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
| WF-01-publicacao-multi-rede.json | kCzlOtv3Skdr2Lpu | 5 min | Seleciona a fila (`scheduled` vencido, só de clientes com `agency_publishes = true`, `FOR UPDATE SKIP LOCKED`) e faz POST em `/api/internal/publish/:id`. Quem **toma** o post (`scheduled` → `publishing`, atômico) é o sistema: chamada repetida ou simultânea recebe 409 e não publica |
| WF-02-refresh-token.json | 9xufcJkfiLmA1u0S | 12 h | Só dispara: POST em `/api/internal/tokens/refresh` (`{"days":7}`). O sistema renova os tokens Meta que vencem em <7d e responde só contagens — nenhum token passa pelo n8n |
| WF-03-retry.json | uhwppHJeDwVFWNY6 | 15 min | Destrava posts presos em `publishing` cuja tentativa (carimbo em `publications`) parou há 20+ min, fecha essas tentativas como falha e reagenda `failed` com backoff (5m/30m/2h, máx 3), só de clientes com `agency_publishes = true` |
| WF-05-sync-midia-drive.json | 3Gt2GaMYxxcOywqE | 30 min | POST em `/api/internal/sync-media` (anexa mídia do Drive→R2 aos posts) |
| WF-06-limpeza-midia-30d.json | 3gGfkEuaIvJ3MVBa | diário 04:00 | POST em `/api/internal/cleanup-media` (exclui do R2 a mídia de posts publicados há 30+ dias; a miniatura-lembrança fica no Postgres) |

Notas:
- Todos os HTTP usam a credencial `SocialFlow Internal Key` (header `x-internal-key`) — nunca hardcoded.
- Um workflow genérico parametrizado; o que muda por cliente vem do banco.
- Use o MCP do n8n no Claude Code para criar/editar. Ver `docs/03-MCP-N8N.md`.
- **Nenhum token de rede social passa pelo n8n** (auditoria OWASP 07/10): as rotas
  `/api/internal/token/:id` e `/api/internal/accounts/:clientId` foram removidas; a
  renovação acontece dentro do sistema (`/api/internal/tokens/refresh`).
- Publicação idempotente (sistema, `lib/publish-queue.ts`): ao tomar o post, cada rede
  pendente ganha uma linha em `publications` com `status='publishing'` e `published_at`
  = início da tentativa. O sucesso de cada rede é gravado na hora (linha `success`); as
  linhas `publishing` só saem no fim, junto com o status final do post, numa transação
  sob a mesma trava — outra chamada nunca toma o post no meio. Rede que já tem `success`
  não é publicada de novo (retry depois de falha parcial só repete as que falharam).
- Limite por conta: antes de cada rede o sistema confere `daily_post_limit` (últimas
  24 h) e, no Instagram, `content_publishing_limit` da Meta. Excedido → a rede fica para
  depois e o post volta para `scheduled` mais tarde, sem contar tentativa.


## Como atualizar na instância (auditoria OWASP 07/10)

O sistema novo aceita o WF-01 antigo **e** o novo (a rota toma o post de forma atômica
nos dois casos), então a ordem não quebra a publicação. Ordem recomendada:

1. **Variáveis no sistema (Vercel):** confirme que `META_APP_ID` e `META_APP_SECRET`
   existem no ambiente de produção do sistema (a renovação de tokens passa a rodar lá).
2. **Publique o sistema** (deploy).
3. **WF-01** — abra `https://n8n.visioncode.cloud`, workflow
   **SocialFlow WF-01 Publicacao Multi-Rede** (ID `kCzlOtv3Skdr2Lpu`), nó
   **"Busca fila (lock)"** (Postgres, *Execute Query*): apague todo o campo **Query** e
   cole o SQL do WF-01 (abaixo). Não mexa em outro campo. **Save**.
4. **WF-03** — workflow **SocialFlow WF-03 Retry com Backoff** (ID `uhwppHJeDwVFWNY6`),
   nó **"Reagenda falhas (backoff)"**: apague o campo **Query**, cole o SQL do WF-03
   (abaixo). **Save**.
5. **WF-02** — workflow **SocialFlow WF-02 Refresh Token Meta** (ID `9xufcJkfiLmA1u0S`):
   - apague os nós **"Tokens vencendo (<7d)"**, **"Loop contas"**, **"Busca token atual"**,
     **"Troca por token longo (Meta)"**, **"Token OK?"**, **"Atualiza token no sistema"** e
     **"Concluido"**;
   - acrescente um nó **HTTP Request** ligado ao gatilho "A cada 12h": *Method* `POST`,
     *URL* `https://flow.grupocoletivo.com.br/api/internal/tokens/refresh`,
     *Authentication* "Generic Credential Type" → "Header Auth" → credencial
     **SocialFlow Internal Key**, *Send Body* ligado, *Body Content Type* JSON,
     *Specify Body* "Using JSON", corpo `{"days":7}`, *Options → Timeout* `110000`;
   - em **Settings** do workflow: "Save successful production executions" = **Do not save**;
     "Save manual executions" = **Do not save**;
   - **Save**. (Alternativa: importar `WF-02-refresh-token.json` — veja a nota de importação.)
6. **Limpeza no n8n (tokens antigos):** em **Executions**, filtre o WF-02 e apague todas
   as execuções antigas (elas podem conter tokens e o `client_secret` da Meta na URL).
   Depois remova `META_APP_ID`/`META_APP_SECRET` do ambiente do n8n (ninguém mais usa lá).
   Se alguma execução antiga chegou ao nó "Troca por token longo (Meta)", gere um novo
   **App Secret** no painel da Meta e atualize só o ambiente do sistema.
7. **Não** use "Execute step" / "Test step" nos nós Postgres: o WF-03 roda `UPDATE` de
   verdade no banco de produção. (O WF-01 novo só lê; mesmo assim, evite.)
8. Confira em **Executions**: a próxima execução do WF-01 (até 5 min), do WF-03 (até
   15 min) e do WF-02 (até 12 h; pode rodar manualmente uma vez pelo botão do workflow —
   a resposta é só `{"checked":…,"refreshed":…,"failed":…,"skipped":…}`) devem ficar verdes.

Alternativa: importar o JSON cria um workflow **novo** na instância. Se escolher esse
caminho, desative e apague o workflow antigo antes de ativar o importado, senão os dois
rodam juntos.

### SQL do WF-01 — nó "Busca fila (lock)"

Só **seleciona**; não marca `publishing`. A tomada atômica é feita pelo sistema
(`SELECT … FOR UPDATE` + checagem de status e de tentativa viva na mesma transação):
chamada repetida, simultânea ou manual recebe 409 e não publica de novo.

```sql
SELECT p.id
FROM posts p
JOIN clients c ON c.id = p.client_id
WHERE p.status = 'scheduled'
  AND p.scheduled_at <= now()
  AND c.agency_publishes = true
ORDER BY p.scheduled_at
LIMIT 10
FOR UPDATE OF p SKIP LOCKED
```

### SQL do WF-03 — nó "Reagenda falhas (backoff)"

Destrava pelo **carimbo da tentativa** (`publications.status='publishing'`,
`published_at` = início), não pela hora agendada. A condição `scheduled_at < now() - 20 min`
fica só para posts marcados pelo WF-01 antigo (sem carimbo). Tentativa morta de rede que
já publicou só é apagada (o sucesso fica); as outras viram falha no histórico.

```sql
WITH destrava AS (
  UPDATE posts p
  SET status = 'failed', last_error = 'destravado: travado ao publicar por 20+ min'
  WHERE p.status = 'publishing'
    AND p.scheduled_at < now() - interval '20 minutes'
    AND NOT EXISTS (
      SELECT 1 FROM publications pu
      WHERE pu.post_id = p.id
        AND pu.status = 'publishing'
        AND pu.published_at > now() - interval '20 minutes'
    )
  RETURNING p.id
),
fecha AS (
  UPDATE publications pu
  SET status = 'failed', error = 'Publicação interrompida antes de terminar; o sistema tenta de novo.', published_at = NULL
  WHERE pu.status = 'publishing' AND pu.published_at < now() - interval '20 minutes'
    AND NOT EXISTS (
      SELECT 1 FROM publications s
      WHERE s.post_id = pu.post_id AND s.platform = pu.platform AND s.status = 'success'
    )
  RETURNING pu.id
),
limpa AS (
  DELETE FROM publications pu
  WHERE pu.status = 'publishing' AND pu.published_at < now() - interval '20 minutes'
    AND EXISTS (
      SELECT 1 FROM publications s
      WHERE s.post_id = pu.post_id AND s.platform = pu.platform AND s.status = 'success'
    )
  RETURNING pu.id
)
UPDATE posts
SET status = 'scheduled',
    scheduled_at = now() + (CASE retry_count WHEN 0 THEN interval '5 minutes' WHEN 1 THEN interval '30 minutes' ELSE interval '2 hours' END),
    retry_count = retry_count + 1
WHERE status = 'failed' AND retry_count < 3
  AND EXISTS (SELECT 1 FROM clients c WHERE c.id = posts.client_id AND c.agency_publishes = true)
RETURNING id, client_id, retry_count, last_error
```

### Voltar a query anterior (só em emergência)

O sistema novo continua aceitando o protocolo antigo (WF-01 marcando `publishing` antes
de chamar), então voltar as queries abaixo não causa publicação duplicada — só perde o
destrava pelo carimbo.

WF-01, nó "Busca fila (lock)":

```sql
UPDATE posts SET status='publishing' WHERE id IN (SELECT p.id FROM posts p JOIN clients c ON c.id = p.client_id WHERE p.status='scheduled' AND p.scheduled_at <= now() AND c.agency_publishes = true ORDER BY p.scheduled_at LIMIT 10 FOR UPDATE OF p SKIP LOCKED) AND status='scheduled' RETURNING id
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
  AND EXISTS (SELECT 1 FROM clients c WHERE c.id = posts.client_id AND c.agency_publishes = true)
RETURNING id, client_id, retry_count, last_error
```

O WF-02 antigo **não** volta: as rotas que entregavam tokens ao n8n foram removidas.
