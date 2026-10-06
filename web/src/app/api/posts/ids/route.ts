import { requireAuth } from "@/lib/api-auth";
import { BULK_LIMIT, buildListQuery, countList, fetchFilterItems, parseListParams } from "@/app/(app)/posts/list-query";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * "Selecionar todos os M deste filtro" da lista /posts (U-37): os ids e status dos posts do
 * filtro, na ordem da lista, no máximo 500 — buscados só quando a pessoa pede, não a cada carga.
 *
 * Query string: a mesma da lista (clientId, status, q, range, ref, scheduleId, noted).
 * Resposta: `{ items: { id, status }[], total }` (total pode passar de 500).
 */
export async function GET(req: Request) {
  const denied = await requireAuth();
  if (denied) return denied;

  const sp = Object.fromEntries(new URL(req.url).searchParams);
  if ((sp.clientId && !UUID_RE.test(sp.clientId)) || (sp.scheduleId && !UUID_RE.test(sp.scheduleId))) {
    return Response.json({ error: "Filtro inválido. Recarregue a página e tente de novo." }, { status: 400 });
  }

  try {
    const query = buildListQuery(parseListParams(sp));
    const [counts, items] = await Promise.all([countList(query), fetchFilterItems(query, BULK_LIMIT)]);
    return Response.json({ items, total: counts.pinned + counts.main });
  } catch (e) {
    console.error("[GET /api/posts/ids]", e);
    return Response.json({ error: "Não foi possível carregar os posts deste filtro. Tente de novo." }, { status: 500 });
  }
}
