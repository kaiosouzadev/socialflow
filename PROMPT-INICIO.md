# PROMPT DE INÍCIO — cole no Claude Code

> Copie o bloco abaixo e cole na primeira mensagem do Claude Code, com este projeto
> aberto e o MCP do n8n configurado (`.mcp.json`). O objetivo desta fase é deixar o
> **workflow de publicação rodando ponta a ponta numa conta de teste**, antes de
> qualquer linha do sistema web.

---

Estou desenvolvendo o SocialFlow, um sistema de automação de postagens em redes
sociais (Instagram, Facebook, LinkedIn) para clientes de uma agência. A arquitetura,
o modelo de dados e os workflows já estão documentados na pasta `docs/` e na raiz
(`CLAUDE.md`, `README.md`). Leia esses arquivos antes de começar — eles são a fonte
da verdade e definem decisões que não devem ser revertidas sem discussão.

Contexto da fase atual: quero começar SÓ pelos workflows de publicação no n8n
(self-hosted), testando numa conta de teste da própria agência. O sistema web eu
desenvolvo em paralelo depois. Não comece o sistema agora.

Você tem o MCP do n8n disponível. Use-o em modo de leitura/proposta primeiro: leia o
estado, proponha as mudanças, e me peça confirmação antes de criar/ativar qualquer
workflow que publique de verdade (efeito real).

Quero que você me conduza, na ordem, por estes passos:

1. Revise comigo o `docs/06-SETUP-META.md` e confirme que eu já tenho: App na Meta,
   conta IG Business vinculada a Página FB, e um Page Token de longa duração da conta
   de teste. Se eu não tiver, me guie para obter cada item. NÃO prossiga sem isso.

2. Valide o token com a chamada curl de teste do passo 6 do `06-SETUP-META.md`
   (criar container + publicar uma imagem). Se falhar aqui, resolvemos credencial/
   permissão antes de tocar no n8n.

3. Suba o Postgres (se ainda não estiver), rode `system/schema.sql` e depois
   `system/seed-teste.sql` com os valores reais da conta de teste preenchidos.

4. Importe o `workflows/WF-01-instagram-publish.json` (versão simples, só Instagram
   com polling). Ajuste as credenciais/variáveis e execute manualmente. Quero ver UMA
   imagem publicada no Instagram de teste.

5. Quando o IG estiver publicando, passe para o `workflows/WF-01-multi-rede-escalavel.json`.
   Configure-o para ler da fila (tabela `posts`) e ligue só os branches Instagram e
   Facebook (LinkedIn fica desligado até o App Review). Teste com o post do seed
   (`targets={instagram,facebook}`).

6. Implemente as pendências de produção marcadas em `docs/05-MULTI-REDE-E-ESCALA.md`:
   descriptografia do token, gravação em `publications`, e tratamento de erro por
   branch (status='failed').

7. Importe e configure `WF-02-refresh-token.json` (refresh) e `WF-03-retry.json`
   (retry com backoff). O refresh precisa estar funcionando antes de ir para produção.

Regras que você deve seguir o tempo todo:
- Um workflow genérico parametrizado, nunca um por cliente. O que muda por cliente
  vem do banco (`targets`, conta, mídia).
- Rate limit do Instagram é por conta — sempre checar `content_publishing_limit`.
- Nunca testar publicação real direto na conta de um cliente; só na conta de teste.
- Tokens nunca em URL/query string nem commitados.
- LinkedIn é fase 1.5 (depende de App Review) — não tente ligar antes.

Comece pelo passo 1: me pergunte o que eu já tenho do setup da Meta e me oriente a
partir daí.

---

## Depois que IG+FB estiver redondo (próximas conversas)

- "Vamos detalhar o branch do LinkedIn com upload de imagem (registro de asset +
  publish), agora que o App Review foi aprovado."
- "Vamos começar o esqueleto do sistema web: cadastro de cliente + endpoint que
  insere posts na fila."
- "Vamos para a fase 2: workflow de IA que gera o calendário e os textos a partir do
  tom de voz do cliente."
