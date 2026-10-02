import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { firstNameKey, parseMonthlyDoc, stripCredentials } from "../../src/lib/doc-import.ts";

const FIXTURE = readFileSync(new URL("../fixtures/doc-mensal-sintetico.txt", import.meta.url), "utf8");
const FIXTURE_LINES = FIXTURE.split(/\r\n|\r|\n/);
const PASSWORD = "SENHA-FALSA-123";

const doc = parseMonthlyDoc(FIXTURE, { refMonth: "2026-09" });

describe("parseMonthlyDoc — fixture sintética (S06)", () => {
  test("12 posts + 1 avulso + 1 stand-by", () => {
    assert.equal(doc.posts.length, 12);
    assert.equal(doc.avulsos.length, 1);
    assert.equal(doc.standBy.length, 1);
    assert.deepEqual(
      doc.posts.map((p) => p.seq),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    );
  });

  test("4 TÍTULO (feed), 4 CARROSSEL e 4 REELS", () => {
    const count = (f: string) => doc.posts.filter((p) => p.format === f).length;
    assert.equal(count("feed"), 4);
    assert.equal(count("carrossel"), 4);
    assert.equal(count("reels"), 4);
    assert.deepEqual(
      doc.posts.filter((p) => p.format === "feed").map((p) => p.kindLabel),
      ["TÍTULO", "TÍTULO", "TÍTULO", "TÍTULO"]
    );
  });

  test("0 posts vindos dos moldes (6 blocos de molde ignorados, inclusive um com data válida)", () => {
    assert.equal(doc.ignoredTemplates, 6);
    const all = [...doc.posts, ...doc.avulsos, ...doc.standBy];
    assert.ok(all.every((p) => !/TÍTULO D|MOLDE/.test(p.title)), JSON.stringify(all.map((p) => p.title)));
    assert.ok(all.every((p) => p.date !== "2026-10-10"));
  });

  test("número de slides por post", () => {
    assert.deepEqual(
      doc.posts.map((p) => p.slides.length),
      [0, 5, 3, 0, 4, 4, 0, 3, 5, 0, 10, 2]
    );
    assert.equal(doc.avulsos[0].slides.length, 3);
    assert.equal(doc.standBy[0].slides.length, 2);
    // "ARTE 6:" vazio não vira slide; continuação de linha entra no slide anterior
    assert.equal(doc.posts[1].slides[4].text, "Salve e compartilhe!");
    assert.equal(doc.posts[7].slides[1].text, "Demaquilante\ne água micelar");
    assert.equal(doc.posts[2].slides[0].text, "Um dia na clínica | Vídeo 01");
  });

  test("horário padrão × override \"*Postar 20h\"", () => {
    const [p1, p2, p3, , p5, p6] = doc.posts;
    assert.deepEqual([p1.time, p1.timeSource], ["09:00", "padrao"]); // TÍTULO
    assert.deepEqual([p2.time, p2.timeSource], ["09:00", "padrao"]); // CARROSSEL
    assert.deepEqual([p3.time, p3.timeSource], ["20:00", "documento"]); // REELS com *Postar 20h
    assert.deepEqual([p5.time, p5.timeSource], ["20:00", "documento"]); // CARROSSEL com override
    assert.deepEqual([p6.time, p6.timeSource], ["20:00", "padrao"]); // REELS sem *Postar
    assert.deepEqual([doc.standBy[0].time, doc.standBy[0].timeSource], ["12:00", "documento"]);
  });

  test("horários padrão configuráveis não sobrescrevem o do documento", () => {
    const d = parseMonthlyDoc(FIXTURE, { refMonth: "2026-09", defaultTimes: { reels: "19:00", feed: "10:30" } });
    assert.equal(d.posts[5].time, "19:00"); // REELS sem *Postar
    assert.equal(d.posts[2].time, "20:00"); // REELS com *Postar 20h
    assert.equal(d.posts[0].time, "10:30");
    assert.equal(d.posts[1].time, "09:00"); // carrossel mantém o padrão
  });

  test("redatora por post", () => {
    assert.deepEqual(
      doc.posts.map((p) => p.writerName),
      ["PAMELA", ...Array(10).fill("STELLA"), "PAMELA"]
    );
    assert.equal(doc.avulsos[0].writerName, "STELLA");
    assert.equal(firstNameKey("Pâmela Souza"), "pamela");
  });

  test("status por post", () => {
    assert.deepEqual(
      doc.posts.map((p) => p.docStatus),
      [
        "aprovado",
        "aprovado",
        "aprovado",
        "aprovado",
        "aprovado",
        "aguardando_aprovacao",
        "aprovado",
        "aprovado",
        "aguardando_fotos",
        "aprovado",
        "aprovado",
        "aprovado",
      ]
    );
    assert.equal(doc.avulsos[0].docStatus, "aguardando_fotos");
    assert.equal(doc.standBy[0].docStatus, "aguardando_fotos");
  });

  test("datas no mês civil (o ciclo do docx passa para outubro)", () => {
    assert.equal(doc.posts[0].date, "2026-09-07");
    assert.equal(doc.posts[10].date, "2026-09-30");
    assert.equal(doc.posts[11].date, "2026-10-02");
    assert.equal(doc.avulsos[0].date, "2026-10-05");
    assert.equal(doc.standBy[0].date, null);
  });

  test("título, legenda e nota interna", () => {
    const p1 = doc.posts[0];
    assert.equal(p1.title, "Dia do Exemplo");
    assert.equal(p1.line, FIXTURE_LINES.indexOf("01 - TÍTULO: Dia do Exemplo (07/09)") + 1);
    assert.ok(p1.caption.startsWith("Hoje é o Dia do Exemplo!"));
    assert.ok(p1.caption.includes("📱 (00) 0000-0000"));
    assert.ok(p1.caption.endsWith("#cuidadoscomapele"));
    assert.ok(!p1.caption.includes("LEGENDA"));
    assert.ok(!p1.caption.includes("STELLA"));
    assert.equal(p1.internalNote, null);
    assert.equal(doc.posts[5].internalNote, "NÃO FAZER CAPA");
    assert.match(doc.posts[8].internalNote ?? "", /^CAMINHO: .*25-09$/);
    assert.equal(doc.avulsos[0].avulso, true);
    assert.match(doc.avulsos[0].internalNote ?? "", /^Post avulso\nCAMINHO: /);
    assert.equal(doc.avulsos[0].format, "carrossel");
    assert.equal(doc.avulsos[0].title, "Novidade na clínica");
    assert.equal(doc.standBy[0].format, "reels");
    assert.equal(doc.standBy[0].title, "Resultado do tratamento");
    assert.match(doc.standBy[0].internalNote ?? "", /NÃO FAZER CAPA\nCAMINHO: .*02 - FEVEREIRO$/);
  });

  test("cabeçalho do plano, hashtags, encerramento e nenhum aviso", () => {
    assert.match(doc.header ?? "", /^GESTÃO COM ARTES ESTÁTICAS.*\| COM RESPOSTA DE COMENTÁRIOS DOS POSTS$/);
    assert.equal(doc.hashtagsBlock?.split(" ").length, 11);
    assert.equal(doc.endOfContract, true);
    assert.deepEqual(doc.warnings, []);
  });

  test("briefing mapeado por dicionário; e-mail só como sugestão", () => {
    assert.deepEqual(doc.briefing.client, {
      tradeName: "Cliente Exemplo",
      facebookUrl: "https://www.facebook.com/clienteexemplo",
      instagramUrl: "https://www.instagram.com/clienteexemplo",
      city: "Cidade Exemplo - EX",
      phone: "(00) 0000-0000",
    });
    assert.deepEqual(doc.briefing.briefing, {
      anniversary: "Março",
      partnerships: "Convênio Exemplo",
      positioning: "Clínica de estética com atendimento acolhedor.\nFoco em resultados naturais.",
      linkedinRepost: "Não",
      audience: "Mulheres de 25 a 55 anos",
      products: "Limpeza de pele, peeling, massagem facial",
      themes: "Cuidados com a pele, autoestima",
      competitors: "Concorrente A, Concorrente B",
      differential: "Atendimento personalizado",
      references: "@referencia1, @referencia2, @referencia3, @referencia4, @referencia5",
      observations: "Evitar fotos com o rosto de clientes.",
      restrictions: "Não postar Halloween nem Carnaval",
    });
    assert.equal(doc.briefing.emailSuggestion, "contato@example.com");
    assert.deepEqual(doc.briefing.unmapped, []);
  });

  test("credencial: nada da senha no resultado e credentialDetected === true", () => {
    assert.ok(FIXTURE.includes(PASSWORD)); // a fixture tem a senha falsa
    const json = JSON.stringify(doc);
    assert.ok(!json.includes(PASSWORD));
    assert.ok(!json.includes("@clienteexemplo"));
    assert.equal(doc.credentialDetected, true);
  });
});

describe("stripCredentials", () => {
  test("remove a credencial do briefing e preserva a numeração das linhas", () => {
    const r = stripCredentials(FIXTURE);
    assert.equal(r.credentialDetected, true);
    assert.ok(!r.text.includes(PASSWORD));
    assert.ok(!r.text.includes("Acesso ao Instagram"));
    assert.equal(r.text.split("\n").length, FIXTURE_LINES.length);
    assert.ok(r.text.includes("Site da empresa:: não tenho"));
  });

  test("rótulos senha/password/acesso ao na mesma linha; legenda comum intacta", () => {
    const text = [
      "Nome da empresa (fantasia):: Loja Teste",
      "Acesso ao Instagram:: @lojateste / " + PASSWORD,
      "Senha do Facebook:: " + PASSWORD,
      "Password: " + PASSWORD,
      "Cidade - Estado:: Cidade - EX",
      "",
      "01 - TÍTULO: Teste (05/09)",
      "LEGENDA:",
      "Garanta o acesso ao nosso site pelo link da bio.",
    ].join("\n");
    const r = stripCredentials(text);
    assert.equal(r.credentialDetected, true);
    assert.ok(!r.text.includes(PASSWORD));
    assert.ok(r.text.includes("Cidade - Estado:: Cidade - EX"));
    assert.ok(r.text.includes("Garanta o acesso ao nosso site pelo link da bio."));
    const d = parseMonthlyDoc(text, { refMonth: "2026-09" });
    assert.ok(!JSON.stringify(d).includes(PASSWORD));
    assert.equal(d.briefing.client.city, "Cidade - EX");
  });

  test("texto sem credencial → credentialDetected false e texto igual", () => {
    const text = "Nome da empresa (fantasia):: X\n\n01 - TÍTULO: A (01/09)\nLEGENDA:\nOi";
    assert.deepEqual(stripCredentials(text), { text, credentialDetected: false });
  });
});

describe("parseMonthlyDoc — gramática", () => {
  test("refMonth=2026-12 com \"02/01\" → 2027-01-02 (virada de ano)", () => {
    const text = "PAMELA\n01 - TÍTULO: Natal (25/12)\nLEGENDA:\nFeliz Natal\n\n02 - TÍTULO: Ano novo (02/01)\nLEGENDA:\nFeliz ano novo";
    const d = parseMonthlyDoc(text, { refMonth: "2026-12" });
    assert.deepEqual(
      d.posts.map((p) => p.date),
      ["2026-12-25", "2027-01-02"]
    );
    // e o contrário: documento de janeiro com post de dezembro anterior
    const d2 = parseMonthlyDoc("01 - TÍTULO: Fim de ano (30/12)\nLEGENDA:\nx", { refMonth: "2027-01" });
    assert.equal(d2.posts[0].date, "2026-12-30");
  });

  test("bloco inválido gera warning com a linha e não vira post", () => {
    const text = [
      "STELLA", // 1
      "01 - TÍTULO: Válido (05/09)", // 2
      "LEGENDA:", // 3
      "Legenda válida", // 4
      "", // 5
      "02 - INSTAGRAM STORIES: Enquete (06/09)", // 6
      "APROVADO", // 7
      "LEGENDA:", // 8
      "Conteúdo do bloco inválido", // 9
      "", // 10
      "03 - REELS: Depois do inválido (08/09)", // 11
      "LEGENDA:", // 12
      "Outra legenda", // 13
    ].join("\n");
    const d = parseMonthlyDoc(text, { refMonth: "2026-09" });
    assert.deepEqual(d.warnings, [{ line: 6, message: 'Bloco não reconhecido: "02 - INSTAGRAM STORIES: Enquete (06/09)"' }]);
    assert.deepEqual(
      d.posts.map((p) => [p.seq, p.format, p.caption, p.line]),
      [
        [1, "feed", "Legenda válida", 2],
        [3, "reels", "Outra legenda", 11],
      ]
    );
  });

  test("data inválida e horário inválido geram aviso", () => {
    const text = "01 - TÍTULO: Data errada (31/09)\n*Postar 25h\nLEGENDA:\nx";
    const d = parseMonthlyDoc(text, { refMonth: "2026-09" });
    assert.equal(d.posts.length, 1);
    assert.equal(d.posts[0].date, null);
    assert.deepEqual(
      d.warnings.map((w) => w.line),
      [1, 2]
    );
  });

  test("BANNER ANIMADO → feed com nota; REELS - Gravação → reels", () => {
    const text = [
      "01 - BANNER ANIMADO: Promoção (10/09)",
      "LEGENDA:",
      "Promo",
      "02 - REELS - Gravação: Depoimento (12/09)",
      "*Postar 20h",
      "TELA 1: Abertura",
      "LEGENDA:",
      "Depoimento",
    ].join("\n");
    const d = parseMonthlyDoc(text, { refMonth: "2026-09" });
    assert.deepEqual(
      d.posts.map((p) => [p.format, p.kindLabel, p.internalNote, p.title]),
      [
        ["feed", "BANNER ANIMADO", "Banner animado", "Promoção"],
        ["reels", "REELS - Gravação", "Reels - Gravação", "Depoimento"],
      ]
    );
  });

  test("linhas de legenda parecidas com cabeçalho continuam na legenda", () => {
    const text = [
      "01 - CARROSSEL: Dicas (10/09)",
      "ARTE 1: Capa",
      "LEGENDA:",
      "1 - Agende já (link na bio)",
      "Stand by me é um clássico (1986)",
      "Reels novos toda semana",
      "",
      "📱 (00) 0000-0000",
    ].join("\n");
    const d = parseMonthlyDoc(text, { refMonth: "2026-09" });
    assert.equal(d.posts.length, 1);
    assert.equal(d.standBy.length, 0);
    assert.equal(
      d.posts[0].caption,
      "1 - Agende já (link na bio)\nStand by me é um clássico (1986)\nReels novos toda semana\n\n📱 (00) 0000-0000"
    );
    assert.deepEqual(d.warnings, []);
  });

  test("redatora por nome informado (fora de MAIÚSCULAS) e herdada pelos blocos seguintes", () => {
    const text = "Maria\n01 - TÍTULO: A (01/09)\nLEGENDA:\na\n02 - TÍTULO: B (02/09)\nLEGENDA:\nb";
    const d = parseMonthlyDoc(text, { refMonth: "2026-09", writerNames: ["Maria"] });
    assert.deepEqual(
      d.posts.map((p) => p.writerName),
      ["Maria", "Maria"]
    );
    const semNome = parseMonthlyDoc(text, { refMonth: "2026-09" });
    assert.equal(semNome.posts[0].writerName, null);
    assert.deepEqual(semNome.warnings, []);
  });

  test("refMonth inválido lança erro", () => {
    assert.throws(() => parseMonthlyDoc("", { refMonth: "2026-13" }), /refMonth/);
    assert.throws(() => parseMonthlyDoc("", { refMonth: "09/2026" }), /refMonth/);
  });

  test("texto vazio", () => {
    const d = parseMonthlyDoc("", { refMonth: "2026-09" });
    assert.deepEqual([d.posts, d.avulsos, d.standBy, d.warnings], [[], [], [], []]);
    assert.equal(d.header, null);
    assert.equal(d.credentialDetected, false);
  });
});
