import { prisma } from "@/lib/prisma";

/**
 * Saúde da fila de publicação.
 *
 * Os limites espelham o WF-03 (retry no n8n), que destrava posts presos em
 * `publishing` há mais de 20 minutos e reprocessa `failed` com retry_count < 3.
 * Aqui o sistema só OBSERVA e mostra — quem mexe na fila continua sendo o n8n.
 */

/** Igual ao WF-03: publishing parado há mais de 20 min está travado. */
export const STUCK_MINUTES = 20;
/** Agendado que passou da hora e ninguém pegou — o WF-01 pode não estar rodando. */
export const OVERDUE_MINUTES = 15;
/** WF-03 desiste em retry_count >= 3; daí em diante é intervenção manual. */
export const MAX_RETRIES = 3;

export type QueueHealth = {
  stuck: number;
  overdue: number;
  exhausted: number;
  failed: number;
  lastPublishedAt: Date | null;
  healthy: boolean;
};

export async function getQueueHealth(): Promise<QueueHealth> {
  const now = Date.now();
  const stuckBefore = new Date(now - STUCK_MINUTES * 60_000);
  const overdueBefore = new Date(now - OVERDUE_MINUTES * 60_000);

  const [stuck, overdue, exhausted, failed, lastPub] = await Promise.all([
    prisma.post.count({
      where: { status: "publishing", scheduledAt: { lt: stuckBefore } },
    }),
    prisma.post.count({
      where: { status: "scheduled", scheduledAt: { lt: overdueBefore } },
    }),
    prisma.post.count({
      where: { status: "failed", retryCount: { gte: MAX_RETRIES } },
    }),
    prisma.post.count({ where: { status: "failed" } }),
    prisma.publication.findFirst({
      where: { status: "success", publishedAt: { not: null } },
      orderBy: { publishedAt: "desc" },
      select: { publishedAt: true },
    }),
  ]);

  return {
    stuck,
    overdue,
    exhausted,
    failed,
    lastPublishedAt: lastPub?.publishedAt ?? null,
    healthy: stuck === 0 && overdue === 0 && exhausted === 0,
  };
}
