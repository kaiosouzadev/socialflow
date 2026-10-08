import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { requireAuthUser } from "@/lib/api-auth";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { enforceAiQuota } from "@/lib/ai-quota";
import { readJsonLimited } from "@/lib/read-json";
import { mediaUrlProblem } from "@/lib/media-url";
import { generateAiText } from "@/lib/ai-text";
import { genTemplateCaptions } from "@/lib/basic-plan";
import { toUserMessage } from "@/lib/user-facing-error";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const FALLBACK = "Não foi possível gerar os títulos do mês agora. Tente de novo em instantes.";

const schema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  // arte-base do mês (mesma estrutura para todos os títulos)
  baseImageUrl: z.string().url(),
  time: z.string().regex(/^\d{2}:\d{2}$/).default("18:00"),
  count: z.number().int().min(1).max(31).default(12),
});

/** Dias seg/qua/sex do mês; mês corrente começa em amanhã (nunca no passado). */
function pickDays(year: number, month: number, count: number): number[] {
  const targetWeekdays = [1, 3, 5];
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const spNow = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [curY, curM, curD] = spNow.split("-").map(Number);
  const firstDay = year === curY && month === curM ? curD + 1 : 1;

  const days: number[] = [];
  for (let d = firstDay; d <= lastDay; d++) {
    const wd = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    if (targetWeekdays.includes(wd)) days.push(d);
  }
  return days.slice(0, count);
}

/**
 * Gera o calendário de artes básicas do mês via IA — mesmo fluxo do calendário
 * dos clientes completos: títulos variados + legendas padronizadas, todos
 * usando a arte-base do mês. Cria os ArtTemplates prontos para agendar.
 */
/** Teto do corpo (mês, URL da arte-base, horário, quantidade). */
const MAX_BODY_BYTES = 16 * 1024;

export async function POST(req: NextRequest) {
  const { user, denied } = await requireAuthUser();
  if (denied) return denied;

  const limited = enforceRateLimit(`tpl-gen-month:${clientIp(req)}`, 10, 5 * 60_000);
  if (limited) return limited;

  const read = await readJsonLimited(req, MAX_BODY_BYTES);
  if (!read.ok) return read.response;
  // OWASP AUD2-04 (lib/media-url): a arte-base só pode vir do R2 público (a tela sempre sobe o arquivo)
  const rawBase = (read.value as { baseImageUrl?: unknown } | null)?.baseImageUrl;
  const baseProblem = typeof rawBase === "string" ? mediaUrlProblem(rawBase, { r2Only: true }) : null;
  if (baseProblem) return Response.json({ error: baseProblem, field: "baseImageUrl" }, { status: 400 });
  const parsed = schema.safeParse(read.value);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { month, baseImageUrl, time, count } = parsed.data;
  const [year, mon] = month.split("-").map(Number);

  const days = pickDays(year, mon, count);
  if (days.length === 0) {
    return Response.json(
      { error: "Este mês não tem mais datas futuras disponíveis." },
      { status: 400 }
    );
  }
  const n = Math.min(count, days.length);

  // teto de gerações por IA (CF-12): 1 chamada para os títulos + 1 de legendas por título
  const quota = enforceAiQuota(user.id, 1 + n, "artes-base-mes");
  if (quota) return quota;

  const monthName = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(Date.UTC(year, mon - 1, 15)));

  // títulos genéricos (servem para qualquer cliente do plano básico)
  const system =
    "Você é estrategista de conteúdo de uma agência brasileira. Cria calendários editoriais " +
    "GENÉRICOS (sem citar nome de empresa), reutilizáveis por vários clientes pequenos. " +
    "Responda SOMENTE JSON válido.";
  const prompt = [
    `Mês de referência: ${monthName}.`,
    `Gere EXATAMENTE ${n} títulos curtos de postagem para o mês, variados `,
    "(datas comemorativas do mês, dicas, engajamento, motivacional, institucional genérico). ",
    "Evite repetir temas. ",
    `JSON: {"titles":["<título 1>", ...]} com ${n} itens.`,
  ].join("");

  let titles: string[];
  try {
    const raw = await generateAiText("calendar", { label: "artes-base-titulos", system, prompt, temperature: 0.95, json: true });
    const data = JSON.parse(raw);
    titles = Array.isArray(data) ? data : data.titles;
    // texto que cai na regra "Gemini não retornou" do toUserMessage
    if (!Array.isArray(titles) || titles.length === 0) throw new Error("Gemini não retornou a lista de títulos");
  } catch (e) {
    console.error("[art-templates/generate-month]", e);
    return Response.json({ error: toUserMessage(e, FALLBACK) }, { status: 502 });
  }

  // legendas padronizadas por título + cria os templates
  const created: { name: string; day: number }[] = [];
  for (let i = 0; i < Math.min(n, titles.length); i++) {
    const name = String(titles[i]).slice(0, 200);
    const captions = await genTemplateCaptions(name);
    await prisma.artTemplate.create({
      data: {
        name,
        month,
        day: days[i],
        time,
        baseImageUrl,
        captions: captions.shared ? (captions as Prisma.InputJsonValue) : undefined,
      },
    });
    created.push({ name, day: days[i] });
  }

  return Response.json({ month, created: created.length, items: created }, { status: 201 });
}
