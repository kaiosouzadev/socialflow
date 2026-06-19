# Método do vídeo (print) → projeto

> O print que você enviou é o workflow ensinado no vídeo
> (youtube.com/watch?v=I74Z8KaFDL4). Ele mostra o **fluxo canônico de publicação no
> Instagram via Graph API**. Este doc mapeia esse método para o nosso projeto e
> aponta o que mudar para produção/escala.

## O que o print mostra

```
When clicking 'Test workflow'  →  inputs (manual)  →  Container  →  Wait  →  Facebook Graph API
```

| Nó do print | O que faz na prática | Endpoint Graph API |
|---|---|---|
| `When clicking 'Test workflow'` | Trigger manual (só para testar) | — |
| `inputs` (manual) | Define dados do post: media_url, caption, ig_user_id | — |
| `Container` | Cria o container de mídia | `POST /{ig-user-id}/media` |
| `Wait` | Espera a mídia processar antes de publicar | — |
| `Facebook Graph API` | Publica o container processado | `POST /{ig-user-id}/media_publish` |

**O vídeo confirma a arquitetura que já montamos.** O detalhe importante é o `Wait`:
ele existe porque o Instagram processa a mídia de forma assíncrona — publicar antes
de terminar dá erro. Esse era exatamente o ponto de atenção nº 3 do `02-WORKFLOWS.md`.

## O que serve direto e o que mudar para o nosso caso

### Serve direto (é a base correta)
- A sequência **Container → espera → media_publish** é a forma certa. Mantemos.
- Para **imagem**, um `Wait` de poucos segundos costuma bastar.

### O que mudar para produção e escala (400+)

1. **Trigger manual → automático.** O `Test workflow` é só para testar. Em produção,
   o disparo vem da fila: ou um `Schedule` que lê `posts` com `scheduled_at <= now()`,
   ou um `Webhook` chamado pelo sistema. Ver `02-WORKFLOWS.md` (WF-01).

2. **`inputs` manual → leitura do Postgres.** Em vez de digitar os dados, o workflow
   lê o post da tabela `posts` (media_url, caption, conta, targets). Um workflow
   genérico, não um por cliente.

3. **`Wait` fixo → polling de status (crítico para VÍDEO).** Para Reels/vídeo, troque
   o Wait fixo por um loop:
   ```
   Container → [loop] GET /{container-id}?fields=status_code
            → status == FINISHED ?  sim → media_publish
                                     não → Wait 5s → volta ao GET
   ```
   Vídeo grande pode levar de segundos a minutos. Wait fixo vai publicar cedo demais
   e falhar de forma intermitente (o pior tipo de bug).

4. **Adicionar checagem de rate limit** antes do Container:
   `GET /{ig-user-id}/content_publishing_limit` — respeitar `daily_post_limit` da conta.

5. **Gravar resultado** em `publications` e atualizar `posts.status`.

6. **Branch Facebook** em paralelo (a maioria dos seus clientes é IG + FB).

## Sobre "vídeo do YouTube"

Importante separar duas coisas que o vídeo pode misturar:

- **Postar o link do YouTube como texto** no Facebook/Instagram: trivial, é só a
  caption.
- **Postar o vídeo em si como Reel no Instagram:** a Graph API faz cURL na `video_url`
  e ela precisa ser **URL pública do arquivo .mp4** — link do YouTube NÃO funciona.
  Seria preciso baixar o vídeo e hospedar (R2/Cloudflare) antes. Confirme no vídeo
  qual dos dois casos ele cobre; o print sozinho sugere o fluxo de mídia (Container),
  então provavelmente é mídia hospedada.

## Próximo passo

O JSON em `workflows/WF-01-instagram-publish.json` implementa esse método já corrigido
(polling em vez de Wait fixo, parametrizado). Importe no n8n e ajuste credenciais.
