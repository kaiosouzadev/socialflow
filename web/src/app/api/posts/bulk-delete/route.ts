import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/** Máximo de posts por pedido (a lista de /posts manda no máximo isso). */
const MAX_IDS = 500;

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Textos do 400 (N-14: `error` é sempre uma frase pt-BR, nunca o objeto do zod). */
const MSG = {
  shape: "Envie a lista de posts a excluir.",
  empty: "Selecione ao menos um post para excluir.",
  tooMany: `Dá para excluir no máximo ${MAX_IDS} posts por vez.`,
  invalidId: "A lista tem um post com identificador inválido.",
  duplicate: "A lista tem posts repetidos.",
} as const;
const KNOWN_MESSAGES = new Set<string>(Object.values(MSG));

const bodySchema = z.object(
  {
    ids: z
      .array(z.string({ error: MSG.invalidId }).regex(UUID_RE, MSG.invalidId), { error: MSG.shape })
      .min(1, MSG.empty)
      .max(MAX_IDS, MSG.tooMany)
      // UUID do Postgres não diferencia maiúsculas: "A…" e "a…" são o mesmo post
      .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, MSG.duplicate),
  },
  { error: MSG.shape }
);

/**
 * Exclui vários posts de uma vez (seleção da lista /posts).
 *
 * Corpo: `{ ids: uuid[] }` (1..500, sem repetidos). Apaga num só `deleteMany` os posts da lista,
 * EXCETO os que estão em "publishing" (o publicador está com eles agora; apagar no meio colidiria).
 * Resposta: `{ ok: true, deleted, skippedPublishing, notFound }`.
 *   - deleted: apagados;
 *   - skippedPublishing: ainda existem depois do deleteMany (estavam em publicação);
 *   - notFound: não existiam (já excluídos por outra pessoa, por exemplo).
 * As contagens saem do próprio deleteMany + uma contagem depois dele: um post que entre em
 * publicação no meio do caminho é contado como "em publicação", nunca como apagado.
 */
export async function POST(req: Request) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "";
    return Response.json({ error: KNOWN_MESSAGES.has(message) ? message : MSG.shape }, { status: 400 });
  }
  const ids = parsed.data.ids.map((id) => id.toLowerCase());

  try {
    const { count: deleted } = await prisma.post.deleteMany({
      where: { id: { in: ids }, status: { not: "publishing" } },
    });
    // o que sobrou da lista é o que estava em publicação
    const skippedPublishing = await prisma.post.count({ where: { id: { in: ids } } });
    const notFound = Math.max(0, ids.length - deleted - skippedPublishing);
    return Response.json({ ok: true, deleted, skippedPublishing, notFound });
  } catch (e) {
    // detalhe técnico só no log do servidor; a tela recebe uma frase pt-BR
    console.error("[posts/bulk-delete]", e);
    return Response.json({ error: "Não foi possível excluir os posts agora. Tente de novo." }, { status: 500 });
  }
}
