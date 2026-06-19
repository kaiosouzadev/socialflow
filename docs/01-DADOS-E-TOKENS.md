# Modelo de Dados & Tokens OAuth

> Você respondeu "não pensei nisso ainda" sobre tokens. Esta é a parte mais
> importante de acertar cedo — errar aqui custa caro depois.

## Onde guardar os tokens OAuth (a decisão)

**Recomendação: tokens no Postgres do sistema, criptografados. NÃO nas credentials
do n8n.**

Por quê não no n8n:
- As credentials do n8n são pensadas para "1 conta por serviço", não para 400
  contas de clientes diferentes. Vira um inferno gerenciar 400 credentials.
- Você perde visibilidade programática (não dá pra consultar "quais tokens vencem
  essa semana" facilmente).
- O sistema é a fonte da verdade — o token pertence ao cliente, que vive no sistema.

Como fazer:
- Tabela `social_accounts` guarda o token **criptografado** (ex.: AES via uma chave
  em variável de ambiente, ou pgcrypto).
- O n8n, na hora de publicar, faz um HTTP Request ao sistema (`GET /internal/token/:account_id`)
  ou lê direto do Postgres via node Postgres. O sistema descriptografa e devolve.
- WF de refresh de token roda no n8n e **atualiza a linha no Postgres**.

> Nunca coloque token em URL/query string. Sempre header ou body.

## Schema mínimo (PostgreSQL)

```sql
-- Clientes da agência
CREATE TABLE clients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  plan          TEXT NOT NULL DEFAULT 'sem_aprovacao', -- com_aprovacao | sem_aprovacao
  tone_of_voice TEXT,                                  -- orienta a IA (fase 2)
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Contas de rede social conectadas (1 cliente -> N contas)
CREATE TABLE social_accounts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID REFERENCES clients(id) ON DELETE CASCADE,
  platform           TEXT NOT NULL,        -- instagram | facebook | linkedin
  external_id        TEXT NOT NULL,        -- IG user id / FB page id / LinkedIn urn
  access_token_enc   TEXT NOT NULL,        -- token CRIPTOGRAFADO
  token_expires_at   TIMESTAMPTZ,
  daily_post_limit   INT DEFAULT 25,       -- configurável por conta (ver arquitetura)
  status             TEXT DEFAULT 'active',
  created_at         TIMESTAMPTZ DEFAULT now()
);

-- Cronograma mensal (Rodada A do POP)
CREATE TABLE schedules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES clients(id) ON DELETE CASCADE,
  month_ref   DATE NOT NULL,               -- mês de referência
  status      TEXT DEFAULT 'rascunho',     -- ver tabela de status do POP
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Cada post individual (fila de publicação)
CREATE TABLE posts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id     UUID REFERENCES schedules(id) ON DELETE CASCADE,
  client_id       UUID REFERENCES clients(id) ON DELETE CASCADE,
  theme           TEXT,
  caption         TEXT,                     -- texto gerado pela IA (fase 2)
  media_url       TEXT,                     -- URL pública da mídia (arte/vídeo)
  scheduled_at    TIMESTAMPTZ NOT NULL,     -- quando publicar
  targets         TEXT[] NOT NULL,          -- {instagram,facebook,linkedin}
  status          TEXT DEFAULT 'scheduled', -- scheduled|publishing|published|failed
  retry_count     INT DEFAULT 0,
  last_error      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Resultado por rede de cada post (1 post -> N publicações)
CREATE TABLE publications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       UUID REFERENCES posts(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL,
  external_post_id TEXT,                    -- id retornado pela rede
  status        TEXT DEFAULT 'pending',     -- pending|success|failed
  error         TEXT,
  published_at  TIMESTAMPTZ
);
```

## Mapa POP → banco

O seu POP já define os status do ciclo. Eles viram a coluna `schedules.status` e
`posts.status`. A "Rodada A" mexe em `schedules`; a "Rodada B" e a publicação mexem
em `posts`. O "laço de revisão" é transição de status, não tabela nova.

## Índices que você vai querer

```sql
CREATE INDEX idx_posts_due ON posts (scheduled_at) WHERE status = 'scheduled';
CREATE INDEX idx_accounts_client ON social_accounts (client_id);
CREATE INDEX idx_tokens_expiring ON social_accounts (token_expires_at) WHERE status='active';
```
