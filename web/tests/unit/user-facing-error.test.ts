import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { GENERIC_ERROR_MESSAGE, toUserMessage } from "../../src/lib/user-facing-error.ts";

// critério do S05/S17: nenhuma saída pode expor isto
const LEAK = /API_KEY|\.env|R2|RESEND|LINKEDIN_CLIENT|GEMINI|SECRET/;

// mensagens técnicas reais do código (lib/* e api/*)
const TECHNICAL = [
  "GEMINI_API_KEY não configurada",
  "R2 não configurado",
  "Drive não configurado (.env)",
  "RESEND_API_KEY/RESEND_FROM não configurados no servidor",
  "Resend não configurado",
  "LinkedIn não configurado (LINKEDIN_CLIENT_ID/SECRET)",
  "MEDIA_SIGNING_SECRET não configurado",
  "TOKEN_ENC_KEY must be a 64-character hex string (32 bytes)",
  "INTERNAL_API_KEY not configured",
  "JSON da service account inválido",
  "service account não pode ser dona de arquivos no Meu Drive (política do Google). Use um Drive COMPARTILHADO (mova a pasta de clientes pra lá e atualize DRIVE_ROOT_FOLDER_ID) ou configure GOOGLE_IMPERSONATE_EMAIL com delegação de domínio no Workspace",
  "Gemini 429: {\"error\":{\"code\":429}}",
  "Gemini 503: {\"error\":\"UNAVAILABLE\"}",
  "Gemini image 500: detalhe",
  "Gemini não retornou texto (SAFETY)",
  "resposta da IA não é JSON válido",
  "R2 upload falhou: 403 <Error>AccessDenied</Error>",
  "Drive list falhou: 403 {\"error\":\"forbidden\"}",
  "Download falhou: 500 erro",
  "Falha ao autenticar no Google: 400 invalid_grant",
  "Graph API demorou demais para responder (timeout)",
  "fetch failed",
  "Unexpected token } in JSON at position 1",
  "Erro com FOO_BAR_TOKEN interno",
];

const ADMIN = "Avise o administrador do sistema.";

// saída de cada caso de TECHNICAL antes da correção P2-G (não pode mudar)
const EXPECTED = new Map<string, string>([
  ["GEMINI_API_KEY não configurada", `A inteligência artificial não está configurada no servidor. ${ADMIN}`],
  ["R2 não configurado", `O armazenamento de mídia não está configurado no servidor. ${ADMIN}`],
  ["Drive não configurado (.env)", `A integração com o Google Drive não está configurada no servidor. ${ADMIN}`],
  ["RESEND_API_KEY/RESEND_FROM não configurados no servidor", `O envio de e-mails não está configurado no servidor. ${ADMIN}`],
  ["Resend não configurado", `O envio de e-mails não está configurado no servidor. ${ADMIN}`],
  ["LinkedIn não configurado (LINKEDIN_CLIENT_ID/SECRET)", `A conexão com o LinkedIn não está disponível no momento. ${ADMIN}`],
  ["MEDIA_SIGNING_SECRET não configurado", `O link seguro das mídias não está configurado no servidor. ${ADMIN}`],
  ["TOKEN_ENC_KEY must be a 64-character hex string (32 bytes)", `A proteção de credenciais não está configurada no servidor. ${ADMIN}`],
  ["INTERNAL_API_KEY not configured", `A integração interna não está configurada no servidor. ${ADMIN}`],
  ["JSON da service account inválido", `A integração com o Google Drive não está configurada no servidor. ${ADMIN}`],
  [TECHNICAL[10], `O Google Drive recusou a gravação: a pasta dos clientes precisa estar num Drive compartilhado. ${ADMIN}`],
  ["Gemini 429: {\"error\":{\"code\":429}}", "A inteligência artificial atingiu o limite de uso agora. Tente de novo em alguns minutos."],
  ["Gemini 503: {\"error\":\"UNAVAILABLE\"}", "A inteligência artificial não respondeu. Tente de novo em instantes."],
  ["Gemini image 500: detalhe", "A inteligência artificial não respondeu. Tente de novo em instantes."],
  ["Gemini não retornou texto (SAFETY)", "A inteligência artificial não devolveu um resultado válido. Tente de novo."],
  ["resposta da IA não é JSON válido", "A inteligência artificial não devolveu um resultado válido. Tente de novo."],
  ["R2 upload falhou: 403 <Error>AccessDenied</Error>", "Não foi possível salvar a mídia no armazenamento. Tente de novo."],
  ["Drive list falhou: 403 {\"error\":\"forbidden\"}", "Sem acesso à pasta no Google Drive. Confira se a pasta está compartilhada com o sistema."],
  ["Download falhou: 500 erro", "Não foi possível acessar o Google Drive. Tente de novo em instantes."],
  ["Falha ao autenticar no Google: 400 invalid_grant", `Não foi possível autenticar no Google Drive. ${ADMIN}`],
  ["Graph API demorou demais para responder (timeout)", "A Meta demorou demais para responder. Tente de novo em instantes."],
  ["fetch failed", "Falha de conexão com o serviço externo. Tente de novo em instantes."],
  ["Unexpected token } in JSON at position 1", GENERIC_ERROR_MESSAGE],
  ["Erro com FOO_BAR_TOKEN interno", GENERIC_ERROR_MESSAGE],
]);

const ROUTE_FALLBACK = "Não foi possível gerar a arte agora. Tente de novo em instantes.";
const TIMEOUT = "O serviço externo demorou demais para responder. Tente de novo em instantes.";
const ART_IMAGE = "Não foi possível usar a imagem da arte-base ou da logo do cliente. Confira os arquivos cadastrados e tente de novo.";

/** As 3 formas que chegam ao toUserMessage: a exceção, só o texto e o corpo `{ error }` da rota. */
function forms(e: Error | string): unknown[] {
  const msg = typeof e === "string" ? e : e.message;
  return [typeof e === "string" ? new Error(e) : e, msg, { error: msg }];
}

/** Captura a exceção real que o runtime lança. */
function caught(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error("não lançou");
}

describe("toUserMessage", () => {
  test("nenhuma saída expõe nome de variável, .env, R2, chave ou segredo", () => {
    for (const msg of TECHNICAL) {
      for (const input of [msg, new Error(msg), { error: msg }]) {
        const out = toUserMessage(input);
        assert.doesNotMatch(out, LEAK, `"${msg}" → "${out}"`);
        assert.ok(out.length > 0 && out.length <= 300);
      }
    }
  });

  test("as 6 mensagens de configuração do plano viram textos amigáveis específicos", () => {
    assert.match(toUserMessage(new Error("GEMINI_API_KEY não configurada")), /inteligência artificial não está configurada/);
    assert.match(toUserMessage("R2 não configurado"), /armazenamento de mídia/);
    assert.match(toUserMessage("Drive não configurado (.env)"), /Google Drive não está configurada/);
    assert.match(toUserMessage("RESEND_API_KEY/RESEND_FROM não configurados no servidor"), /envio de e-mails/);
    assert.match(toUserMessage("LinkedIn não configurado (LINKEDIN_CLIENT_ID/SECRET)"), /LinkedIn/);
    assert.match(toUserMessage("MEDIA_SIGNING_SECRET não configurado"), /link seguro das mídias/);
  });

  test("mensagens já amigáveis passam intactas", () => {
    assert.equal(toUserMessage(new Error("Cliente não encontrado")), "Cliente não encontrado");
    assert.equal(
      toUserMessage("sem permissão de escrita no Drive — compartilhe a pasta raiz com a service account como EDITOR"),
      "sem permissão de escrita no Drive — compartilhe a pasta raiz com a service account como EDITOR"
    );
  });

  test("vazio, desconhecido e fallback", () => {
    assert.equal(toUserMessage(undefined), GENERIC_ERROR_MESSAGE);
    assert.equal(toUserMessage(42), GENERIC_ERROR_MESSAGE);
    assert.equal(toUserMessage(new Error("")), GENERIC_ERROR_MESSAGE);
    assert.equal(toUserMessage("Erro com FOO_BAR_TOKEN interno", "Falha ao gerar legenda"), "Falha ao gerar legenda");
    assert.equal(toUserMessage("x".repeat(400)), GENERIC_ERROR_MESSAGE);
  });

  test("os 24 casos técnicos continuam com os mesmos textos (Error, string e { error })", () => {
    assert.equal(EXPECTED.size, TECHNICAL.length);
    for (const msg of TECHNICAL) {
      const expected = EXPECTED.get(msg);
      assert.ok(expected, `sem saída esperada para "${msg}"`);
      for (const input of forms(msg)) assert.equal(toUserMessage(input), expected, `"${msg}"`);
    }
  });

  test("timeout e cancelamento (AbortError, TimeoutError, \"aborted\") viram o texto de timeout", () => {
    // o mesmo objeto que o fetch lança quando o AbortController do geminiFetch/art-gen dispara
    const abort = AbortSignal.abort().reason as Error;
    assert.equal(abort.name, "AbortError");
    assert.equal(abort.message, "This operation was aborted");
    const errors: (Error | string)[] = [
      abort,
      new DOMException("The operation was aborted due to timeout", "TimeoutError"),
      "The user aborted a request.",
      "signal is aborted without reason",
      "Request timed out",
      "AbortError: This operation was aborted",
    ];
    for (const e of errors) {
      for (const input of forms(e)) assert.equal(toUserMessage(input, ROUTE_FALLBACK), TIMEOUT, String(e));
    }
    // pelo `name`, mesmo sem texto
    assert.equal(toUserMessage(new DOMException("", "AbortError"), ROUTE_FALLBACK), TIMEOUT);
    assert.equal(toUserMessage(new DOMException("", "TimeoutError")), TIMEOUT);
  });

  test("exceções do runtime em inglês (TypeError, SyntaxError, RangeError, ReferenceError) viram o fallback", () => {
    const errors: Error[] = [
      caught(() => (null as unknown as { x: number }).x), // Cannot read properties of null (reading 'x')
      caught(() => (undefined as unknown as { x: number }).x),
      caught(() => {
        const fn = undefined as unknown as () => void;
        fn();
      }), // fn is not a function
      caught(() => JSON.parse("<html>")), // Unexpected token '<', "<html>" is not valid JSON
      caught(() => JSON.parse("")), // Unexpected end of JSON input
      caught(() => new Date(NaN).toISOString()), // RangeError: Invalid time value
      caught(() => new URL("nada")), // TypeError: Invalid URL
      new ReferenceError("foo is not defined"),
      new TypeError("posts is not iterable"),
    ];
    for (const e of errors) {
      assert.match(e.name, /^(Type|Syntax|Range|Reference)Error$/);
      for (const input of [...forms(e), `${e.name}: ${e.message}`]) {
        assert.equal(toUserMessage(input, ROUTE_FALLBACK), ROUTE_FALLBACK, `${e.name}: ${e.message}`);
      }
      assert.equal(toUserMessage(e), GENERIC_ERROR_MESSAGE);
    }
    for (const input of forms("undefined is not an object (evaluating 'post.client')")) {
      assert.equal(toUserMessage(input, ROUTE_FALLBACK), ROUTE_FALLBACK);
    }
  });

  test("TypeError com texto conhecido mantém o texto fixo (o \"fetch failed\" do undici)", () => {
    for (const input of forms(new TypeError("fetch failed"))) {
      assert.equal(toUserMessage(input, ROUTE_FALLBACK), "Falha de conexão com o serviço externo. Tente de novo em instantes.");
    }
  });

  test("erros de imagem do lib/art-gen.ts viram texto sobre a arte-base ou a logo, sem URL nem host", () => {
    const messages = [
      "Falha ao baixar imagem (404): https://pub-123.r2.dev/templates/base.png",
      "URL de imagem deve ser https: http://pub-123.r2.dev/logos/logo.png",
      "URL de imagem deve ser https: ftp://exemplo.com/logo.png",
      "Host de imagem não permitido: 169.254.169.254",
    ];
    for (const msg of messages) {
      for (const input of forms(msg)) {
        const out = toUserMessage(input, ROUTE_FALLBACK);
        assert.equal(out, ART_IMAGE, msg);
        assert.doesNotMatch(out, /https?:|ftp:|\d+\.\d+\.\d+/);
      }
    }
  });

  test("qualquer outra mensagem com URL vira o fallback", () => {
    const messages = [
      "Erro ao acessar https://graph.facebook.com/v21.0/me/accounts?access_token=abc",
      "Imagem indisponível: https://pub-123.r2.dev/posts/a.png",
      "Falha em HTTP://EXEMPLO.COM/arquivo",
    ];
    for (const msg of messages) {
      for (const input of forms(msg)) assert.equal(toUserMessage(input, ROUTE_FALLBACK), ROUTE_FALLBACK, msg);
    }
    assert.equal(toUserMessage("Erro ao acessar https://exemplo.com"), GENERIC_ERROR_MESSAGE);
  });

  test("mensagens amigáveis em pt-BR das rotas continuam intactas (Error, string e { error })", () => {
    const messages = [
      "Cliente não encontrado",
      "Os posts deste cliente não são agendados pelo sistema (só produção): ficam como rascunho e não entram na fila de publicação.",
      "Segmento inválido: use CORR, CARE ou COLETIVO.",
      "Status inválido: use ativo, pausado ou encerrado.",
      "Cronograma já aprovado. Use 'Reverter aprovação' antes de reenviar.",
      "Há ajuste pendente neste post — aguarde a equipe concluir.",
      "Esta pendência já foi resolvida. Reabra-a antes de converter.",
      "Conexão inativa — atualize o token em /meta",
      "Imagem muito grande (9MB, máx 8MB)",
    ];
    for (const msg of messages) {
      for (const input of forms(msg)) assert.equal(toUserMessage(input, ROUTE_FALLBACK), msg);
    }
  });
});
