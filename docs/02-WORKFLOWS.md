# Workflows n8n — Fase 1: Publicação

> Você quer começar pelos workflows de postagem. Este é o plano. Você já tem uma
> base (vídeo do YouTube → Instagram). Vamos generalizar a partir dela.

## Princípio: 1 workflow genérico, não 1 por cliente

Você disse que "cada cliente tem um workflow diferente". **Não construa um workflow
por cliente** — isso não escala para 400. Em vez disso:

- **Um workflow de publicação genérico**, parametrizado.
- O que muda por cliente (quais redes, qual conta, qual mídia) vem como **dados de
  entrada**, lido do Postgres. O workflow é o mesmo; os dados é que variam.

A maioria dos seus clientes é "só Face e Insta". Isso vira um campo `targets =
{facebook, instagram}` no post. O workflow tem um branch por rede e só executa os
branches presentes em `targets`.

## Workflows da fase 1

### WF-01 — Publicação (o core)
```
Trigger (webhook OU schedule poll a cada 5min)
  └─ Busca posts com status=scheduled e scheduled_at <= now()  [Postgres]
      └─ Para cada post:
          ├─ Checa rate limit da conta (content_publishing_limit)
          ├─ Branch Instagram (se 'instagram' in targets)
          │     ├─ Cria container de mídia (POST /{ig_id}/media)
          │     ├─ Aguarda processamento (mídia/vídeo demora)
          │     └─ Publica (POST /{ig_id}/media_publish)
          ├─ Branch Facebook (se 'facebook' in targets)
          │     └─ POST /{page_id}/photos|videos|feed
          ├─ Branch LinkedIn (se 'linkedin' in targets)  ← fase 1.5
          │     └─ POST /rest/posts (UGC)
          └─ Grava resultado em publications + atualiza posts.status
```

### WF-02 — Refresh de tokens
```
Schedule (1x/dia)
  └─ Busca social_accounts com token_expires_at < now()+7d
      └─ Troca por token de longa duração (fb_exchange_token)
          └─ Atualiza access_token_enc + token_expires_at no Postgres
```

### WF-03 — Retry de falhas
```
Schedule (a cada 15min)
  └─ Busca posts com status=failed e retry_count < 3
      └─ Reagenda com backoff (5min, 30min, 2h)
```

## Sua base atual: vídeo YouTube → Instagram

Generalizando seu fluxo existente, o caminho para Instagram REELS via API é:

1. **Obter o arquivo de vídeo** — a Graph API faz cURL na `video_url`, e ela precisa
   ser **URL pública do arquivo** (mp4 acessível), **não link do YouTube**.
   - Se a fonte é YouTube: baixar o vídeo → subir para R2/S3 (você já usa Cloudflare,
     R2 é natural) → usar a URL pública do R2.
2. **Criar container**: `POST /{ig_id}/media` com `media_type=REELS` e `video_url`.
3. **Aguardar**: vídeo processa de forma assíncrona. Faça polling em
   `GET /{container_id}?fields=status_code` até `FINISHED`.
4. **Publicar**: `POST /{ig_id}/media_publish` com o `creation_id`.

> O passo 3 é onde a maioria erra: publicar antes do `FINISHED` retorna erro.
> Use um nó Wait + loop de verificação, não um Wait fixo.

## Endpoints de referência (fase 1)

| Ação | Endpoint |
|---|---|
| IG criar container | `POST /{ig-user-id}/media` |
| IG status container | `GET /{container-id}?fields=status_code` |
| IG publicar | `POST /{ig-user-id}/media_publish` |
| IG checar limite | `GET /{ig-user-id}/content_publishing_limit` |
| FB foto | `POST /{page-id}/photos` |
| FB vídeo | `POST /{page-id}/videos` |
| LinkedIn post | `POST /rest/posts` (header `LinkedIn-Version`) |

## Ordem de implementação sugerida

1. WF-01 só com branch **Instagram imagem** (mais simples, valida o fluxo ponta a ponta).
2. Adiciona branch **Facebook**.
3. Adiciona **Instagram Reels/vídeo** (mídia assíncrona).
4. WF-02 (refresh) — antes de ir pra produção, senão tokens expiram.
5. WF-03 (retry).
6. **LinkedIn por último** (depende de App Review aprovado).

## Teste sem queimar conta de cliente

Crie uma Página FB + conta IG Business **de teste** (da própria agência) e use ela
como cobaia até o WF estar redondo. Nunca itere direto na conta de um cliente.
