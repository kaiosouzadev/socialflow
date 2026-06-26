import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { generateText, CAPTION_MODEL } from "@/lib/gemini";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { MAX_AI_EDITS } from "@/lib/approval";
import { z } from "zod";

export const dynamic = "force-dynamic";

const OPEN = ["enviado_cliente", "em_revisao"];

const schema = z.object({
  action: z.enum(["edit", "regenerate"]),
  captions: z
    .object({
      instagram: z.string().optional(),
      facebook: z.string().optional(),
      linkedin: z.string().optional(),
    })
    .optional(),
  notes: z.string().max(500).optional(),
});

const GUIDE: Record<string, string> = {
  instagram: "Instagram: envolvente, 3-6 hashtags, emojis moderados.",
  facebook: "Facebook: explicativo, call-to-action, poucos hashtags.",
  linkedin: "LinkedIn: profissional, foco em valor, sem excesso de emojis.",
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; postId: string }> }
) {
  const limited = enforceRateLimit(`aprovar-post:${clientIp(req)}`, 60, 60_000);
  if (limited) return limited;

  const { token, postId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const schedule = await prisma.schedule.findUnique({
    where: { approvalToken: token },
    select: { id: true, status: true, client: { select: { name: true, toneOfVoice: true } } },
  });
  if (!schedule) return Response.json({ error: "Link inválido" }, { status: 404 });
  if (!OPEN.includes(schedule.status)) {
    return Response.json({ error: "Cronograma não está aberto para edição" }, { status: 409 });
  }

  const post = await prisma.post.findFirst({
    where: { id: postId, scheduleId: schedule.id },
  });
  if (!post) return Response.json({ error: "Post não encontrado" }, { status: 404 });

  // marca em revisão na primeira mexida
  const markReview = schedule.status === "enviado_cliente"
    ? prisma.schedule.update({ where: { id: schedule.id }, data: { status: "em_revisao" } })
    : null;

  if (parsed.data.action === "edit") {
    const cur = (post.captions as Record<string, string> | null) ?? {};
    const merged = { ...cur, ...(parsed.data.captions ?? {}) };
    await prisma.$transaction([
      prisma.post.update({ where: { id: postId }, data: { captions: merged as Prisma.InputJsonValue } }),
      ...(markReview ? [markReview] : []),
    ]);
    return Response.json({ ok: true, captions: merged, aiEditsUsed: post.aiEditsUsed });
  }

  // regenerate (IA) — limite por post
  if (post.aiEditsUsed >= MAX_AI_EDITS) {
    return Response.json({ error: `Limite de ${MAX_AI_EDITS} edições por IA atingido neste post` }, { status: 429 });
  }
  const regenLimited = enforceRateLimit(`approve-regen:${clientIp(req)}`, 20, 60_000);
  if (regenLimited) return regenLimited;

  const targets = post.targets;
  const guide = targets.map((t) => `- ${GUIDE[t]}`).join("\n");
  const system =
    "Você é redator de social media (pt-BR). Reescreva a legenda mantendo o tema, " +
    "variando a abordagem. Responda SOMENTE JSON.";
  const prompt = [
    `Cliente: ${schedule.client.name}.`,
    schedule.client.toneOfVoice ? `Tom: ${schedule.client.toneOfVoice}.` : "",
    post.theme ? `Tema: ${post.theme}.` : "",
    parsed.data.notes ? `Pedido do cliente: ${parsed.data.notes}.` : "",
    "Reescreva uma legenda por rede:",
    guide,
    `JSON: {${targets.map((t) => `"${t}":"<legenda>"`).join(",")}}`,
  ].filter(Boolean).join("\n");

  let captions: Record<string, string>;
  try {
    const raw = await generateText({ model: CAPTION_MODEL, system, prompt, temperature: 0.95, json: true });
    const data = JSON.parse(raw);
    captions = {};
    for (const t of targets) if (typeof data?.[t] === "string" && data[t].trim()) captions[t] = data[t].trim();
    if (Object.keys(captions).length === 0) throw new Error("sem conteúdo");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro IA";
    return Response.json({ error: `IA: ${msg}` }, { status: 502 });
  }

  const cur = (post.captions as Record<string, string> | null) ?? {};
  const merged = { ...cur, ...captions };
  const updated = await prisma.post.update({
    where: { id: postId },
    data: { captions: merged as Prisma.InputJsonValue, aiEditsUsed: { increment: 1 } },
    select: { aiEditsUsed: true },
  });
  if (markReview) await markReview;

  return Response.json({ ok: true, captions: merged, aiEditsUsed: updated.aiEditsUsed });
}
