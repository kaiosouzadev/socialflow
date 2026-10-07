/**
 * Converte erros técnicos de integração em mensagens para o usuário, em
 * pt-BR e sem nomes de variáveis de ambiente, chaves ou detalhes internos
 * (puro). O detalhe técnico deve ir só para o log do servidor.
 */

export const GENERIC_ERROR_MESSAGE = "Algo deu errado. Tente de novo em instantes.";

const ADMIN = "Avise o administrador do sistema.";

const TIMEOUT_MESSAGE = "O serviço externo demorou demais para responder. Tente de novo em instantes.";

const RULES: readonly { test: RegExp; message: string }[] = [
  // configuração ausente
  { test: /GEMINI_API_KEY|gemini\b.*n[ãa]o configurad/i, message: `A inteligência artificial não está configurada no servidor. ${ADMIN}` },
  { test: /\bR2\b.*n[ãa]o configurad|\bR2_[A-Z_]+/, message: `O armazenamento de mídia não está configurado no servidor. ${ADMIN}` },
  { test: /storage ?quota|pol[ií]tica do Google/i, message: `O Google Drive recusou a gravação: a pasta dos clientes precisa estar num Drive compartilhado. ${ADMIN}` },
  { test: /Drive n[ãa]o configurado|GOOGLE_SERVICE_ACCOUNT|DRIVE_ROOT_FOLDER_ID|GOOGLE_IMPERSONATE_EMAIL|JSON da service account/i, message: `A integração com o Google Drive não está configurada no servidor. ${ADMIN}` },
  { test: /RESEND_API_KEY|RESEND_FROM|resend n[ãa]o configurado/i, message: `O envio de e-mails não está configurado no servidor. ${ADMIN}` },
  { test: /LinkedIn n[ãa]o configurado|LINKEDIN_CLIENT_(ID|SECRET)/i, message: `A conexão com o LinkedIn não está disponível no momento. ${ADMIN}` },
  { test: /MEDIA_SIGNING_SECRET/, message: `O link seguro das mídias não está configurado no servidor. ${ADMIN}` },
  { test: /TOKEN_ENC_KEY/, message: `A proteção de credenciais não está configurada no servidor. ${ADMIN}` },
  { test: /INTERNAL_API_KEY/, message: `A integração interna não está configurada no servidor. ${ADMIN}` },
  // OpenAI (ChatGPT): chave ausente (lib/ai-text) e "OpenAI <status> <code>: …" (lib/openai, já sem a chave)
  { test: /chave da OpenAI antes de usar o ChatGPT|OPENAI_API_KEY/, message: `A chave da OpenAI (ChatGPT) não está configurada. ${ADMIN}` },
  { test: /^OpenAI (401\b|\d{3} invalid_api_key\b)/, message: `A chave da OpenAI (ChatGPT) foi recusada. ${ADMIN}` },
  { test: /^OpenAI 429 insufficient_quota\b/, message: `A conta da OpenAI (ChatGPT) está sem créditos ou no limite de gastos. ${ADMIN}` },
  { test: /^OpenAI 429\b/, message: "A inteligência artificial atingiu o limite de uso agora. Tente de novo em alguns minutos." },
  { test: /^OpenAI (404\b|\d{3} model_not_found\b)/, message: `O modelo de IA escolhido não foi encontrado. ${ADMIN}` },
  { test: /^OpenAI \d{3}\b/, message: "A inteligência artificial não respondeu. Tente de novo em instantes." },
  { test: /^OpenAI não retornou/, message: "A inteligência artificial não devolveu um resultado válido. Tente de novo." },
  // falhas em tempo de execução
  { test: /^Gemini (image )?429\b/i, message: "A inteligência artificial atingiu o limite de uso agora. Tente de novo em alguns minutos." },
  { test: /^Gemini (image )?\d{3}\b/i, message: "A inteligência artificial não respondeu. Tente de novo em instantes." },
  { test: /Gemini não retornou|resposta da IA não é JSON/i, message: "A inteligência artificial não devolveu um resultado válido. Tente de novo." },
  { test: /^R2 (upload|delete) falhou/, message: "Não foi possível salvar a mídia no armazenamento. Tente de novo." },
  { test: /^(Drive (list|criar pasta|upload) falhou|Download falhou): (401|403|404)\b/, message: "Sem acesso à pasta no Google Drive. Confira se a pasta está compartilhada com o sistema." },
  { test: /^(Drive (list|criar pasta|upload) falhou|Download falhou)/, message: "Não foi possível acessar o Google Drive. Tente de novo em instantes." },
  { test: /Falha ao autenticar no Google/, message: `Não foi possível autenticar no Google Drive. ${ADMIN}` },
  { test: /Graph API demorou demais/i, message: "A Meta demorou demais para responder. Tente de novo em instantes." },
  { test: /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up/i, message: "Falha de conexão com o serviço externo. Tente de novo em instantes." },
  // AbortController/AbortSignal.timeout (geminiFetch, art-gen): "This operation was aborted"
  { test: /\b(aborted|AbortError|TimeoutError|timed out)\b/i, message: TIMEOUT_MESSAGE },
  // lib/art-gen.ts: imagem da arte-base ou da logo (trazem URL ou host)
  { test: /^(Falha ao baixar imagem|URL de imagem deve ser https|Host de imagem n[ãa]o permitido)\b/, message: "Não foi possível usar a imagem da arte-base ou da logo do cliente. Confira os arquivos cadastrados e tente de novo." },
];

/** Exceções de timeout/cancelamento, pelo `name` (AbortError é um DOMException). */
const TIMEOUT_NAMES = new Set(["AbortError", "TimeoutError"]);

/** Exceções do runtime JS: o texto delas nunca serve ao usuário. */
const RUNTIME_NAMES = new Set(["TypeError", "SyntaxError", "RangeError", "ReferenceError", "EvalError", "URIError"]);

/** Texto de exceção do runtime em inglês (quando chega só a string, sem o `name`). */
const RUNTIME_TEXT =
  /\b(Type|Syntax|Range|Reference|Eval|URI)Error\b|Cannot (read|set) propert(y|ies) of|is not (a function|a constructor|defined|iterable|valid JSON)\b|\b(undefined|null) is not\b|Unexpected (token|end of|identifier|number|string)\b|\bInvalid (URL|time value|array length|Date)\b|Maximum call stack|before initialization/;

/** Sobrou algo técnico? (variável de ambiente, .env, chave, JSON, segredo) */
const TECHNICAL = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|\.env\b|\bR2\b|API_KEY|SECRET|Bearer\s|[{}]|\bat .+\(.+:\d+:\d+\)/;

/** URL nunca vai para o usuário (endereço interno, assinatura, host). */
const URL_TEXT = /\bhttps?:\/\//i;

const MAX_LENGTH = 300;

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const o = error as { error?: unknown; message?: unknown };
    if (typeof o.error === "string") return o.error;
    if (typeof o.message === "string") return o.message;
  }
  return "";
}

function nameOf(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" ? name : "";
}

/**
 * Mensagem amigável para mostrar ao usuário. Erros conhecidos viram textos
 * fixos; mensagens já amigáveis passam; o que tiver detalhe técnico (exceção
 * do runtime, URL, variável de ambiente…) vira `fallback`.
 */
export function toUserMessage(error: unknown, fallback: string = GENERIC_ERROR_MESSAGE): string {
  const name = nameOf(error);
  if (TIMEOUT_NAMES.has(name)) return TIMEOUT_MESSAGE;
  const msg = messageOf(error).trim();
  if (!msg) return fallback;
  // antes do `name`: o "fetch failed" do undici é um TypeError com texto conhecido
  for (const rule of RULES) {
    if (rule.test.test(msg)) return rule.message;
  }
  if (RUNTIME_NAMES.has(name) || RUNTIME_TEXT.test(msg)) return fallback;
  if (TECHNICAL.test(msg) || URL_TEXT.test(msg) || msg.length > MAX_LENGTH) return fallback;
  return msg;
}
