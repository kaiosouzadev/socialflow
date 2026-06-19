# system/ — utilitários de banco e scripts de dev

Rode a partir da pasta `web/` (onde estão as dependências) com `NODE_PATH` apontando
para `web/node_modules`, ou use `node ../system/...` de dentro de `web/`.

## db/ — schema e seeds
- `schema.sql` — schema SQL de referência (a fonte da verdade é o Prisma em `web/prisma`).
- `seed-admin.js` — cria/atualiza o usuário admin do painel.
- `seed-teste.sql` — dados de teste (cliente/contas/post) para o WF-01.
- `seed-unsplash.js` — cria um post de teste com imagem pública do Unsplash.

## scripts/ — testes e diagnóstico
- `test-crud.js` — valida CRUD + cascatas + criptografia contra o banco real.
- `test-gemini.js` / `test-calendar.js` — checam a API Gemini e os modelos.
- `test-zod.js` — sanity check de validações.
- `check-and-cleanup.js` — reseta posts presos em `publishing` e limpa placeholders.

> Esses scripts são apenas para desenvolvimento. Nenhum segredo é commitado:
> eles leem `web/.env` (gitignored).
