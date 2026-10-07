-- Migração: configurações do sistema (tabela app_settings)
--
-- Pedido do usuário (07/10): trocar o modelo de IA de TEXTO (legendas,
-- calendário, assistente, resumo do Dashboard, verificação de texto das artes)
-- por uma tela em Administração → "Modelos de IA", valendo na hora, sem deploy,
-- para comparar Gemini 3.7 Flash × 3.8 Flash (e, depois, o ChatGPT).
-- A geração de IMAGENS não muda (continua em GEMINI_IMAGE_MODEL).
--
-- Tabela chave → valor (JSONB), uma linha por configuração. Hoje só existe a
-- chave 'ai.textModel', com valor:
--   {"provider": "google", "model": "gemini-3.8-flash"}   → modelo escolhido
--   {"provider": "google", "model": null}                 → padrão do sistema
-- Sem linha = padrão do sistema (o comportamento de antes desta migração).
-- updated_by: quem salvou por último (users.id; vira NULL se a usuária for
-- excluída).
--
-- Só CREATE TABLE IF NOT EXISTS + FK com checagem por nome: nenhum dado
-- existente é alterado. Idempotente (pode rodar mais de uma vez) e
-- tudo-ou-nada (BEGIN … COMMIT). A tabela nasce VAZIA (= padrão do sistema).
--
-- Ordem de deploy indiferente: o código novo sem a tabela usa o padrão do
-- sistema (e só a tela "Modelos de IA" não salva); o código antigo ignora a
-- tabela.
--   psql "$DATABASE_URL" -f system/migrations/2026-10-07-app-settings.sql

BEGIN;

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'app_settings_updated_by_fkey' AND conrelid = 'app_settings'::regclass
  ) THEN
    ALTER TABLE app_settings
      ADD CONSTRAINT app_settings_updated_by_fkey
      FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;

-- Conferência:
--   -- 4 colunas: key text NO, value jsonb NO, updated_at timestamptz NO, updated_by uuid YES
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--   WHERE table_name = 'app_settings' ORDER BY ordinal_position;
--
--   -- 1 linha: FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'app_settings_updated_by_fkey';
--
--   -- configuração atual do modelo de texto (sem linha = padrão do sistema)
--   SELECT value, updated_at, updated_by FROM app_settings WHERE key = 'ai.textModel';
