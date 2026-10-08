/**
 * Política de senha das usuárias do painel (auditoria OWASP AC-10).
 *
 * Puro (sem banco nem rede): roda no servidor (criar usuária, trocar senha) e na
 * tela (aviso imediato). Regras:
 *   - pelo menos 10 caracteres e no máximo 72 bytes (o bcrypt ignora o que passa disso);
 *   - não pode ser senha comum, sequência ou repetição trivial (lista curta embutida:
 *     com o mínimo de 10 caracteres, só as comuns longas importam);
 *   - não pode ser "palavra óbvia + números/símbolos" (Coletivo2025!, Senha@12345);
 *   - não pode conter o e-mail (parte antes do @) nem o nome da pessoa.
 */

export const PASSWORD_MIN_LENGTH = 10;
/** Limite do bcrypt: bytes além de 72 são ignorados na comparação. */
export const PASSWORD_MAX_BYTES = 72;

export const PASSWORD_HELP = "Mínimo de 10 caracteres. Evite senhas comuns, sequências e o seu nome.";

export const PASSWORD_MESSAGES = {
  required: "Informe a senha.",
  tooShort: "A senha precisa ter pelo menos 10 caracteres.",
  tooLong: "A senha é longa demais. Use até 72 caracteres (sem muitos acentos ou emojis).",
  common: "Esta senha é muito comum ou fácil de adivinhar. Escolha outra.",
  personal: "A senha não pode conter o seu nome ou o seu e-mail.",
} as const;

/**
 * Senhas comuns com 10+ caracteres (listas públicas de vazamentos, incluindo as
 * brasileiras). Comparação sem maiúsculas/minúsculas.
 */
const COMMON = new Set([
  "1234567890", "0123456789", "0987654321", "9876543210", "12345678910", "123456789a", "a123456789",
  "1234567890a", "qwertyuiop", "qwertyuiop1", "qwertyuiop123", "asdfghjkl1", "asdfghjklç", "zxcvbnm123",
  "1q2w3e4r5t", "1q2w3e4r5t6y", "q1w2e3r4t5", "1qaz2wsx3edc", "qazwsxedcrfv", "zaq12wsxcde3",
  "password12", "password123", "password1234", "passw0rd123", "p@ssw0rd123", "iloveyou12", "iloveyou123",
  "senha12345", "senha123456", "senha1234567", "senhasenha", "minhasenha", "minhasenha1", "minhasenha123",
  "mudar12345", "mudar123456", "mudarsenha", "trocarsenha", "abc1234567", "abcd123456", "abcde12345",
  "abcdef1234", "abcdefghij", "princesa123", "flamengo123", "corinthians", "corinthians1", "palmeiras1",
  "palmeiras123", "saopaulo123", "gremio1234", "vasco12345", "botafogo123", "cruzeiro123", "brasil2024",
  "brasil2025", "brasil2026", "brasil12345", "jesuscristo", "deusefiel1", "deusefiel123", "jesus12345",
  "familia123", "amoreterno", "teamo12345", "estrela123", "chocolate1", "chocolate123", "football12",
  "baseball12", "basketball", "superman12", "batman1234", "pokemon123", "starwars12", "whatever12",
  "trustno1234", "letmein123", "welcome123", "welcome1234", "admin12345", "administrator", "administrador",
  "admin@1234", "root123456", "changeme123", "1111111111", "0000000000", "1212121212", "1122334455",
  "1231231234", "1234512345", "1234554321", "123123123123", "123456123456", "147258369a", "1472583690",
  "159753456852", "7894561230", "3216549870", "a1b2c3d4e5", "aa12345678", "qwerty1234", "qwerty12345",
  "qwerty123456", "asdf123456", "zxcvbnm1234", "1q2w3e4r5t6y7u", "socialflow1", "socialflow123",
]);

/**
 * Palavras óbvias: a senha não pode ser só uma delas (ou repetida) com números e
 * símbolos em volta, como "Coletivo2025!" ou "senha@12345".
 */
const OBVIOUS_WORDS = new Set([
  "senha", "password", "passw", "pass", "admin", "administrador", "administrator", "root", "user", "usuario",
  "usuaria", "login", "qwerty", "qwertyuiop", "asdf", "asdfgh", "asdfghjkl", "zxcvbnm", "abc", "abcd", "abcdef",
  "mudar", "mudarsenha", "trocar", "teste", "test", "welcome", "bemvindo", "bemvinda", "iloveyou", "teamo",
  "coletivo", "grupocoletivo", "coletivoestudio", "estudio", "agencia", "socialflow", "flow", "instagram",
  "facebook", "linkedin", "brasil", "deus", "jesus", "amor", "familia", "princesa", "flamengo", "corinthians",
  "palmeiras", "saopaulo", "santos", "gremio", "vasco", "botafogo", "cruzeiro", "internacional",
]);

const KEYBOARD_ROWS = ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm", "1qaz2wsx3edc4rfv", "qazwsxedcrfvtgb"];

/** Remove acentos e passa para minúsculas (comparações "humanas"). */
function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Bytes UTF-8 (sem depender de Buffer: roda também no navegador). */
function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** "abcabcabc", "12121212", "senhasenha": a senha é a repetição de um pedaço curto. */
function isRepetition(s: string): boolean {
  for (let size = 1; size <= Math.floor(s.length / 2); size++) {
    const unit = s.slice(0, size);
    // aceita sobra no fim: "abcabcab" = "abc" repetido
    if (unit.repeat(Math.ceil(s.length / size)).slice(0, s.length) === s) return true;
  }
  return false;
}

/** Sequência de passo constante em códigos (0123…, 9876…, abcd…, aceg…) ou trecho de fileira do teclado. */
function isSequence(s: string): boolean {
  if (s.length < 3) return false;
  const step = s.charCodeAt(1) - s.charCodeAt(0);
  if (Math.abs(step) <= 2 && step !== 0) {
    let ok = true;
    for (let i = 2; i < s.length; i++) {
      if (s.charCodeAt(i) - s.charCodeAt(i - 1) !== step) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  for (const row of KEYBOARD_ROWS) {
    const reversed = [...row].reverse().join("");
    if (row.includes(s) || reversed.includes(s)) return true;
  }
  return false;
}

/** Só letras da senha, sem acento, minúsculas ("Coletivo@2025!" → "coletivo"). */
function lettersOnly(s: string): string {
  return fold(s).replace(/[^a-z]/g, "");
}

/** Pedaços pessoais que não podem aparecer na senha (≥ 4 letras para não pegar "ana" dentro de "banana"). */
function personalTokens(context: PasswordContext): string[] {
  const out = new Set<string>();
  const local = context.email ? fold(context.email.split("@")[0] ?? "") : "";
  for (const part of local.split(/[^a-z0-9]+/)) if (part.length >= 4) out.add(part);
  if (local.replace(/[^a-z0-9]/g, "").length >= 4) out.add(local.replace(/[^a-z0-9]/g, ""));
  for (const part of fold(context.name ?? "").split(/[^a-z0-9]+/)) if (part.length >= 4) out.add(part);
  return [...out];
}

export type PasswordContext = { email?: string | null; name?: string | null };
export type PasswordCheck = { ok: true } | { ok: false; message: string };

/** Confere a senha contra a política. Devolve a primeira regra violada (mensagem pt-BR). */
export function checkPasswordPolicy(password: unknown, context: PasswordContext = {}): PasswordCheck {
  if (typeof password !== "string" || password.length === 0) return { ok: false, message: PASSWORD_MESSAGES.required };
  if ([...password].length < PASSWORD_MIN_LENGTH) return { ok: false, message: PASSWORD_MESSAGES.tooShort };
  if (utf8Bytes(password) > PASSWORD_MAX_BYTES) return { ok: false, message: PASSWORD_MESSAGES.tooLong };

  const folded = fold(password);
  const compact = folded.replace(/\s+/g, "");
  if (COMMON.has(folded) || COMMON.has(compact)) return { ok: false, message: PASSWORD_MESSAGES.common };
  if (new Set(compact).size < 4) return { ok: false, message: PASSWORD_MESSAGES.common };
  if (isRepetition(compact) || isSequence(compact)) return { ok: false, message: PASSWORD_MESSAGES.common };
  // letras dobradas: "11223344556677", "aabbccddee" (vira 1234567 / abcde)
  const collapsed = compact.replace(/(.)\1+/g, "$1");
  if (collapsed.length < 4 || isRepetition(collapsed) || isSequence(collapsed)) {
    return { ok: false, message: PASSWORD_MESSAGES.common };
  }

  // palavra óbvia (ou sequência) + números/símbolos em volta: "Senha@12345", "Coletivo2025!", "qwerty!!2024"
  const letters = lettersOnly(password);
  const rest = compact.replace(/[a-z]/g, "");
  const restDigits = rest.replace(/[^0-9]/g, "");
  const restTrivial =
    rest.length <= 2 || isSequence(rest) || isRepetition(rest) || isSequence(restDigits) || /^(19|20)\d\d$/.test(restDigits);
  const doubledWord = isRepetition(letters) && letters.length % 2 === 0 && OBVIOUS_WORDS.has(letters.slice(0, letters.length / 2));
  if (letters.length > 0 && (OBVIOUS_WORDS.has(letters) || doubledWord)) {
    return { ok: false, message: PASSWORD_MESSAGES.common };
  }
  if (letters.length > 0 && letters.length <= 3 && restTrivial) return { ok: false, message: PASSWORD_MESSAGES.common };
  if (letters.length >= 3 && (isSequence(letters) || isRepetition(letters)) && restTrivial) {
    return { ok: false, message: PASSWORD_MESSAGES.common };
  }

  for (const token of personalTokens(context)) {
    if (compact.includes(token)) return { ok: false, message: PASSWORD_MESSAGES.personal };
  }
  return { ok: true };
}
