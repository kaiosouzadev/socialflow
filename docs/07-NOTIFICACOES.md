# Fluxo de aprovação em 2 fases + notificações

## Fases

**Fase 1 — Cronograma (mensal, títulos):**
1. Equipe gera o cronograma com IA (título + breve explicação por post) e envia
   ao cliente entre os dias **10 e 20 do mês anterior** (o envio fora da janela
   mostra aviso, não bloqueia).
2. Cliente abre `/aprovar/<token>`: vê só título + explicação. Em cada post pode
   **pedir ajuste** (comentário, mínimo 30 caracteres). Qualquer ajuste pendente
   **bloqueia** o botão de aprovar.
3. Prazo do cliente: **dia 25**. Redatora resolve ajustes em `/aprovacoes`
   (painel "Ajustes solicitados"):
   - prazo ainda aberto → cliente é avisado por e-mail para revisar e aprovar;
   - prazo vencido → ao resolver o último ajuste o cronograma **aprova
     automaticamente** (cliente e equipe avisados).

**Fase 2 — Posts completos (semanal):**
1. Cronograma aprovado → legenda única FB+IG e slides (carrossel/reels) são
   gerados em lote pela IA no preparo do envio semanal.
2. Toda **quarta e quinta** o processo semanal roda: posts da próxima semana
   (dom–sáb) com **arte pronta** entram no link `/aprovar-semana/<token>`;
   post **sem arte é adiado +7 dias** e a equipe é alertada.
3. Cliente aprova (post entra na fila) ou pede ajuste (mín. 30 chars; post sai
   da fila até a redatora resolver). Prazos de resposta por dia do post:
   dom→qui · seg→sex · ter→sex · qua→seg · qui→ter · sex→qua · sáb→qui.
4. Sem resposta no prazo → lembrete ao cliente + alerta à redatora, todo dia,
   até responder (dedupe por dia).

## Crons a agendar no n8n (chamadas HTTP com header `x-internal-key: $INTERNAL_API_KEY`)

| Quando (SP)              | Chamada                                             | O que faz |
|--------------------------|-----------------------------------------------------|-----------|
| Todo dia, 09:00          | `POST $SYSTEM_BASE_URL/api/internal/alerts/run`     | Lembretes de prazo do cronograma (dias 21–25 + vencidos) e de posts semanais sem resposta |
| Quarta e quinta, 10:00   | `POST $SYSTEM_BASE_URL/api/internal/weekly/run`     | Gera conteúdo pendente, adia posts sem arte (+7d) e envia os links semanais |

Ambas também aceitam sessão logada — em `/aprovacoes` há o botão
**“Enviar links da semana”** para disparo manual.

## Destinatários

- **Cliente**: todos os e-mails do cliente — o principal e os adicionais do
  cadastro (até 10). Vale para o link mensal, o link semanal e os avisos ao
  cliente. Sai **1 e-mail por destinatário** (ninguém vê o endereço do outro),
  um de cada vez, para respeitar o limite de envio do Resend. No envio do
  cronograma, a tela mostra para quem foi e quais endereços falharam.
- **Equipe/redatora**: todos os usuários do sistema, ou a lista da env
  `TEAM_NOTIFY_EMAIL` (e-mails separados por vírgula) quando definida.
- Toda notificação também vira uma linha no card **“Notificações do fluxo de
  aprovação”** do dashboard (mesmo quando o e-mail falha).
