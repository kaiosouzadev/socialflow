/**
 * Guarda "a agência agenda e publica?" no servidor (A4). Carrega o cliente e
 * aplica `publish-policy`: para cliente só produção (`agencyPublishes = false`)
 * nenhum post chega a scheduled, publishing ou published — a produção segue
 * normal, com os posts em draft.
 *
 * Usada em todos os caminhos que põem post na fila ou publicam: criação e
 * edição de post, reenvio, aprovação mensal, semanal e interna, e o publicador.
 */
import { prisma } from "@/lib/prisma";
import {
  PUBLISH_BLOCKED,
  PUBLISH_BLOCKED_LAST_ERROR,
  blocksStatus,
  isQueueStatus,
} from "@/lib/publish-policy";

/**
 * Filtro da relação `client` para os `updateMany` que põem posts na fila.
 * Vai junto com a checagem da flag, para fechar a corrida com uma troca de
 * "publica?" no meio da requisição.
 */
export const QUEUEABLE_CLIENT = { agencyPublishes: true } as const;

/** Lê a flag do cliente. `null` = cliente não existe. */
export async function loadClientPolicy(clientId: string): Promise<{ agencyPublishes: boolean } | null> {
  return prisma.client.findUnique({ where: { id: clientId }, select: { agencyPublishes: true } });
}

/** 409 padrão do bloqueio: `{ error, code: "CLIENT_NO_PUBLISH" }`. */
export function publishBlockedResponse(): Response {
  return Response.json({ error: PUBLISH_BLOCKED.message, code: PUBLISH_BLOCKED.code }, { status: 409 });
}

/**
 * Levar um post do cliente para `nextStatus` é permitido? Devolve o 409 pronto
 * ou `null` se pode seguir. Só consulta o banco quando `nextStatus` é de fila
 * (draft e failed passam direto). Cliente inexistente → `null`: quem chama
 * mantém o tratamento que já tinha (404 ou FK inválida).
 */
export async function guardQueueTransition(
  clientId: string,
  nextStatus: string | null | undefined
): Promise<Response | null> {
  if (!isQueueStatus(nextStatus)) return null;
  const client = await loadClientPolicy(clientId);
  if (!client) return null;
  return blocksStatus(client, nextStatus) ? publishBlockedResponse() : null;
}

/**
 * O publicador recusou um post de cliente só produção: o post volta para
 * draft — nunca failed, que o WF-03 não reagenda para esse cliente e ficaria
 * preso no contador "Falharam" (N-01) — com um `lastError` legível. Só mexe
 * se o post ainda estiver em publishing. Devolve o 409.
 */
export async function refusePublishing(postId: string): Promise<Response> {
  await prisma.post.updateMany({
    where: { id: postId, status: "publishing" },
    data: { status: "draft", lastError: PUBLISH_BLOCKED_LAST_ERROR },
  });
  return publishBlockedResponse();
}
