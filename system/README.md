# system/ — utilitários de banco e scripts de dev

Rode a partir da pasta `web/` (onde estão as dependências) com `NODE_PATH` apontando
para `web/node_modules`, ou use `node ../system/...` de dentro de `web/`.

## db/ — schema e seeds
- `schema.sql` — schema SQL de referência (a fonte da verdade é o Prisma em `web/prisma`).
- `seed-admin.js` — cria/atualiza o usuário admin do painel.
- `seed-teste.sql` — dados de teste (cliente/contas/post) para o WF-01.
- `seed-unsplash.js` — cria um post de teste com imagem pública do Unsplash.

## scripts/ — diagnóstico
- `inspect-db.js` — visão rápida do banco (clientes, contas, conexões, posts).
- `diag-drive.js` — diagnóstico do acesso da service account ao Google Drive.

> Scripts one-off de teste/debug foram removidos após a validação (histórico no git).
> Nenhum segredo é commitado: os scripts leem `web/.env` (gitignored).
