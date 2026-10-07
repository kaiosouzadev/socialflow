import { prisma } from "@/lib/prisma";

/*
 * Exclusão de cronogramas SEM posts (/aprovacoes → "Cronogramas sem posts").
 *
 * A FK posts.schedule_id é ON DELETE CASCADE: apagar um cronograma apaga os posts dele.
 * Por isso a regra "só com 0 posts" é conferida no servidor, dentro da transação, depois
 * de travar as linhas (FOR UPDATE): um post sendo gravado para o cronograma (a FK pega
 * FOR KEY SHARE na linha) termina antes da recontagem, e um post novo espera a exclusão
 * terminar (e falha pela FK, em vez de ser apagado em silêncio).
 *
 * Nada mais referencia o cronograma por FK: alerts.schedule_id é só texto de histórico,
 * pendências e revisões semanais apontam para posts. O link público (approvalToken) some
 * com a linha: /aprovar/<token> passa a mostrar a página "não encontrado".
 */

export type DeleteEmptyResult = {
  /** excluídos agora */
  deleted: string[];
  /** recusados: o cronograma tem posts */
  withPosts: string[];
  /** não existem (já excluídos por outra pessoa, ou id errado) */
  notFound: string[];
};

/** Máximo de cronogramas por pedido de limpeza em lote. */
export const MAX_CLEANUP_IDS = 200;

/** Mensagem do 409: o cronograma tem posts. */
export const SCHEDULE_HAS_POSTS = "Este cronograma tem posts. Exclua ou mova os posts antes.";

/**
 * Exclui, numa transação, os cronogramas da lista que continuam SEM posts. Os que têm
 * posts ficam (`withPosts`); ids inexistentes vão para `notFound`. Ids comparados sem
 * diferenciar maiúsculas (UUID do Postgres).
 */
export async function deleteEmptySchedules(ids: readonly string[]): Promise<DeleteEmptyResult> {
  const wanted = [...new Set(ids.map((id) => id.toLowerCase()))].sort();
  if (wanted.length === 0) return { deleted: [], withPosts: [], notFound: [] };

  return prisma.$transaction(
    async (tx) => {
      // ordem fixa (ORDER BY id): duas limpezas simultâneas não se travam em ciclo
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM schedules WHERE id = ANY(${wanted}::uuid[]) ORDER BY id FOR UPDATE`;
      const found = new Set(locked.map((r) => r.id.toLowerCase()));
      const existing = wanted.filter((id) => found.has(id));
      const notFound = wanted.filter((id) => !found.has(id));
      if (existing.length === 0) return { deleted: [], withPosts: [], notFound };

      const counts = await tx.post.groupBy({
        by: ["scheduleId"],
        where: { scheduleId: { in: existing } },
        _count: { _all: true },
      });
      const busy = new Set(
        counts.filter((c) => c.scheduleId && c._count._all > 0).map((c) => (c.scheduleId as string).toLowerCase())
      );
      const empty = existing.filter((id) => !busy.has(id));
      const withPosts = existing.filter((id) => busy.has(id));

      if (empty.length > 0) {
        // `posts: { none: {} }` repete a regra no próprio DELETE (defesa extra)
        await tx.schedule.deleteMany({ where: { id: { in: empty }, posts: { none: {} } } });
      }
      return { deleted: empty, withPosts, notFound };
    },
    { maxWait: 10_000, timeout: 20_000 }
  );
}
