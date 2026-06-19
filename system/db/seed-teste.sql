-- Dados de teste para validar o WF-01 sem ter o sistema pronto.
-- Rode DEPOIS do schema.sql. Substitua os valores marcados com <...>.

-- 1 cliente de teste (a propria agencia)
INSERT INTO clients (id, name, email, plan, tone_of_voice)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'Cliente Teste Agencia',
  'web@coletivoestudio.com.br',
  'sem_aprovacao',
  'Tom profissional e proximo, foco em seguros.'
);

-- Contas conectadas (use os IDs/token reais da conta de teste - ver 06-SETUP-META.md)
-- ATENCAO: em producao o token vai criptografado. Aqui simplificado para teste.
INSERT INTO social_accounts (client_id, platform, external_id, access_token_enc, daily_post_limit)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'instagram', '<IG_USER_ID>', '<PAGE_TOKEN>', 25),
  ('11111111-1111-1111-1111-111111111111', 'facebook',  '<PAGE_ID>',    '<PAGE_TOKEN>', 50);

-- 1 schedule do mes
INSERT INTO schedules (id, client_id, month_ref, status)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  date_trunc('month', now())::date,
  'aprovado_cliente'
);

-- 1 post na fila, pronto para sair agora, so IG + FB
INSERT INTO posts (schedule_id, client_id, theme, caption, media_url, scheduled_at, targets, status)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  'Post de teste',
  'Primeiro post automatico do SocialFlow #teste',
  'https://<URL_PUBLICA_DE_UMA_IMAGEM>.jpg',
  now(),                              -- sai imediatamente
  ARRAY['instagram','facebook'],      -- so face e insta (caso da maioria)
  'scheduled'
);

-- Para testar as 3 redes depois, troque targets por:
-- ARRAY['instagram','facebook','linkedin']
