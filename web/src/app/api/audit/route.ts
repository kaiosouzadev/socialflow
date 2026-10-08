import { requireAdmin } from "@/lib/api-auth";
import { listAuditEvents, parseAuditFilters } from "@/lib/audit-query";
import { NO_STORE } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * Registro de ações (trilha de auditoria). Só administradores.
 * GET ?acao=<area.acao>&pessoa=<users.id>&cliente=<clients.id>&de=YYYY-MM-DD&ate=YYYY-MM-DD&pagina=N&limite=1..200
 * → 200 `{ items, total, page, pageSize, totalPages }` (mais recentes primeiro; padrão: as últimas 200).
 * Filtro inválido → 400 `{ error: "<pt-BR>", field }`. Sem cache (dados de segurança).
 */
export async function GET(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const url = new URL(req.url);
  const { filters, invalid } = parseAuditFilters(Object.fromEntries(url.searchParams));
  if (invalid.length > 0) {
    return Response.json(
      { error: "Filtro inválido: confira a ação, a pessoa, o cliente, as datas (AAAA-MM-DD) e a página.", field: invalid[0] },
      { status: 400, headers: NO_STORE }
    );
  }
  try {
    return Response.json(await listAuditEvents(filters), { headers: NO_STORE });
  } catch (e) {
    console.error("[audit] falha ao listar", (e as { code?: unknown } | null)?.code ?? "erro");
    return Response.json(
      { error: "Não foi possível carregar o registro de ações agora. Tente de novo." },
      { status: 500, headers: NO_STORE }
    );
  }
}
