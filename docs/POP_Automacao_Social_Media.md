**Procedimento Operacional Padrão**

Automação de produção e publicação de conteúdo em redes sociais

| Objetivo | Padronizar o fluxo de criação de cronograma, produção de textos, aprovação e publicação de conteúdo para clientes da agência, do disparo inicial até a publicação nas redes. |
| :---- | :---- |
| **Aplicação** | Equipe de social media e operação. Vale para todos os clientes com contrato de gestão de conteúdo. |
| **Ferramentas** | Orquestração via n8n; painel de aprovação próprio; APIs oficiais de Instagram, Facebook e LinkedIn; IA para geração de conteúdo. |

# **1\. Papéis e responsabilidades**

O processo envolve quatro atores. Entender quem faz o quê evita gargalos e deixa claro o que é automático e o que depende de uma pessoa.

| Ator | O que faz | Sempre acontece? |
| :---- | :---- | :---- |
| Automação (n8n) | Gera cronograma e textos com IA, dispara e-mails, faz o controle de prazos e publica nas redes. | Sim — é o motor de todo o fluxo. |
| Pamela (social media) | Revisa internamente o que a IA gerou; ajusta ou aprova. Aprova em nome do cliente quando o plano não inclui aprovação. | Sim — revisão interna é obrigatória em todo ciclo. |
| Designer | Cria as artes de cada post com base nos textos aprovados pela Pamela e as sobe no sistema. Entra apenas na Rodada B (conteúdo). | Sim — toda postagem recebe arte. |
| Cliente | Aprova o cronograma e, depois, o pacote de texto e arte em conjunto. Pode editar antes de aprovar somente se o plano dele incluir essa permissão. | Depende do plano (ver regra de plano). |

# **2\. Visão geral do fluxo**

O processo tem duas rodadas. A Rodada A trata do cronograma (o quê e quando postar) e passa por quatro etapas: geração pela IA, revisão da Pamela, envio ao cliente e aprovação do cliente. A Rodada B trata do conteúdo de cada post (texto e arte) e é mais longa, pois inclui a criação das artes pelo designer e uma revisão adicional da Pamela antes de o pacote seguir ao cliente.

**Regra de plano (vale para as duas rodadas): o cliente com plano de aprovação pode editar antes de aprovar; o cliente sem esse plano apenas aprova, e quando não há aprovação dele a Pamela aprova em seu nome.**

# **3\. Fase de preparação (uma vez por cliente)**

Antes de qualquer ciclo mensal, o cliente precisa estar cadastrado com:

* Nome e e-mail de contato para receber os links de aprovação.

* Plano contratado, indicando se inclui ou não a permissão de edição/aprovação.

* Tom de voz descrito em texto — é o que orienta a IA na geração do cronograma e dos textos. Sem isso, não há personalização.

* Contas de Instagram, Facebook e LinkedIn conectadas, para permitir a publicação ao final.

# **4\. Rodada A — Cronograma**

## **Etapa 1 — Geração automática**

1. Em data definida do mês (ex.: dia 20, para o mês seguinte), a automação inicia sozinha.

2. A IA monta um cronograma de 12 postagens conforme o tom de voz do cliente, sugerindo tema, dia e horário de cada uma.

3. O cronograma é salvo com status “rascunho”. Ninguém é avisado ainda; é trabalho interno.

## **Etapa 2 — Revisão da Pamela**

1. A Pamela é avisada de que há um cronograma novo para revisar e o abre no painel interno.

2. Ela pode aprovar como está ou ajustar (temas, datas, ordem). Cada item alterado é registrado pelo sistema, com identificação de quem alterou.

3. Ao concluir, ela marca como aprovado, liberando o cronograma para o cliente.

## **Etapa 3 — Envio ao cliente**

Assim que a Pamela aprova, a automação envia um e-mail ao cliente com um link. O link abre o cronograma dentro do próprio sistema (não é um anexo) — uma tela onde ele pode interagir. O status passa a “enviado ao cliente”.

## **Etapa 4 — Aprovação do cliente**

O comportamento depende do plano:

* Plano com aprovação: o cliente pode ajustar o cronograma e depois aprovar.

* Plano sem aprovação: o cliente apenas aprova, sem editar.

Se o cliente ajustar algo, o ajuste volta para a Pamela revisar (ver seção 6 — Laço de revisão). Se aprovar sem alterar, a Rodada A é encerrada.

# **5\. Rodada B — Texto e arte**

Trata do conteúdo de cada post. Começa automaticamente assim que o cronograma é aprovado pelo cliente. Diferente da Rodada A, inclui a criação das artes pelo designer e uma segunda revisão interna da Pamela, de modo que o cliente recebe texto e arte juntos em um único pacote.

## **Etapa 5 — Geração dos textos**

A automação percorre os 12 itens do cronograma aprovado e, para cada um, pede à IA que escreva o texto do post seguindo o tom de voz do cliente e o tema definido para aquele dia. Status: “textos em geração”, depois “aguardando Pamela”.

## **Etapa 6 — Revisão dos textos pela Pamela**

A Pamela abre os 12 textos no painel, ajusta o que for necessário ou aprova. Cada texto editado é marcado como alterado. Ao concluir, os textos aprovados ficam disponíveis para o designer iniciar as artes.

## **Etapa 7 — Criação das artes pelo designer**

4. Com os textos aprovados pela Pamela, o designer é acionado e visualiza, no sistema, os textos de cada um dos 12 posts.

5. Ele cria a arte correspondente a cada post e sobe os arquivos no sistema, vinculados ao respectivo texto.

6. Ao concluir, o conjunto texto \+ arte fica disponível para a revisão da Pamela.

## **Etapa 8 — Revisão das artes pela Pamela**

A Pamela revisa as artes no painel, conferindo se cada uma combina com o texto aprovado. Ela pode aprovar ou devolver ao designer para ajuste. Só quando texto e arte estão validados em conjunto o pacote é liberado para o cliente.

## **Etapa 9 — Envio ao cliente**

A automação envia um e-mail ao cliente com um link. O link abre, no próprio sistema, o pacote completo de cada post — texto e arte lado a lado. O status passa a “enviado ao cliente”.

## **Etapa 10 — Aprovação do cliente**

Mesma regra de plano da Rodada A, agora aplicada ao pacote de texto e arte:

* Plano com aprovação: o cliente pode solicitar ajustes (no texto e/ou na arte) e depois aprovar.

* Plano sem aprovação: o cliente apenas aprova o pacote, sem editar.

Se o cliente pedir ajuste, o item volta pelo laço de revisão (seção 6). Quando o pacote é aprovado, o ciclo está pronto para a publicação.

# **6\. Laço de revisão (quando o cliente ajusta)**

Vale para a Etapa 4 (cronograma) e a Etapa 10 (pacote de texto e arte). Quando o cliente faz um ajuste, ele não segue direto para a frente — passa primeiro pela revisão interna:

7. Se o ajuste for no texto ou no cronograma, ele volta para a Pamela revisar. Se o ajuste for na arte, ela é devolvida ao designer para refação e, depois, passa novamente pela Pamela.

8. Depois da revisão interna, o caminho depende do plano: cliente com aprovação recebe de volta para dar o aval final; cliente sem aprovação tem o item aprovado pela própria Pamela.

9. Se o cliente com aprovação ajustar novamente, o item repete o laço (Pamela e/ou designer) até que alguém aprove sem alterar.

*Recomendação prática: estabelecer um limite de 2 a 3 rodadas de ida e volta. A partir daí, a Pamela entra em contato direto com o cliente para alinhar fora do sistema e evitar o ping-pong infinito.*

# **7\. Regras de prazo e lembretes**

| Situação | Ação automática |
| :---- | :---- |
| **Pamela não revisou** | A automação envia um lembrete após 1 dia parado, em qualquer das revisões da Pamela (texto, arte ou cronograma). |
| **Designer não entregou** | Mesma regra: lembrete ao designer após 1 dia sem entrega das artes. |
| **Cliente não respondeu** | Se faltarem 3 dias para a data de publicação e o cliente não tiver respondido, a aprovação e a publicação ocorrem automaticamente. |

*Observação sobre o gatilho dos 3 dias: a contagem é feita para trás a partir da data de publicação de cada post — não a partir da data de envio do e-mail. Ou seja, o sistema garante que nenhum post deixe de sair por falta de resposta do cliente.*

# **8\. Fase de publicação**

4. Com os textos aprovados, a automação agenda — não publica tudo de uma vez.

5. Cada um dos 12 posts é programado para o dia e horário definidos no cronograma.

6. No momento de cada post, a automação publica simultaneamente no Instagram, Facebook e LinkedIn, usando as contas conectadas na preparação.

7. Cada publicação registra se teve sucesso ou falha; falhas podem ser reagendadas em caso de erro de API.

# **9\. Referência rápida — status do ciclo**

O status indica em que ponto cada cliente está no mês, e é o que a automação consulta para saber o que disparar em seguida.

| Status do ciclo | Significado |
| :---- | :---- |
| **Rascunho** | IA gerou o cronograma; aguardando revisão da Pamela. |
| **Aprovado pela Pamela** | Revisão interna concluída; liberado para envio ao cliente. |
| **Enviado ao cliente** | E-mail disparado; aguardando ação do cliente no sistema. |
| **Em revisão (cliente)** | Cliente está ajustando (apenas planos com edição). |
| **Aprovado pelo cliente** | Cronograma fechado; libera a geração dos textos. |
| **Textos em geração** | IA está escrevendo os 12 textos. |
| **Textos aprovados (Pamela)** | Textos revisados internamente; liberados para o designer. |
| **Artes em produção** | Designer está criando as artes e subindo no sistema. |
| **Artes em revisão (Pamela)** | Pamela valida texto e arte em conjunto. |
| **Pacote enviado ao cliente** | Texto e arte enviados juntos; aguardando aprovação. |
| **Pacote aprovado** | Conteúdo final aprovado; libera o agendamento. |
| **Publicando** | Posts agendados saindo nas redes no dia/horário definidos. |
| **Concluído** | Todos os 12 posts publicados. |

