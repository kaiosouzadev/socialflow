/**
 * OWASP AUD2-01 (R4): ReDoS no importador do documento mensal.
 *
 * Antes, `splitLoginPassword` (:509) e `splitPhones` (:1022) tinham backtracking CÚBICO e outras
 * ~10 regex eram quadráticas: uma linha com 1–3 KB de espaços travava o servidor por segundos
 * (`Telefone e WhatsApp:: 1<3000 espaços>x` → parseMonthlyDoc 16 s; `Acesso ao Instagram:: login:<3000
 * espaços>x` → stripCredentials 23 s). Agora:
 *   1. cada regex perigosa foi trocada por código linear que devolve EXATAMENTE o mesmo resultado —
 *      provado aqui comparando com a regex antiga (copiada abaixo) em milhares de entradas aleatórias;
 *   2. U+2028/U+2029 no meio da linha viram espaço (eles faziam `.`/`$` voltarem atrás a cada posição);
 *   3. linha de credencial/telefone com mais de 500 caracteres não passa pelas regex (credencial: sai
 *      do texto e fica oculta, nunca em claro; telefone: fica como texto);
 *   4. os payloads da auditoria (3 KB e 50 KB) rodam em menos de 50 ms.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SCAN_LINE,
  extractCredentials,
  matchInlineCredential,
  parseMonthlyDoc,
  proposeBriefing,
  singleColonPair,
  splitLoginPassword,
  splitPhoneList,
  splitPhones,
  splitSpacedSlash,
  stripCredentials,
  stripTrailingParenNote,
  trailingParenGroup,
  trimEndChars,
  trimNonAlnum,
} from "../../src/lib/doc-import.ts";

// ------------------------------------------------------------ as regex ANTIGAS (referência)

const legacy = {
  inline: (v: string) => {
    const m =
      /^(?:(?:login|usu[aá]rio|user|e-?mail)\s*:{0,2}\s*)?(.*?)(?:^|\s*[/|,;]\s*|\s+)(?:senha|password)(?:\s*:{1,2}\s*|\s+)(\S.*)$/i.exec(v);
    return m ? { login: m[1], password: m[2] } : null;
  },
  slash: (v: string) => v.split(/\s+[/|]\s+/),
  phones: (v: string) => v.split(/\s*(?:\/|\||;|,|\s+e\s+|\s+ou\s+)\s*/),
  paren: (s: string) => {
    const m = /\s*\(([^()]*)\)\s*$/.exec(s);
    return m ? { inner: m[1], index: m.index } : null;
  },
  parenNote: (s: string) => s.replace(/\s+\([^()]*\)$/, ""),
  trimEnd: (s: string) => s.replace(/[.:!]+$/, ""),
  trimColons: (s: string) => s.replace(/:+$/, ""),
  alnum: (s: string) => s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""),
  dateLike: (s: string) => /^\d{0,2}\s*\/?\s*\d{0,2}$/.test(s),
  singleColon: (t: string) => {
    const m = /^([^:]{2,120}?)\s*:(?:\s+(.*))?$/.exec(t);
    return m ? { label: m[1], value: m[2] } : null;
  },
};
const NEW_DATE_LIKE = /^\d{0,2}\s*(?:\/\s*)?\d{0,2}$/;

// ------------------------------------------------------------ gerador determinístico

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gen(seed: number, alphabet: readonly string[], maxTokens: number, count: number): string[] {
  const r = rng(seed);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const len = Math.floor(r() * (maxTokens + 1));
    let s = "";
    for (let k = 0; k < len; k++) s += alphabet[Math.floor(r() * alphabet.length)];
    out.push(s);
  }
  return out;
}

const SPACES = [" ", " ", "  ", "\t", "\u00a0", "\u3000", "\n", "\u2028"];
const CRED_ALPHABET = [
  ...SPACES, ":", "::", "/", "|", ",", ";", "-", "x", "ab", "Q1", "@", "(", ")", "#",
  "login", "LOGIN", "Login:", "usuário", "USUARIO", "user", "e-mail", "email", "senha", "SENHA", "Senha:",
  "password", "PassWord", "senha123", "e", "ou", "á", "😀",
];
const PHONE_ALPHABET = [...SPACES, "/", "|", ";", ",", "e", "ou", "o", "u", " e ", " ou ", "(11)", "9999-0000", "1", "x", "E"];
const PAREN_ALPHABET = [...SPACES, "(", ")", "a", "1", "/", "x y", "((", "))", "😀"];
const PUNCT_ALPHABET = [...SPACES, ".", ":", "!", "a", "1", "-", "_", "#", "😀", "\ud83d", "á", "Ç", "٣"];
const DATE_ALPHABET = [...SPACES, "/", "1", "12", "a"];
const LABEL_ALPHABET = [...SPACES, ":", "::", "a", "Rótulo", "x".repeat(60), "https", "-", "😀"];

function sameEverywhere<T>(name: string, inputs: string[], fresh: (s: string) => T, old: (s: string) => T) {
  let checked = 0;
  for (const s of inputs) {
    assert.deepEqual(fresh(s), old(s), `${name} diverge para ${JSON.stringify(s)}`);
    checked++;
  }
  assert.ok(checked > 0);
}

// ------------------------------------------------------------ 1. mesmo resultado das regex antigas

describe("AUD2-01 — funções lineares devolvem o mesmo que as regex antigas", () => {
  test("matchInlineCredential ≡ regex de login/senha (:509), 40 mil entradas", () => {
    const inputs = [
      ...gen(1, CRED_ALPHABET, 9, 25_000),
      ...gen(2, CRED_ALPHABET, 16, 15_000),
      "login: zz senha: SENHA-FALSA-123", "Login:: @loja / senha Ab#12345", "senha x", "e-mail:a@b.c senha 1234",
      "usuário  :  zz | senha:: x", "loginsenha x", "senha::", "senha :", "x senha\n y", "x\u2028senha y",
    ];
    sameEverywhere("matchInlineCredential", inputs, matchInlineCredential, legacy.inline);
  });

  test("splitSpacedSlash ≡ split(/\\s+[/|]\\s+/) e splitPhoneList ≡ split dos telefones (:1022)", () => {
    sameEverywhere("splitSpacedSlash", gen(3, CRED_ALPHABET, 12, 20_000), splitSpacedSlash, legacy.slash);
    sameEverywhere("splitPhoneList", gen(4, PHONE_ALPHABET, 14, 30_000), splitPhoneList, legacy.phones);
    assert.deepEqual(splitPhoneList("1 / e 2"), legacy.phones("1 / e 2"));
  });

  test("parênteses no fim, pontuação/símbolos das pontas, data e rótulo com um ':'", () => {
    sameEverywhere("trailingParenGroup", gen(5, PAREN_ALPHABET, 12, 20_000), trailingParenGroup, legacy.paren);
    sameEverywhere("stripTrailingParenNote", gen(6, PAREN_ALPHABET, 12, 20_000), stripTrailingParenNote, legacy.parenNote);
    sameEverywhere("trimEndChars .:!", gen(7, PUNCT_ALPHABET, 12, 10_000), (s) => trimEndChars(s, ".:!"), legacy.trimEnd);
    sameEverywhere("trimEndChars :", gen(8, PUNCT_ALPHABET, 12, 10_000), (s) => trimEndChars(s, ":"), legacy.trimColons);
    sameEverywhere("trimNonAlnum", gen(9, PUNCT_ALPHABET, 12, 20_000), trimNonAlnum, legacy.alnum);
    sameEverywhere("dateLike", gen(10, DATE_ALPHABET, 8, 20_000), (s) => NEW_DATE_LIKE.test(s), legacy.dateLike);
    sameEverywhere("singleColonPair", gen(11, LABEL_ALPHABET, 10, 20_000), singleColonPair, legacy.singleColon);
  });
});

// ------------------------------------------------------------ 2. payloads da auditoria: < 50 ms

/** menor tempo de 3 execuções (descarta pausa do GC/da máquina) */
function bestMs(fn: () => void): number {
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    fn();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

function payloads(n: number): Record<string, string> {
  const sp = " ".repeat(n);
  return {
    // AUD-2 redos-e2e.mts / redos-route.mjs
    telefone_whatsapp: `Telefone e WhatsApp:: 1${sp}x`,
    acesso_login: `Acesso ao Instagram:: login:${sp}x`,
    acesso_senha: `Instagram:: usuario${sp}x senha`,
    // AUD-2 redos-docimport.mts e as quadráticas (:255, :261, :511, :537, :573, :589, :624, :801, :857)
    titulo_espacos: `1. TÍTULO ${sp}x`,
    titulo_parenteses: `1. TÍTULO (${sp}x`,
    titulo_tabs: `1. TÍTULO ${"\t".repeat(n)})x`,
    data_espacos: `01 - TÍTULO: x (1${"\u3000".repeat(n)}!)`,
    senha_espacos: `Login:: a${sp}x senha`,
    senha_linha: `senha ${sp}x`,
    senha_simbolos: `Senha:${"\u3000".repeat(n)}x`,
    login_simbolos: `login:${"\u3000".repeat(n)}x`,
    barra: `Acesso ao Instagram:: x${" /".repeat(n / 2)}!`,
    nota_parenteses: `Senha:: abc${"\u3000".repeat(n)})`,
    dois_pontos: ":".repeat(n),
    status_pontos: `${"APROVADO"}${".".repeat(n)}x`,
    // achados novos desta correção: U+2028 no meio da linha e "Rótulo:" com espaços
    legenda_u2028: `01 - TÍTULO: x (01/09)\nLEGENDA:${sp}x\u2028`,
    rotulo_u2028: `${"::".repeat(n / 2)}\u2028`,
    rotulo_espacos: `ab${sp}c`,
    credencial_u2028: `senha:${sp}x\u2028`,
  };
}

describe("AUD2-01 — payloads da auditoria rodam em menos de 50 ms", () => {
  for (const size of [3_000, 50_000]) {
    test(`${size / 1000} KB por linha: stripCredentials, extractCredentials, parseMonthlyDoc e proposeBriefing`, () => {
      for (const [name, text] of Object.entries(payloads(size))) {
        const ms = bestMs(() => {
          stripCredentials(text);
          extractCredentials(text);
          proposeBriefing(parseMonthlyDoc(text, { refMonth: "2026-09" }));
        });
        assert.ok(ms < 50, `${name} (${text.length} caracteres) levou ${ms.toFixed(1)} ms`);
      }
    });
  }

  test("funções puras com 50 KB de espaços: cada uma < 50 ms", () => {
    const sp = " ".repeat(50_000);
    const cases: [string, () => unknown][] = [
      ["splitLoginPassword", () => splitLoginPassword(`login:${sp}x`)],
      ["splitLoginPassword (barra)", () => splitLoginPassword(`a${sp}x senha`)],
      ["matchInlineCredential (prefixo)", () => matchInlineCredential(`login::${sp}:${sp}x`)],
      ["splitPhoneList", () => splitPhoneList(`1${sp}x`)],
      ["splitPhones (rótulo telefone e whats)", () => splitPhones("telefone e whatsapp", `1${sp}x`)],
      ["trailingParenGroup", () => trailingParenGroup(`(${sp}x`)],
      ["stripTrailingParenNote", () => stripTrailingParenNote(`a${sp}(x)`)],
      ["trimNonAlnum", () => trimNonAlnum(`${"\u3000".repeat(50_000)}x`)],
      ["singleColonPair", () => singleColonPair(`ab${sp}c`)],
    ];
    for (const [name, fn] of cases) {
      const ms = bestMs(fn);
      assert.ok(ms < 50, `${name} levou ${ms.toFixed(1)} ms`);
    }
  });
});

// ------------------------------------------------------------ 3. corte de tamanho e U+2028

describe("AUD2-01 — linha longa e separador U+2028", () => {
  test("credencial com valor de mais de 500 caracteres: sai do texto, oculta (nunca em claro)", () => {
    const longValue = `zz${" ".repeat(MAX_SCAN_LINE)}/ SENHA-FALSA-123`;
    const doc = `Instagram: login: ${longValue}\n\nPAMELA\n01 - TÍTULO: Teste (01/09)\nLEGENDA: oi`;
    const out = extractCredentials(doc);
    assert.equal(out.credentials.length, 0, "não importa credencial de linha longa demais");
    assert.ok(!out.text.includes("SENHA-FALSA-123"), "a senha não fica no texto");
    assert.deepEqual(out.withheld.map((w) => w.line), [1], "a linha aparece só como 'não importado' (oculta)");
    const proposal = proposeBriefing(parseMonthlyDoc(doc, { refMonth: "2026-09" }));
    assert.ok(!JSON.stringify(proposal).includes("SENHA-FALSA-123"));
  });

  test("debaixo de 'Acesso ao Instagram::' vazio, linha longa demais também fica oculta", () => {
    const doc = `Acesso ao Instagram::\n@zz${" ".repeat(MAX_SCAN_LINE)}/ Ab#12345\n\nPAMELA\n01 - TÍTULO: T (01/09)`;
    const out = extractCredentials(doc);
    assert.ok(!out.text.includes("Ab#12345"));
    assert.equal(out.withheld.length, 1);
  });

  test("telefones: lista curta continua separada; texto de mais de 500 caracteres fica como está", () => {
    assert.deepEqual(splitPhones("telefone e whatsapp", "(11) 3333-4444 / (11) 99999-0000"), {
      phone: "(11) 3333-4444",
      whatsapp: "(11) 99999-0000",
    });
    const long = `(11) 3333-4444 /${" ".repeat(MAX_SCAN_LINE)}(11) 99999-0000`;
    assert.deepEqual(splitPhones("telefone e whatsapp", long), { phone: long });
  });

  test("U+2028 no meio da linha vira espaço: legenda e credencial lidas como numa linha comum", () => {
    const doc = "Senha::\u2028SENHA-FALSA-123\n\nPAMELA\n01 - TÍTULO: Teste (01/09)\nLEGENDA:\u2028Olá\u2029mundo";
    const parsed = parseMonthlyDoc(doc, { refMonth: "2026-09" });
    assert.equal(parsed.posts.length, 1);
    assert.equal(parsed.posts[0].caption, "Olá mundo");
    assert.ok(!JSON.stringify(parsed).includes("SENHA-FALSA-123"));
  });
});
