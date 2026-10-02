-- Migração: produção da redação + "a agência agenda e publica?"
--
-- Leva para o sistema o que hoje vive na planilha "Controle da Gestão" e no
-- documento mensal de cada cliente:
--   - clients.agency_publishes: com false, nenhum post do cliente entra na
--     fila (scheduled/publishing/published) — só produção. Default true =
--     comportamento atual;
--   - clients.extra_emails: e-mails adicionais (o principal continua em
--     clients.email, @unique);
--   - clients.status / status_changed_at: ativo | pausado | encerrado
--     (organizacional; não bloqueia publicação);
--   - clients.segment: CORR | CARE | COLETIVO (validado no zod);
--   - clients.responsible_user_id: redatora responsável pelo cliente;
--   - posts.writer_id: redatora do post;
--   - posts.internal_note: nota interna (nunca aparece nas páginas públicas);
--   - pending_items: pendências e stand-by (posts sem data, aguardando
--     material do cliente, avulsos).
--
-- Só ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS / CREATE INDEX IF
-- NOT EXISTS: nenhum dado existente é alterado, nada é removido e nenhum tipo
-- muda. As FKs das colunas novas são adicionadas à parte, com checagem por
-- nome em pg_constraint, para o script poder rodar mais de uma vez sem erro
-- e sem duplicar constraint.
--
-- Rodar ANTES de subir o deploy que usa estas colunas e ANTES de atualizar os
-- workflows WF-01/WF-03 no n8n (o SQL deles passa a ler agency_publishes):
--   psql "$DATABASE_URL" -f system/migrations/2026-10-01-producao-e-publicacao.sql

BEGIN;

-- ---------------------------------------------------------------- clients
ALTER TABLE clients ADD COLUMN IF NOT EXISTS agency_publishes BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS extra_emails TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ativo';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS segment TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS responsible_user_id UUID;

-- ------------------------------------------------------------------ posts
ALTER TABLE posts ADD COLUMN IF NOT EXISTS writer_id UUID;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS internal_note TEXT;

-- ---------------------------------------- FKs das colunas novas (idempotente)
-- Excluir uma usuária-redatora não apaga nada: a referência vira NULL.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'clients_responsible_user_id_fkey' AND conrelid = 'clients'::regclass
  ) THEN
    ALTER TABLE clients
      ADD CONSTRAINT clients_responsible_user_id_fkey
      FOREIGN KEY (responsible_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'posts_writer_id_fkey' AND conrelid = 'posts'::regclass
  ) THEN
    ALTER TABLE posts
      ADD CONSTRAINT posts_writer_id_fkey
      FOREIGN KEY (writer_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------- pending_items
-- kind: stand_by | aguardando_material | avulso | outro (validado no zod)
CREATE TABLE IF NOT EXISTS pending_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID NOT NULL
                      CONSTRAINT pending_items_client_id_fkey REFERENCES clients(id) ON DELETE CASCADE,
  post_id             UUID
                      CONSTRAINT pending_items_post_id_fkey REFERENCES posts(id) ON DELETE SET NULL,
  kind                TEXT NOT NULL DEFAULT 'stand_by',
  title               TEXT NOT NULL,
  details             TEXT,
  responsible_user_id UUID
                      CONSTRAINT pending_items_responsible_user_id_fkey REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pending_items_client ON pending_items (client_id);
CREATE INDEX IF NOT EXISTS idx_pending_items_resolved ON pending_items (resolved_at);

COMMIT;

-- Conferência:
--   -- 8 linhas (6 em clients, 2 em posts)
--   SELECT table_name, column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE (table_name = 'clients' AND column_name IN
--          ('agency_publishes','extra_emails','status','status_changed_at','segment','responsible_user_id'))
--      OR (table_name = 'posts' AND column_name IN ('writer_id','internal_note'))
--   ORDER BY table_name, column_name;
--
--   -- tabela nova
--   SELECT to_regclass('public.pending_items');
--
--   -- deve dar 0: nenhum cliente existente mudou de comportamento
--   SELECT count(*) FROM clients
--   WHERE agency_publishes IS NOT TRUE OR status <> 'ativo' OR extra_emails <> '{}';
--
--   -- FKs (3 em pending_items + 2 nas colunas novas)
--   SELECT conname FROM pg_constraint
--   WHERE conname IN ('clients_responsible_user_id_fkey','posts_writer_id_fkey',
--                     'pending_items_client_id_fkey','pending_items_post_id_fkey',
--                     'pending_items_responsible_user_id_fkey');
