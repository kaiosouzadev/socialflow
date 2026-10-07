import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { deleteEmptySchedules, MAX_CLEANUP_IDS } from "@/lib/schedule-delete";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Textos do 400 (N-14: `error` é sempre uma frase pt-BR, nunca o objeto do zod). */
const MSG = {
  shape: "Envie a lista de cronogramas a excluir.",
  empty: "Selecione ao menos um cronograma para excluir.",
  tooMany: `Dá para excluir no máximo ${MAX_CLEANUP_IDS} cronogramas por vez.`,
  invalidId: "A lista tem um cronograma com identificador inválido.",
  duplicate: "A lista tem cronogramas repetidos.",
} as const;
const KNOWN_MESSAGES = new Set<string>(Object.values(MSG));

const bodySchema = z.object(
  {
    ids: z
      .array(z.string({ error: MSG.invalidId }).regex(UUID_RE, MSG.invalidId), { error: MSG.shape })
      .min(1, MSG.empty)
      .max(MAX_CLEANUP_IDS, MSG.tooMany)
      .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, MSG.duplicate),
  },
  { error: MSG.shape }
);

/**
 * Exclusão em lote dos cronogramas SEM posts ("Excluir todos os vazios" em /aprovacoes).
 *
 * Corpo: `{ ids: uuid[] }` — a lista explícita que a tela mostrou (nunca "todos os vazios do
 * banco"). Numa transação, revalida "0 posts" de cada um no servidor e exclui só esses.
 * Resposta: `{ ok: true, deleted, deletedIds, withPosts, notFound }`:
 *   - withPosts: ids que ganharam posts depois que a tela carregou (ficam);
 *   - notFound: ids que já não existiam (excluídos por outra pessoa, por exemplo).
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

  try {
    const r = await deleteEmptySchedules(parsed.data.ids);
    return Response.json({
      ok: true,
      deleted: r.deleted.length,
      deletedIds: r.deleted,
      withPosts: r.withPosts,
      notFound: r.notFound,
    });
  } catch (e) {
    console.error("[schedules/cleanup-empty]", e);
    return Response.json(
      { error: "Não foi possível excluir os cronogramas agora. Tente de novo em instantes." },
      { status: 500 }
    );
  }
}
