/**
 * F8-HASHTAGS (pedido do usuário em 07/10): o texto do campo "Hashtags" do briefing entra
 * OBRIGATORIAMENTE no fim de toda legenda gerada pela IA; e (ampliação do mesmo dia) o resto
 * do briefing vai no prompt das legendas.
 *
 * Módulos puros: lib/client-hashtags.ts e lib/client-briefing-prompt.ts (sem "@/", sem rede).
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { clientHashtagBlock, hashtagPromptRule, withClientHashtags } from "../../src/lib/client-hashtags.ts";
import { BRIEFING_PROMPT_MAX, briefingForPrompt } from "../../src/lib/client-briefing-prompt.ts";

const BLOCK = "#PizzariaZZQA #ZonaSul\n#FornoALenha";
const count = (s: string, sub: string) => s.split(sub).length - 1;

describe("clientHashtagBlock — bloco do briefing", () => {
  test("sem briefing, briefing não-objeto ou sem a chave → null", () => {
    for (const b of [null, undefined, "texto", 42, [], {}, { products: "x" }]) {
      assert.equal(clientHashtagBlock(b), null, JSON.stringify(b));
    }
  });

  test("hashtags vazio, só espaços/quebras ou não-texto → null", () => {
    for (const h of ["", "   ", "\r\n \n\t", 123, null, ["#a"]]) {
      assert.equal(clientHashtagBlock({ hashtags: h }), null, JSON.stringify(h));
    }
  });

  test("apara só as pontas e troca CRLF por LF; o miolo fica como o usuário escreveu", () => {
    assert.equal(clientHashtagBlock({ hashtags: "  #PizzariaZZQA #ZonaSul\r\n#FornoALenha \r\n" }), BLOCK);
    assert.equal(clientHashtagBlock({ hashtags: "#a  #b\n\n#c" }), "#a  #b\n\n#c");
    assert.equal(clientHashtagBlock({ hashtags: "Siga @loja\r#a" }), "Siga @loja\n#a");
  });
});

describe("withClientHashtags — bloco no fim de toda legenda gerada", () => {
  test("sem bloco: devolve a legenda igual (mesmo com hashtags da IA)", () => {
    const cap = "Texto do post.\n\n#ia1 #ia2";
    assert.equal(withClientHashtags(cap, null), cap);
    assert.equal(withClientHashtags(cap, ""), cap);
  });

  test("legenda vazia ou só espaços: devolve igual (não cria legenda só de hashtags)", () => {
    assert.equal(withClientHashtags("", BLOCK), "");
    assert.equal(withClientHashtags("   \n", BLOCK), "   \n");
  });

  test("legenda sem hashtags: legenda + linha em branco + bloco", () => {
    assert.equal(withClientHashtags("Texto do post.  \n", BLOCK), `Texto do post.\n\n${BLOCK}`);
  });

  test("troca as linhas finais só de hashtags (da IA) pelo bloco do cliente", () => {
    const cap = "Texto do post.\n\nChame no direct!\n\n#ia1 #ia2 #ia3\n#ia4\n";
    const out = withClientHashtags(cap, BLOCK);
    assert.equal(out, `Texto do post.\n\nChame no direct!\n\n${BLOCK}`);
    assert.equal(count(out, "#ia"), 0);
  });

  test("parágrafos finais de hashtags separados por linhas em branco e separadores soltos também saem", () => {
    assert.equal(withClientHashtags("Texto.\n\n#ia1\n\n#ia2 · #ia3 | #ia4", BLOCK), `Texto.\n\n${BLOCK}`);
  });

  test("hashtags no meio do texto ficam (linha inteira ou dentro da frase)", () => {
    const cap = "Abertura com #Promo do dia.\n#SoHashtag #NoMeio\nFechamento.";
    assert.equal(withClientHashtags(cap, BLOCK), `${cap}\n\n${BLOCK}`);
  });

  test("hashtag na mesma linha de uma frase no fim não é removida (só linhas inteiras de hashtags)", () => {
    assert.equal(withClientHashtags("Venha provar! #ia", BLOCK), `Venha provar! #ia\n\n${BLOCK}`);
    assert.equal(withClientHashtags("Texto.\n#1 dica: use forno", BLOCK), `Texto.\n#1 dica: use forno\n\n${BLOCK}`);
  });

  test("idempotente: aplicar duas vezes = aplicar uma; bloco não duplica", () => {
    const once = withClientHashtags("Texto.\n\n#ia1 #ia2", BLOCK);
    assert.equal(withClientHashtags(once, BLOCK), once);
    assert.equal(count(withClientHashtags(once, BLOCK), "#PizzariaZZQA"), 1);
  });

  test("já termina com o bloco (espaços/quebras diferentes): devolve igual", () => {
    const cap = "Texto.\n\n#PizzariaZZQA   #ZonaSul\r\n#FornoALenha  ";
    assert.equal(withClientHashtags(cap, BLOCK), cap);
    assert.equal(withClientHashtags(cap, "  #PizzariaZZQA #ZonaSul\r\n#FornoALenha\n"), cap);
  });

  test("legenda só de hashtags da IA → só o bloco", () => {
    assert.equal(withClientHashtags("#ia1 #ia2\n#ia3", BLOCK), BLOCK);
  });

  test("CRLF da legenda vira LF ao anexar", () => {
    assert.equal(withClientHashtags("Linha 1\r\nLinha 2\r\n\r\n#ia", BLOCK), `Linha 1\nLinha 2\n\n${BLOCK}`);
  });

  test("bloco com texto além de hashtags é anexado como está", () => {
    const block = "Siga @pizzariazzqa\n#PizzariaZZQA";
    assert.equal(withClientHashtags("Texto.\n\n#ia", block), `Texto.\n\n${block}`);
  });

  test("hashtagPromptRule: só existe quando há bloco", () => {
    assert.equal(hashtagPromptRule(null), null);
    assert.match(hashtagPromptRule(BLOCK) ?? "", /NÃO inclua hashtags.*adicionadas automaticamente no fim/);
  });
});

describe("briefingForPrompt — briefing inteiro (menos hashtags) para o prompt", () => {
  test("nada preenchido → null (inclusive só hashtags, vazios e não-texto)", () => {
    for (const b of [null, undefined, "x", [], {}, { hashtags: "#a" }, { products: "  ", plan: 3, themes: null }]) {
      assert.equal(briefingForPrompt(b), null, JSON.stringify(b));
    }
  });

  test("todos os campos preenchidos entram com os rótulos do editor; hashtags, vazios e não-texto ficam de fora", () => {
    const out = briefingForPrompt({
      products: "Pizzas artesanais",
      audience: "Famílias da zona sul",
      positioning: "Pizzaria de bairro premium",
      differential: "Forno a lenha",
      competitors: "Pizzaria X",
      partnerships: "Clube de vantagens",
      anniversary: "12/03",
      themes: "Bastidores do forno",
      references: "@referencia",
      designNotes: "Tons quentes",
      linkedinUrl: "https://linkedin.com/company/zzqa",
      linkedinRepost: "não",
      responsibleTech: "Chef Fulano",
      plan: "3 posts/semana",
      observations: "Atende até 23h",
      restrictions: "Nada de bebida alcoólica",
      mandatoryArtText: "Peça pelo app",
      hashtags: "#PizzariaZZQA",
      extra: "chave desconhecida",
      vazio: "",
    });
    assert.ok(out);
    for (const line of [
      "- Produtos / serviços: Pizzas artesanais",
      "- Público-alvo: Famílias da zona sul",
      "- Posicionamento da marca: Pizzaria de bairro premium",
      "- Principal diferencial: Forno a lenha",
      "- Principais concorrentes: Pizzaria X",
      "- Parcerias / convênios: Clube de vantagens",
      "- Aniversário da empresa: 12/03",
      "- Principais temas a abordar: Bastidores do forno",
      "- Páginas de referência: @referencia",
      "- Notas de design: Tons quentes",
      "- Company Page do LinkedIn: https://linkedin.com/company/zzqa",
      "- Repostar no LinkedIn: não",
      "- Responsável técnico / registro: Chef Fulano",
      "- Plano (nível / frequência): 3 posts/semana",
      "- Observações: Atende até 23h",
      "- Restrições (datas, religião, etc.): Nada de bebida alcoólica",
      "- Texto obrigatório nas artes: Peça pelo app",
    ]) {
      assert.ok(out.split("\n").includes(line), `faltou: ${line}`);
    }
    assert.doesNotMatch(out, /#PizzariaZZQA|Hashtags|chave desconhecida/);
  });

  test("restrições e texto obrigatório vêm primeiro, com aviso de que são obrigatórios", () => {
    const out = briefingForPrompt({ products: "Pizzas", restrictions: "Sem álcool", mandatoryArtText: "CRM 123" }) ?? "";
    const lines = out.split("\n");
    assert.match(lines[0], /^Regras do cliente \(OBRIGATÓRIO respeitar.*restrições.*texto obrigatório/);
    assert.equal(lines[1], "- Restrições (datas, religião, etc.): Sem álcool");
    assert.equal(lines[2], "- Texto obrigatório nas artes: CRM 123");
    assert.match(lines[3], /^Briefing do cliente/);
    assert.equal(lines[4], "- Produtos / serviços: Pizzas");
  });

  test("sem regras: só o bloco de contexto", () => {
    const out = briefingForPrompt({ audience: "Jovens" }) ?? "";
    assert.match(out, /^Briefing do cliente/);
    assert.doesNotMatch(out, /Regras do cliente/);
  });

  test("valor de várias linhas: CRLF → LF, linhas recuadas, sem linhas em branco em excesso", () => {
    const out = briefingForPrompt({ products: "  Pizzas\r\n  Calzones \r\n\r\n\r\n\r\nEsfihas  " }) ?? "";
    assert.ok(out.endsWith("- Produtos / serviços: Pizzas\n  Calzones\n\n  Esfihas"), out);
    assert.doesNotMatch(out, /\r/);
  });

  test(`limite de ${BRIEFING_PROMPT_MAX} caracteres, cortado com "…", sem perder as regras`, () => {
    const out = briefingForPrompt({ restrictions: "Sem álcool", observations: "x".repeat(10_000) }) ?? "";
    assert.equal(out.length, BRIEFING_PROMPT_MAX);
    assert.ok(out.endsWith("…"));
    assert.match(out, /- Restrições \(datas, religião, etc\.\): Sem álcool/);
  });
});
