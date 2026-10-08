-- Segurança (auditoria OWASP 07/10): versão de sessão por usuária e trilha de auditoria.
-- Idempotente; só acrescenta coluna e tabela; não altera dados existentes.
BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  at          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  actor_id    UUID NULL REFERENCES users(id) ON DELETE SET NULL ON UPDATE NO ACTION,
  actor_email TEXT NULL,
  action      TEXT NOT NULL,
  target_type TEXT NULL,
  target_id   TEXT NULL,
  client_id   UUID NULL,
  meta        JSONB NULL,
  ip          TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log (at);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action);
CREATE INDEX IF NOT EXISTS idx_audit_log_client ON audit_log (client_id);

COMMIT;
