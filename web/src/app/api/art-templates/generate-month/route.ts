import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { requireAuth } from "@/lib/api-auth";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { generateText, CALENDAR_MODEL } from "@/lib/gemini";
import { genTemplateCaptions } from "@/lib/basic-plan";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const limited = enforceRateLimit(`tpl-gen-month:${clientIp(req)}`, 10, 5 * 60_000);
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
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
    const raw = await generateText({ model: CALENDAR_MODEL, system, prompt, temperature: 0.95, json: true });
    const data = JSON.parse(raw);
    titles = Array.isArray(data) ? data : data.titles;
    if (!Array.isArray(titles) || titles.length === 0) throw new Error("formato inesperado");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao gerar títulos";
    return Response.json({ error: `IA: ${msg}` }, { status: 502 });
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
