-- Migração: página de Designers — designer do cliente e "arte feita" por post
--
-- Leva para o sistema a fila de artes da equipe de design:
--   - clients.designer_user_id: designer responsável pelo cliente (igual à
--     redatora em responsible_user_id). Excluir a usuária não apaga nada: a
--     referência vira NULL;
--   - posts.art_done_at: quando a designer marcou a arte como feita
--     (NULL = arte não marcada; a regra de "arte feita" também aceita o post
--     com mídia ou já publicado — web/src/lib/production.ts, hasArt);
--   - posts.art_done_by: quem marcou (users.id; NULL se a usuária for
--     excluída).
--
-- Só ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS: nenhum dado
-- existente é alterado, nada é removido e nenhum tipo muda. Todas as colunas
-- novas são NULL sem default (nenhum post existente passa a "arte feita" por
-- causa desta migração). As FKs são adicionadas à parte, com checagem por nome
-- em pg_constraint, para o script poder rodar mais de uma vez sem erro e sem
-- duplicar constraint.
--
-- Rodar ANTES de subir o deploy que usa estas colunas (o Prisma passa a ler
-- clients.designer_user_id e posts.art_done_at/art_done_by):
--   psql "$DATABASE_URL" -f system/migrations/2026-10-06-arte-designer.sql

BEGIN;

-- ---------------------------------------------------------------- clients
ALTER TABLE clients ADD COLUMN IF NOT EXISTS designer_user_id UUID;

-- ------------------------------------------------------------------ posts
ALTER TABLE posts ADD COLUMN IF NOT EXISTS art_done_at TIMESTAMPTZ;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS art_done_by UUID;

-- ---------------------------------------- FKs das colunas novas (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'clients_designer_user_id_fkey' AND conrelid = 'clients'::regclass
  ) THEN
    ALTER TABLE clients
      ADD CONSTRAINT clients_designer_user_id_fkey
      FOREIGN KEY (designer_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'posts_art_done_by_fkey' AND conrelid = 'posts'::regclass
  ) THEN
    ALTER TABLE posts
      ADD CONSTRAINT posts_art_done_by_fkey
      FOREIGN KEY (art_done_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------- índices
-- fila de artes: filtro por "feita/não feita" e por designer
CREATE INDEX IF NOT EXISTS idx_posts_art_done_at ON posts (art_done_at);
CREATE INDEX IF NOT EXISTS idx_clients_designer ON clients (designer_user_id);

COMMIT;

-- Conferência:
--   -- 3 linhas (1 em clients, 2 em posts), todas is_nullable = YES e sem default
--   SELECT table_name, column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE (table_name = 'clients' AND column_name = 'designer_user_id')
--      OR (table_name = 'posts' AND column_name IN ('art_done_at','art_done_by'))
--   ORDER BY table_name, column_name;
--
--   -- deve dar 0 e 0: nenhum dado existente mudou
--   SELECT count(*) FROM clients WHERE designer_user_id IS NOT NULL;
--   SELECT count(*) FROM posts WHERE art_done_at IS NOT NULL OR art_done_by IS NOT NULL;
--
--   -- FKs (2 novas) + a da redatora (já existente), todas ON DELETE SET NULL (confdeltype = 'n')
--   SELECT conname, confdeltype FROM pg_constraint
--   WHERE conname IN ('clients_designer_user_id_fkey','posts_art_done_by_fkey',
--                     'clients_responsible_user_id_fkey');
--
--   -- índices
--   SELECT indexname FROM pg_indexes
--   WHERE indexname IN ('idx_posts_art_done_at','idx_clients_designer');
