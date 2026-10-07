-- Migração: e-mail principal repetido para cliente SEM aprovação
--
-- Pedido do usuário (07/10): ao criar um cliente "sem aprovação", poder usar um
-- e-mail que já está em outro cliente (o caso de uso é o e-mail da agência,
-- @coletivoestudio.com.br). Regra nova de clients.email:
--   - plan = 'sem_aprovacao': pode repetir o e-mail de qualquer outro cliente;
--   - plan = 'aprovacao_cliente': continua único ENTRE os clientes com aprovação
--     (é para ele que vão os links de aprovação), sem diferenciar maiúsculas.
--     Pode coincidir com o e-mail de clientes sem aprovação.
--
-- O que muda:
--   1) confere antes se já há 2+ clientes COM aprovação com o mesmo e-mail
--      (lower(email)); se houver, ABORTA com mensagem e nada é aplicado;
--   2) remove a unicidade antiga de clients.email (o @unique do Prisma, índice
--      clients_email_key; se em algum banco ela existir como CONSTRAINT, ou com
--      outro nome, também é removida);
--   3) cria o índice único parcial uq_clients_email_aprovacao em lower(email)
--      WHERE plan = 'aprovacao_cliente'.
--
-- Nenhum dado é alterado, nenhuma coluna muda. Idempotente (pode rodar mais de
-- uma vez) e tudo-ou-nada (BEGIN … COMMIT).
-- O Prisma não modela índice parcial: em web/prisma/schema.prisma o campo
-- email fica sem @unique e a regra vive só aqui. NÃO usar `prisma db push`
-- neste banco (ele removeria este índice).
--
-- Ordem de deploy indiferente: o código novo com a restrição antiga só recusa
-- e-mail repetido (como hoje); o banco novo com o código antigo funciona.
--   psql "$DATABASE_URL" -f system/migrations/2026-10-07-email-cliente-sem-aprovacao.sql

BEGIN;

-- 1) conflitos que impediriam o índice novo → aborta sem aplicar nada
DO $$
DECLARE
  conflitos TEXT;
BEGIN
  SELECT string_agg(format('%s (%s clientes)', e, n), ', ' ORDER BY e)
    INTO conflitos
  FROM (
    SELECT lower(email) AS e, count(*) AS n
    FROM clients
    WHERE plan = 'aprovacao_cliente'
    GROUP BY lower(email)
    HAVING count(*) > 1
  ) d;
  IF conflitos IS NOT NULL THEN
    RAISE EXCEPTION 'Migração cancelada: há clientes com aprovação usando o mesmo e-mail: %. Troque o e-mail de um deles (ou marque-o como sem aprovação) e rode de novo. Nada foi alterado.', conflitos;
  END IF;
END $$;

-- 2) remove a unicidade antiga de clients.email
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_email_key;
DROP INDEX IF EXISTS clients_email_key;

-- rede de segurança: qualquer outro índice/constraint ÚNICO, sem filtro, só na
-- coluna email (nome diferente em algum banco)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT i.indexrelid::regclass::text AS idx, c.conname
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    LEFT JOIN pg_constraint c
      ON c.conindid = i.indexrelid AND c.conrelid = i.indrelid AND c.contype = 'u'
    WHERE i.indrelid = 'clients'::regclass
      AND i.indisunique AND NOT i.indisprimary
      AND i.indpred IS NULL AND i.indexprs IS NULL
      AND i.indnatts = 1 AND a.attname = 'email'
  LOOP
    IF r.conname IS NOT NULL THEN
      EXECUTE format('ALTER TABLE clients DROP CONSTRAINT %I', r.conname);
    ELSE
      EXECUTE format('DROP INDEX %s', r.idx);
    END IF;
  END LOOP;
END $$;

-- 3) regra nova: único só entre os clientes COM aprovação (sem diferenciar maiúsculas)
CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_email_aprovacao
  ON clients (lower(email))
  WHERE plan = 'aprovacao_cliente';

COMMIT;

-- Conferência:
--   -- 0 linhas: nenhuma unicidade antiga (índice único sem filtro em email)
--   SELECT indexname FROM pg_indexes
--   WHERE tablename = 'clients' AND indexdef LIKE 'CREATE UNIQUE INDEX%(email)';
--
--   -- 1 linha: ... USING btree (lower(email)) WHERE (plan = 'aprovacao_cliente'::text)
--   SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_clients_email_aprovacao';
--
--   -- 0 linhas: nenhum e-mail repetido entre clientes com aprovação
--   SELECT lower(email), count(*) FROM clients
--   WHERE plan = 'aprovacao_cliente' GROUP BY 1 HAVING count(*) > 1;
