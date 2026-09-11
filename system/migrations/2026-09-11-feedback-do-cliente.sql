-- Migração: comentários do cliente no link de aprovação
--
-- Habilita o botão "Solicitar ajustes" na tela pública /aprovar/[token]:
-- o cliente pode comentar o cronograma inteiro e/ou cada post, em vez de
-- só editar a legenda ele mesmo.
--
-- Todas as colunas são NULL e aditivas — nenhum dado existente é alterado
-- e o script é idempotente (pode rodar mais de uma vez sem erro).
--
-- Rodar ANTES de subir o deploy que usa estas colunas:
--   psql "$DATABASE_URL" -f system/migrations/2026-09-11-feedback-do-cliente.sql

BEGIN;

-- comentário geral do cliente + quando ele pediu ajustes
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS client_note TEXT;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS changes_asked_at TIMESTAMPTZ;

-- comentário do cliente por post
ALTER TABLE posts ADD COLUMN IF NOT EXISTS client_note TEXT;

COMMIT;

-- Conferência:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name IN ('schedules','posts') AND column_name LIKE 'c%_note';
