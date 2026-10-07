import { requireAuth } from "@/lib/api-auth";
import { deleteEmptySchedules, SCHEDULE_HAS_POSTS } from "@/lib/schedule-delete";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const NOT_FOUND = "Cronograma não encontrado";

/**
 * Exclui um cronograma SEM posts (/aprovacoes → "Cronogramas sem posts"). Mesma
 * autorização das outras ações de cronograma (sessão da equipe).
 *   - 200 { ok: true, deleted: 1 }
 *   - 404 cronograma inexistente (ou id inválido)
 *   - 409 o cronograma tem posts (a FK apagaria os posts junto: nunca por aqui)
 * O link público do cronograma excluído passa a mostrar a página "não encontrado".
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  if (!UUID_RE.test(id)) return Response.json({ error: NOT_FOUND }, { status: 404 });

  try {
    const r = await deleteEmptySchedules([id]);
    if (r.withPosts.length > 0) return Response.json({ error: SCHEDULE_HAS_POSTS }, { status: 409 });
    if (r.deleted.length === 0) return Response.json({ error: NOT_FOUND }, { status: 404 });
    return Response.json({ ok: true, deleted: 1 });
  } catch (e) {
    // detalhe do banco só no log do servidor; a tela recebe uma frase pt-BR (N-14)
    console.error("[schedules/delete]", id, e);
    return Response.json(
      { error: "Não foi possível excluir o cronograma agora. Tente de novo em instantes." },
      { status: 500 }
    );
  }
}
