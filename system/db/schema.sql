-- SocialFlow - schema inicial (PostgreSQL)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE clients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  plan          TEXT NOT NULL DEFAULT 'sem_aprovacao',
  tone_of_voice TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE social_accounts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID REFERENCES clients(id) ON DELETE CASCADE,
  platform           TEXT NOT NULL,
  external_id        TEXT NOT NULL,
  access_token_enc   TEXT NOT NULL,
  token_expires_at   TIMESTAMPTZ,
  daily_post_limit   INT DEFAULT 25,
  status             TEXT DEFAULT 'active',
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE schedules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES clients(id) ON DELETE CASCADE,
  month_ref   DATE NOT NULL,
  status      TEXT DEFAULT 'rascunho',
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE posts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id     UUID REFERENCES schedules(id) ON DELETE CASCADE,
  client_id       UUID REFERENCES clients(id) ON DELETE CASCADE,
  theme           TEXT,
  caption         TEXT,
  media_url       TEXT,
  scheduled_at    TIMESTAMPTZ NOT NULL,
  targets         TEXT[] NOT NULL,
  status          TEXT DEFAULT 'scheduled',
  retry_count     INT DEFAULT 0,
  last_error      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE publications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       UUID REFERENCES posts(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL,
  external_post_id TEXT,
  status        TEXT DEFAULT 'pending',
  error         TEXT,
  published_at  TIMESTAMPTZ
);

CREATE INDEX idx_posts_due ON posts (scheduled_at) WHERE status = 'scheduled';
CREATE INDEX idx_accounts_client ON social_accounts (client_id);
CREATE INDEX idx_tokens_expiring ON social_accounts (token_expires_at) WHERE status='active';
