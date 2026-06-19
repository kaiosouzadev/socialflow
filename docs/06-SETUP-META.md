# Setup Meta (Facebook + Instagram) — pré-requisito de tudo

> Antes de qualquer workflow publicar, você precisa de: um App na Meta, uma conta
> IG Business vinculada a uma Página FB, e um token de longa duração. Este é o
> caminho passo a passo. Faça com a **conta de teste da agência**, não com cliente.

## 0. Pré-condições
- Uma Página do Facebook (crie uma de teste da agência).
- Uma conta Instagram **Business ou Creator** (não pessoal).
- A conta IG **vinculada** à Página FB (nas configs do Instagram → Página conectada).

## 1. Criar o App
1. Acesse developers.facebook.com → My Apps → Create App.
2. Tipo: **Business**.
3. Anote o **App ID** e o **App Secret** (vão no `.env`: `META_APP_ID`, `META_APP_SECRET`).
4. Adicione os produtos: **Instagram Graph API** e **Facebook Login**.

## 2. Permissões necessárias (scopes)
Para publicar você vai precisar de:
- `instagram_basic`
- `instagram_content_publish`
- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_posts` (para publicar no FB)
- `business_management` (se gerenciar via Business Manager)

> Em **modo de desenvolvimento**, você consegue testar com as contas que são
> admin/dev do App, sem App Review. Para usar com contas de clientes reais em
> produção, precisa submeter para **App Review** dessas permissões.

## 3. Gerar token (caminho rápido para testar)
1. Vá no **Graph API Explorer** (developers.facebook.com/tools/explorer).
2. Selecione seu App e gere um **User Access Token** com os scopes acima.
3. Esse token é **curto** (~1-2h). Troque por um de **longa duração** (60 dias):

```
GET https://graph.facebook.com/v21.0/oauth/access_token
  ?grant_type=fb_exchange_token
  &client_id={META_APP_ID}
  &client_secret={META_APP_SECRET}
  &fb_exchange_token={TOKEN_CURTO}
```

4. Com o token longo, pegue o **Page Access Token** (esse é o que publica no FB):

```
GET https://graph.facebook.com/v21.0/me/accounts?access_token={TOKEN_LONGO}
```
Resposta traz cada Página e seu `access_token` (Page Token) + o `id` da Página.

## 4. Descobrir os IDs que você vai guardar
- **IG User ID** (para publicar no Instagram):
```
GET https://graph.facebook.com/v21.0/{PAGE_ID}?fields=instagram_business_account&access_token={PAGE_TOKEN}
```
Retorna `instagram_business_account.id` → esse é o `ig_user_id`.

- **Page ID**: veio no passo 3 (`/me/accounts`).

## 5. O que guardar em social_accounts (conta de teste)
| Campo | Valor |
|---|---|
| platform=`instagram` | external_id = IG User ID, token = Page Token |
| platform=`facebook` | external_id = Page ID, token = Page Token |

> O mesmo Page Token serve para IG e FB dessa Página. Guarde criptografado
> (`access_token_enc`). Para teste rápido, pode usar `IG_TEST_TOKEN` no `.env`.

## 6. Validar que está tudo certo (antes do workflow)
Teste manual de publicação de imagem (substitua valores):
```
# cria container
curl -X POST "https://graph.facebook.com/v21.0/{IG_USER_ID}/media" \
  -d "image_url=https://URL_PUBLICA.jpg" \
  -d "caption=teste socialflow" \
  -d "access_token={PAGE_TOKEN}"
# resposta: {"id":"CONTAINER_ID"}

# publica
curl -X POST "https://graph.facebook.com/v21.0/{IG_USER_ID}/media_publish" \
  -d "creation_id={CONTAINER_ID}" \
  -d "access_token={PAGE_TOKEN}"
```
Se a imagem aparecer no Instagram, o WF-01 vai funcionar. Se der erro aqui, resolva
antes de mexer no n8n — o problema é de credencial/permissão, não de workflow.

## Erros comuns
- **"media_url is not accessible"** → a URL precisa ser pública e ser o arquivo (jpg/mp4), não página.
- **"Application does not have permission"** → falta scope ou App Review.
- **PPA (Page Publishing Authorization)** → algumas Páginas exigem autorização extra do dono antes de publicar via API.
- **Conta IG não é Business** → converta para Business/Creator nas configs do Instagram.
