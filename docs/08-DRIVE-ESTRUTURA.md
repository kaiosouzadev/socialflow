# Estrutura das artes no Google Drive

> Onde a equipe guarda as artes de cada post e como o sistema as encontra.
> O sync (botão **Sincronizar mídia** e o n8n WF-05) lê essa estrutura e anexa
> a arte ao post. O código está em `web/src/lib/drive-layout.ts` (regras puras,
> com testes), `google-drive.ts` (API do Drive) e `drive-sync.ts` (sync).

## A estrutura

```
Pasta raiz dos clientes                (DRIVE_ROOT_FOLDER_ID)
└─ Cliente                             ex.: "Clínica Ação"
   └─ 2026                             pasta do ano
      └─ 10 - Outubro                  pasta do mês
         ├─ 1.jpg                      post 1 (feed)
         ├─ 1story.jpg                 story que sai junto do post 1
         ├─ 2/                         post 2 é carrossel: uma pasta com o número
         │  ├─ 1.jpg                   slide 1
         │  ├─ 2.jpg                   slide 2
         │  └─ 3.jpg                   slide 3 … até k
         ├─ 2story.jpg                 story do post 2 (também pode ficar dentro de 2/)
         ├─ 2story2.jpg                2º story com o N 2 (ex.: um story avulso depois do post 2)
         ├─ 3.mp4                      post 3 (reels)
         └─ …                          quantos posts o mês tiver (12 é só o comum)
```

Ou seja: **Raiz / Cliente / AAAA / MM - Mês / {N.jpg, Nstory.jpg, Nstory2.jpg…, N/ com os slides 1..k}**.

## Nomes aceitos

Nenhum nome diferencia maiúsculas nem acentos.

**Pasta do cliente**, procurada nesta ordem:
1. A pasta escolhida no cadastro do cliente (campo "Pasta no Drive").
2. Uma pasta na raiz com o nome do cliente. "Clínica Ação", "CLINICA ACAO" e "clinica  ação" valem.
3. Se não existir nenhuma, o sistema cria a pasta com o nome do cliente (veja "Quando o sistema cria pastas"). O ID encontrado ou criado fica salvo no cadastro.

**Pasta do ano:** exatamente o ano, por exemplo `2026`.

**Pasta do mês:** qualquer uma destas formas.

| Forma | Exemplos |
|---|---|
| Nome do mês | `outubro`, `Outubro`, `OUTUBRO`, `Marco` (sem cedilha), `Março` |
| Número e nome | `10 - Outubro`, `10-outubro`, `10_Outubro`, `10.outubro`, `10 outubro` |
| Só o número | `10`, `010` |

- Em "número e nome" **vale o nome**: `04 - SETEMBRO` é setembro. As pastas antigas da equipe numeram em sequência, não pelo número do mês.
- Não são pasta de mês: `out`, `31`, `Outubro 2025`.
- O sistema cria a pasta do mês sempre como `10 - Outubro`. O número na frente faz o Drive ordenar os meses em ordem cronológica.

**Arquivo do post N** (qualquer extensão de imagem ou vídeo: jpg, png, webp, mp4, mov…):

| Post | Nome | Também aceito |
|---|---|---|
| Feed | `3.jpg` | `03.jpg`, `3 - Título do post.jpg`, `3_final.jpg`, `3.v2.jpg` |
| Reels | `3.mp4` | as mesmas variações |
| Story (o 1º com esse N) | `3story.jpg` | `3 story.jpg`, `3-story.jpg`, `03_STORY.jpg`, `3 - story.jpg`, `3story1.jpg` |
| 2º story com o mesmo N | `3story2.jpg` | `3 story 2.jpg`, `3-story-2.jpg`, `03_STORY_2.png`, `3story2.mp4` |
| 3º, 4º… story com o mesmo N | `3story3.jpg`, `3story4.jpg`… | as mesmas variações |
| Carrossel | pasta `3/` com os slides | pasta `03` ou `3 - Título`; ou arquivos soltos `3-1.jpg`, `3-2.jpg`… (2 ou mais) na pasta do mês |

- `31.jpg` nunca é o post 3: depois do número tem que vir um separador.
- Um arquivo de story nunca é usado como feed, e vice-versa.
- Um story também não serve a outra ordem: `3story2` nunca é o feed 3 nem o 1º story, e `3story` nunca é o 2º story.
- O número logo depois de "story" é sempre a ordem do story: `3 story 2 - Promoção.jpg` é o 2º story do post 3. Depois de "story" não pode vir letra: `3storyboard.jpg` não é story.
- **Story:** o sync procura primeiro na pasta do mês e depois dentro da pasta `N/`. Dentro de `N/` vale também só `story.jpg` (o 1º) e `story2.jpg`, `story3.jpg`… (o 2º, o 3º…), já que a pasta indica o N.
- **Slides do carrossel** são ordenados pelo número do nome (1, 2, …, 10). Arquivos de story dentro de `N/` (`story.jpg`, `story2.jpg`, `3story.jpg`…) **não** entram como slide.
- Atalhos do Drive são ignorados: use o arquivo de verdade.

## Numeração: qual é o N de cada post

1. Contam os posts do cliente no mês (fuso de São Paulo), em ordem de data e hora.
2. **Só os posts que não são story contam**: feed, carrossel e reels recebem 1, 2, 3…
3. **Contam todos os status**: rascunho, agendado, publicado e com falha. Um post que já foi publicado continua ocupando o número dele.
4. **O story herda o N** do post anterior mais próximo. O story que sai junto do post (15 minutos depois) e um story avulso que vem depois desse post herdam o mesmo N. Um story antes de qualquer post do mês recebe 1.
5. **Vários stories com o mesmo N** seguem a ordem de data e hora: o 1º usa `Nstory`, o 2º `Nstory2`, o 3º `Nstory3`, e assim por diante. `Nstory1` também é aceito para o 1º, mas o sistema sempre mostra `Nstory.jpg`.
6. Se dois posts têm o mesmo horário, vem primeiro o que foi criado antes (e, no empate, o de menor id). Vale também para a ordem dos stories.

Exemplo de outubro:

| Data | Formato | Status | N | Arquivo |
|---|---|---|---|---|
| 01/10 09:00 | feed | publicado | 1 | `1.jpg` |
| 03/10 09:00 | carrossel | rascunho | 2 | `2/` (slides) |
| 03/10 09:15 | story | rascunho | 2 | `2story.jpg` |
| 05/10 18:00 | story | rascunho | 2 | `2story2.jpg` (story avulso: o 2º com o N 2) |
| 06/10 20:00 | reels | agendado | 3 | `3.mp4` |
| 08/10 09:00 | feed | rascunho | 4 | `4.jpg` |

Mais casos de story:

| Sequência no mês | Arquivos |
|---|---|
| reels nº 4, o story junto dele e um story avulso no dia seguinte | `4.mp4`, `4story.jpg`, `4story2.jpg` |
| post 2 e, depois dele, 3 stories | `2.jpg`, `2story.jpg`, `2story2.jpg`, `2story3.jpg` |
| um story antes do 1º post, o post 1 e o story junto do post 1 | `1story.jpg`, `1.jpg`, `1story2.jpg` |

A revisão do cronograma com IA mostra o caminho de cada arte com esta mesma regra, por exemplo "Arte do story no Drive: 2026/11 - Novembro/4story.jpg" no reels e "No Drive: 2026/11 - Novembro/4story2.jpg" no story avulso.

**Cuidado:** o N depende das datas de **todos** os posts do mês. Mudar uma data, excluir um post ou o adiamento semanal de 7 dias pode mudar o N dos posts seguintes que ainda estão sem arte. O mesmo vale para a ordem dos stories: trocar a data de um story pode trocar `Nstory` e `Nstory2`. Um post que já recebeu a arte não é reavaliado. Por isso, coloque as artes no Drive depois que o cronograma do mês estiver fechado.

## Estrutura antiga (Cliente/mês, sem o ano)

Os clientes que já usam `Cliente/outubro/1.jpg` continuam funcionando:

- se a pasta do cliente **não tem** a pasta do ano, ou **tem o ano sem aquele mês**, o sync usa `Cliente/<mês>`;
- nas mensagens, esse caminho aparece marcado com **"(estrutura antiga)"**, por exemplo `Clínica Ação/outubro/3.jpg (estrutura antiga)`;
- se existem as duas (`Cliente/2026/10 - Outubro` e `Cliente/outubro`), **vale a do ano**, e a antiga é ignorada naquele mês;
- a pasta antiga não tem ano: um `outubro` de 2025 seria usado também para outubro de 2026 se não houver a pasta `2026/10 - Outubro`. Para migrar um cliente, mova os meses para dentro da pasta do ano. Uma pasta `2025/10 - Outubro` nunca é usada para 2026.

## Quando o sistema cria pastas

O sistema só cria o que **falta**, e nunca cria quando já existe uma pasta aceita para aquele mês, nem na estrutura antiga. Assim um cliente antigo não ganha uma pasta vazia que esconderia a dele.

| Quando | O que faz |
|---|---|
| Ao salvar um cronograma (revisão do cronograma com IA) | Garante a pasta do cliente e `AAAA/MM - Mês` de cada mês que os posts tocam. É best-effort: se o Drive falhar ou demorar mais de 15 s, o cronograma é salvo do mesmo jeito e a resposta traz um aviso. |
| Ao gerar as artes do plano básico | Garante as mesmas pastas e arquiva cada arte como `N.png`/`N.jpg` |
| Sincronizar mídia | **Não cria nada**: só lê |

**Plano básico:** a arte gerada é arquivada como `N.ext`, com N pela regra acima (só arte de feed; a ordem dos stories não muda nada aqui). Antes o nome era "DD - Título", que o sync lia como se fosse o post DD. Se já existir um arquivo com o mesmo nome na pasta do mês, ele é **substituído**, como já acontecia ao gerar a arte de novo. Isso só afeta clientes do plano básico, cujas artes o próprio sistema gera.

## Ambiguidade

Às vezes mais de uma pasta ou arquivo serve, por exemplo `Outubro` e `10` dentro de `2026`, `3.jpg` e `03 - Capa.jpg`, ou `3story2.jpg` e `3 story 2.png`. Nesse caso o sync escolhe sempre do mesmo jeito:
- **pasta:** o nome do mês vence "número e nome", que vence só o número; no empate, a ordem alfabética;
- **arquivo:** o nome exato (`3`, `3story`, `3story2`; para o 1º story, `3story` vence `3story1`) vence; depois, o nome mais curto.

O sync informa a escolha em `ambiguous`. Deixe só uma pasta ou arquivo para evitar surpresa.

## Carrossel e reels exigem o armazenamento de mídia (R2)

- **Carrossel:** sem R2 o sync não consulta a pasta `N/` e informa "precisa do armazenamento de mídia configurado no servidor". A Graph API precisa de uma URL pública por slide.
- **Reels:** sem R2 a arte é anexada, mas a publicação falha. O link de fallback (`/api/media/<id>`) não tem extensão, e o publicador decide se é vídeo pela extensão.
- **Feed e story** funcionam sem R2 pelo link assinado `/api/media/<id>`.

## Quem roda o sync

| Gatilho | Janela |
|---|---|
| Botão **Sincronizar mídia** na página do cliente | posts dos próximos 60 dias (e dos últimos 2) |
| n8n WF-05, a cada 30 minutos, para todos os clientes | próximos 30 dias (e últimos 2) |

Só entram posts em rascunho ou agendados que ainda não têm arte.

## Para desenvolvedores: o que a API devolve

**`syncMedia` (`POST /api/drive/sync` e `/api/internal/sync-media`)**

```ts
{
  attached: number;            // artes anexadas agora
  checked: number;             // posts elegíveis verificados
  skipped: { client: string; reason: string }[];
  missing: { client: string; post: string; expected: string }[];
  //   expected = caminho completo: "Cliente/2026/10 - Outubro/3.jpg",
  //   ".../3story.jpg", ".../3story2.jpg" (2º story com o N 3)
  //   ou "Cliente/outubro/3.jpg (estrutura antiga)"
  layout: {                    // uma entrada por cliente + mês processado
    client: string;
    month: string;             // "2026-10"
    layout: "ano/mes" | "legado" | null;   // null = pasta do mês não encontrada
    path: string;              // pasta usada ou, se null, a esperada
  }[];
  ambiguous: {
    client: string;
    post?: string;             // ausente quando a dúvida é na pasta do ano/mês
    path: string;              // onde estão as candidatas
    chosen: string;            // o que o sync usou
    candidates: string[];      // todas, inclusive a escolhida
  }[];
}
```

**`POST /api/ai/calendar/commit`** ganha `drive` e, só quando há falha, `driveWarning`:

```ts
{ scheduleId, created, duplicates, month,
  drive: { status: "indisponivel" }                       // Drive não configurado
       | { status: "ok" | "falhou",
           folders: { month: "2026-11", layout: "ano/mes" | "legado",
                      path: "Cliente/2026/11 - Novembro", created: ["2026", "11 - Novembro"] }[] },
  driveWarning?: "Cronograma salvo, mas as pastas do mês não foram preparadas no Google Drive. <motivo>" }
```

O commit continua respondendo 201 mesmo se o Drive falhar.

## Validação

- **Testes unitários** com uma árvore falsa do Drive: `web/tests/unit/drive-layout.test.ts` (regras), `web/tests/unit/drive-story-ordinal.test.ts` (vários stories do mesmo N: `Nstory`, `Nstory2`…) e `web/tests/unit/drive-sync-structure.test.ts` (sync, criação de pastas e commit). Rodar com `npm run test:unit`.

## Para desenvolvedores: nomes das artes (`drive-layout.ts`)

- `buildMonthIndex(posts)` → `Map<id, N>`: o N de cada post (o plano básico usa este; assinatura e regra sem mudança).
- `buildMonthFileNames(posts)` → `Map<id, { index, storyOrdinal, fileStem }>`: o N, a ordem do story (`null` para feed, carrossel e reels; 1, 2, 3… para stories) e o nome sem extensão (`"4"`, `"4story"`, `"4story2"`). Mesma entrada do `buildMonthIndex`: todos os posts do cliente no mês, em ordem de data (empate: criação, depois id). Usado pelo sync e pela revisão do cronograma.
- `parseArtStem(nome sem extensão)` → `{ kind: "post", index }` | `{ kind: "story", index | null, ordinal }` | `null`: como um nome de arquivo é lido.
- `storyFileStem(N, ordem)` → `"4story"`, `"4story2"`…
- **Drive real:** smoke manual em produção no cliente-cobaia da agência (S41), nunca direto num cliente.
