# Rodar o sistema web localmente (modo visualização)

Guia para subir o `web/` na máquina e **ver o design e as telas** sem risco de
escrever no banco de produção e sem precisar das credenciais das integrações
externas (Meta, Google Drive, Gemini, R2, LinkedIn, Resend).

## Regra de ouro

**Nunca aponte o `.env` de desenvolvimento para o banco de produção.**

O sistema é fonte da verdade de clientes, tokens e fila de posts. Um clique em
"excluir post" ou "salvar cliente" na interface grava direto no banco que o
`DATABASE_URL` indicar. Se esse banco for o de produção, o dado real vai junto.

Use sempre um banco **clonado** (`socialflow_dev`) — ver passo 2.

## Pré-requisitos

- Node.js 20+ (testado com 25.9)
- Acesso ao Postgres onde o schema já está aplicado
- Client do Postgres 17+ instalado, para `pg_dump` / `pg_restore` / `psql`
  (no Windows: `C:\Program Files\PostgreSQL\18\bin`)

## 1. Instalar dependências

```bash
cd web
npm install
```

O `postinstall` roda `prisma generate` e gera o client em `src/generated/prisma`
(pasta gitignored). Não precisa de banco ativo para isso.

## 2. Clonar o banco de produção para `socialflow_dev`

O schema do SocialFlow já está aplicado em produção, então **não rode
`prisma db push` contra produção** — ele compara o `schema.prisma` com o banco e
pode alterar ou dropar colunas com dados reais.

Em vez disso, crie um clone. Substitua `USER`, `SENHA`, `HOST` e `PORTA` pelos
valores do seu servidor:

```bash
export PGPASSWORD='SENHA'

# cria o banco de desenvolvimento vazio
psql -h HOST -p PORTA -U USER -d postgres -c "CREATE DATABASE socialflow_dev;"

# dump de produção (operação somente leitura)
pg_dump -h HOST -p PORTA -U USER -d postgres \
  -Fc --no-owner --no-privileges -f prod.dump

# restaura no clone
pg_restore -h HOST -p PORTA -U USER -d socialflow_dev \
  --no-owner --no-privileges prod.dump
```

Confira que o clone tem as mesmas 9 tabelas (`users`, `clients`,
`social_accounts`, `meta_connections`, `schedules`, `posts`, `publications`,
`art_templates`, `daily_summaries`) com as mesmas contagens antes de seguir.

Apague o `prod.dump` depois — ele contém dados de clientes.

## 3. Criar o `web/.env`

Copie `web/.env.example` para `web/.env` e preencha **apenas** o necessário para
as telas renderizarem. O arquivo é gitignored (`web/.gitignore` cobre `.env*`).

```bash
# aponta para o CLONE, nunca para produção
DATABASE_URL="postgres://USER:SENHA@HOST:PORTA/socialflow_dev"

# segredos locais aleatórios — gere novos, não reaproveite os de produção
TOKEN_ENC_KEY="<64 hex>"
INTERNAL_API_KEY="<64 hex>"
MEDIA_SIGNING_SECRET="<64 hex>"
AUTH_SECRET="<base64url 32 bytes>"

AUTH_URL="http://localhost:3000"
SYSTEM_BASE_URL="http://localhost:3000"

# integrações externas ficam vazias no modo visualização
META_APP_ID=""
META_APP_SECRET=""
GEMINI_API_KEY=""
GOOGLE_SERVICE_ACCOUNT_FILE=""
DRIVE_ROOT_FOLDER_ID=""
R2_ACCOUNT_ID=""
R2_ACCESS_KEY_ID=""
R2_SECRET_ACCESS_KEY=""
R2_BUCKET=""
R2_PUBLIC_BASE_URL=""
LINKEDIN_CLIENT_ID=""
LINKEDIN_CLIENT_SECRET=""
RESEND_API_KEY=""
```

Para gerar os segredos:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"      # ENC/API/SIGNING
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" # AUTH_SECRET
```

### Por que as integrações podem ficar vazias

As telas leem do Postgres e renderizam normalmente. As chaves externas só são
usadas quando uma ação é disparada (publicar, gerar legenda com IA, sincronizar
o Drive, enviar e-mail de aprovação). Com elas vazias, o design aparece inteiro
e essas ações falham — que é o comportamento desejado num ambiente de
visualização.

### Sobre o `TOKEN_ENC_KEY`

Use uma chave **nova e aleatória**, não a de produção. Os tokens OAuth em
`social_accounts.access_token_enc` foram cifrados com a chave real (AES-256-GCM,
ver `src/lib/crypto.ts`), então uma chave diferente não os decifra. Isso é
proposital: impede publicação acidental nas redes dos clientes a partir do
ambiente local.

## 4. Criar um usuário de login no clone

O login é e-mail + senha com bcrypt contra a tabela `users` (`src/auth.ts`).
Crie um usuário **apenas no clone**:

```js
// seed-dev-user.js — rodar com: node --env-file=.env seed-dev-user.js
const { Client } = require("pg");
const bcrypt = require("bcryptjs");

(async () => {
  const url = process.env.DATABASE_URL || "";
  // guarda: aborta se apontar para qualquer banco que não seja o clone
  if (!/\/socialflow_dev$/.test(url)) {
    console.error("ABORTADO: DATABASE_URL não é socialflow_dev.");
    process.exit(1);
  }
  const c = new Client({ connectionString: url });
  await c.connect();
  const hash = await bcrypt.hash("dev123456", 10);
  await c.query(
    `insert into users (name, email, password_hash, role)
     values ($1, $2, $3, 'admin')
     on conflict (email) do update
       set password_hash = excluded.password_hash, role = 'admin'`,
    ["Dev Local", "dev@socialflow.local", hash]
  );
  console.log("usuário dev criado");
  await c.end();
})();
```

A guarda do `DATABASE_URL` não é opcional — é o que impede o seed de criar um
usuário admin em produção por engano.

Papéis: `admin` libera o menu completo; `staff` esconde os itens restritos
(ver `src/app/(app)/layout.tsx` e `src/lib/api-auth.ts`).

## 5. Subir o servidor

```bash
cd web
npm run dev
```

Abre em <http://localhost:3000>. Login: `dev@socialflow.local` / `dev123456`.

O `src/proxy.ts` (middleware do Next 16) redireciona qualquer rota não
autenticada para `/login`, exceto `/api` e `/aprovar`.

## Telas disponíveis

| Rota | Tela |
|---|---|
| `/` | Dashboard (resumo diário + visão geral) |
| `/calendar` | Calendário de postagens |
| `/posts` | Lista de posts |
| `/posts/new`, `/posts/[id]`, `/posts/[id]/edit` | Criar / ver / editar post |
| `/clients` | Lista de clientes |
| `/clients/new`, `/clients/[id]` | Criar / ver cliente |
| `/clients/[id]/accounts/new` | Vincular conta social |
| `/aprovacoes` | Aprovações de cronograma |
| `/templates` | Artes-base (plano básico) |
| `/users` | Usuários do sistema |
| `/meta` | Conexões Meta |
| `/aprovar/[token]` | Página pública de aprovação (sem login) |

## Limpeza

Ao terminar:

```bash
psql -h HOST -p PORTA -U USER -d postgres -c "DROP DATABASE socialflow_dev;"
rm prod.dump web/.env
```

Se você colou uma credencial de produção em algum lugar durante o processo
(chat, histórico de shell, issue), **rotacione a senha** do Postgres.
