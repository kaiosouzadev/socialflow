import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { audit } from "@/lib/audit";
import { ADMIN_ONLY, isAdmin, sessionActor } from "@/lib/permissions";

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

/** 403 da staff com publicados na seleção: diz quantos e o que fazer (N-14). */
function publishedDeniedMessage(n: number): string {
  return `${ADMIN_ONLY.deletePublished} Tire da seleção ${n === 1 ? "o post publicado" : `os ${n} posts publicados`} e tente de novo.`;
}

/**
 * Exclui vários posts de uma vez (seleção da lista /posts).
 *
 * Corpo: `{ ids: uuid[] }` (1..500, sem repetidos). Apaga num só `deleteMany` os posts da lista,
 * EXCETO os que estão em "publishing" (o publicador está com eles agora; apagar no meio colidiria).
 * Papel (decisão "Só admin + registro", AC-07): posts PUBLICADOS só a admin exclui. Staff com
 * publicado na seleção → 403 e nada é apagado; o `deleteMany` da staff também filtra "published"
 * (um post que for publicado entre a conferência e a exclusão fica, contado em `skippedPublished`).
 * Resposta: `{ ok: true, deleted, skippedPublishing, notFound }` (+ `skippedPublished` se > 0).
 *   - deleted: apagados;
 *   - skippedPublishing: ainda existem depois do deleteMany (estavam em publicação);
 *   - notFound: não existiam (já excluídos por outra pessoa, por exemplo).
 * Registro `posts.bulk_delete` com as contagens por status (nunca o conteúdo dos posts).
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
  const actor = await sessionActor();
  const admin = isAdmin(actor);

  try {
    // status de cada post antes (papel + contagens do registro)
    const before = await prisma.post.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, clientId: true },
    });
    const publishedSelected = before.filter((p) => p.status === "published").length;
    if (!admin && publishedSelected > 0) {
      return Response.json(
        { error: publishedDeniedMessage(publishedSelected), published: publishedSelected },
        { status: 403 }
      );
    }

    const keep = admin ? ["publishing"] : ["publishing", "published"];
    const { count: deleted } = await prisma.post.deleteMany({
      where: { id: { in: ids }, status: { notIn: keep } },
    });
    // o que sobrou da lista: em publicação (ou publicado no meio do caminho, para a staff)
    const remaining = await prisma.post.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } });
    const skippedPublished = remaining.filter((p) => p.status === "published").length;
    const skippedPublishing = remaining.length - skippedPublished;
    const notFound = Math.max(0, ids.length - deleted - remaining.length);

    if (deleted > 0) {
      const left = new Set(remaining.map((p) => p.id.toLowerCase()));
      const gone = before.filter((p) => !left.has(p.id.toLowerCase()));
      const byStatus: Record<string, number> = {};
      for (const p of gone) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
      const clients = [...new Set(gone.map((p) => p.clientId))];
      await audit(
        {
          action: "posts.bulk_delete",
          targetType: "posts",
          clientId: clients.length === 1 ? clients[0] : null,
          meta: { requested: ids.length, deleted, byStatus, skippedPublishing, notFound, clients: clients.length },
        },
        { req, ...(actor ? { actor: { id: actor.id, email: actor.email } } : {}) }
      );
    }
    return Response.json({ ok: true, deleted, skippedPublishing, notFound, ...(skippedPublished > 0 ? { skippedPublished } : {}) });
  } catch (e) {
    // detalhe técnico só no log do servidor; a tela recebe uma frase pt-BR
    console.error("[posts/bulk-delete]", e);
    return Response.json({ error: "Não foi possível excluir os posts agora. Tente de novo." }, { status: 500 });
  }
}
