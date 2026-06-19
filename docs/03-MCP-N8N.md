# MCP do n8n + Claude Code

> Sim, dá pra conectar o n8n ao Claude Code via MCP. É a forma certa de desenvolver
> os workflows com assistência — o Claude Code passa a ler/criar/editar/testar
> workflows direto, sem você ficar arrastando nós no navegador.

## Dois MCPs possíveis (escolha)

| MCP | O que faz | Quando usar |
|---|---|---|
| **n8n oficial** | Build/run/update workflows na sua instância | Você já tem n8n self-hosted e quer o caminho nativo |
| **czlonkowski/n8n-mcp** | + conhecimento de ~1850 nodes, validação | Recomendado: erra muito menos, valida antes de criar |

Recomendação: **czlonkowski/n8n-mcp**. Ele dá ao Claude Code conhecimento profundo
dos nodes (parâmetros, expressões, gotchas), o que reduz drasticamente workflow
quebrado. Existe também o pacote de skills `n8n-skills` que complementa.

## Setup (czlonkowski/n8n-mcp)

1. Gere uma **API key** no seu n8n: Settings → n8n API → Create API Key.
2. No projeto, registre o MCP no Claude Code (`.mcp.json` na raiz):

```json
{
  "mcpServers": {
    "n8n": {
      "command": "npx",
      "args": ["-y", "n8n-mcp"],
      "env": {
        "N8N_API_URL": "https://SEU-N8N.seguruvps.com.br",
        "N8N_API_KEY": "SUA_API_KEY_AQUI",
        "MCP_MODE": "stdio"
      }
    }
  }
}
```

3. (Opcional) Instale as skills: no repo `czlonkowski/n8n-skills`, siga o README
   para instalar como skills do Claude Code.

## Segurança: comece read-only

Não dê permissão de escrita automática logo de cara. Deixe o Claude Code **ler e
propor**, e você aprova create/update/activate manualmente até confiar. Especialmente
porque ativar um workflow com side-effects reais (publicar de verdade) é perigoso.

> Cuidado com **test executions em workflows ativos que têm efeito real** (publicar
> de verdade num cliente). Sempre teste no workflow de cobaia.

## .env (NÃO commitar)

```
N8N_API_URL=https://seu-n8n.seguruvps.com.br
N8N_API_KEY=...
POSTGRES_URL=postgres://...
TOKEN_ENC_KEY=...        # chave de criptografia dos tokens OAuth
META_APP_ID=...
META_APP_SECRET=...
GEMINI_API_KEY=...       # fase 2
```
