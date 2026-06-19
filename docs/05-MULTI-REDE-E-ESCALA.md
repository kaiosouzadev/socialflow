# Multi-rede + escala (1 → todos os clientes)

> Como o WF-01 posta nas 3 redes no mesmo fluxo e como cresce de 1 cliente para
> todos sem virar bagunça. Dois JSONs:
> - `WF-01-instagram-publish.json` — versão simples (só IG, com polling completo). Boa para aprender.
> - `WF-01-multi-rede-escalavel.json` — versão de produção (3 redes + fila + lote).

## Regra que resolve tudo: 1 workflow, N linhas no banco

Você **não** cria um workflow por cliente nem por rede. Você tem **um** workflow que
processa a **fila de posts**. Adicionar cliente = inserir linhas em `clients`,
`social_accounts` e `posts`. O workflow não muda — nem para 1, nem para 500 clientes.

## Como as 3 redes convivem no mesmo fluxo

O nó **`Switch targets`** lê o campo `posts.targets` (array tipo `{instagram,facebook}`)
e dispara **só os branches presentes**, em paralelo (`allMatchingOutputs=true`).

```
post.targets = {instagram, facebook}        post.targets = {instagram, facebook, linkedin}
        │                                              │
   ┌────┴────┐                              ┌──────────┼──────────┐
   IG       FB        (linkedin inerte)     IG        FB        LinkedIn
```

- Cliente "só face e insta" (a maioria): `targets={instagram,facebook}`. O branch
  LinkedIn **nunca** é acionado pra ele. Custo zero.
- Cliente nas 3: `targets={instagram,facebook,linkedin}`. Os três branches rodam.

Diferença técnica por rede (por isso branches separados, não um só):
- **Instagram**: assíncrono → Container → poll status → publish. Branch mais longo.
- **Facebook**: síncrono → 1 chamada (`/{page}/photos|videos|feed`).
- **LinkedIn**: síncrono → 1 chamada (`/rest/posts`). **Fase 1.5** (exige App Review).

## Como escalar 1 → 5 → 10 → todos

| Você faz | Workflow muda? |
|---|---|
| 1º cliente nas 3 redes | cadastra cliente + contas + posts | **não** |
| Sobe pra 5 clientes | cadastra mais 4 | **não** |
| Sobe pra 10, 50, todos | idem | **não** |

O crescimento gradual que você quer é só **cadastrar o próximo cliente e inserir os
posts dele na fila**. Nunca mexe no n8n.

### Controles de carga (sem reescrever nada)
1. **`Split in Batches`**: processa N posts por vez. Lote pesado? Baixe o `LIMIT 10`
   da query / o tamanho do batch. Só um número.
2. **Rate-limit por conta**: o limite do Instagram é por conta. Cada conta tem
   `daily_post_limit`. Cheque `content_publishing_limit` antes de publicar.
3. **`scheduled_at`**: nunca "tudo de uma vez". Espalhe os horários. 400 posts entre
   40 clientes = 10/conta/dia. Folgado.

## Robustez para o Schedule (importante)

O Schedule roda a cada 5 min. Sem cuidado, o mesmo post seria pego duas vezes. A
query de `Busca fila (lock)` faz **lock otimista**:

```sql
UPDATE posts SET status='publishing'
WHERE id IN (SELECT id FROM posts
             WHERE status='scheduled' AND scheduled_at <= now()
             ORDER BY scheduled_at LIMIT 10)
RETURNING ...;
```

Marca como `publishing` e já retorna. A próxima execução do Schedule não vê esses
posts (não estão mais `scheduled`). No fim: `published`. Em erro de API: `failed` +
`retry_count`, que o WF-03 (retry) recupera com backoff.

## Roadmap de ativação (casa com seu "aumentar aos poucos")

1. Importe `WF-01-instagram-publish.json`, publique 1 imagem na conta de teste. Valida IG.
2. Importe `WF-01-multi-rede-escalavel.json`. Ligue só IG + FB. Rode com **1 cliente**.
3. Suba pra 5, depois 10 clientes — só inserindo na fila. Observe carga/erros.
4. Faça o App Review do LinkedIn. Quando aprovado, ligue o branch LinkedIn.
5. Abra para todos os clientes.

## Pendências reais antes de produção (não esquecer)
- Descriptografar `access_token_enc` (pgcrypto ou endpoint do sistema). No JSON está simplificado.
- Gravar em `publications` (1 linha por rede, com `external_post_id`).
- Tratamento de erro por branch → `status='failed'` + WF-03 retry.
- LinkedIn com imagem exige registrar o asset antes de postar (passo extra além do texto).
