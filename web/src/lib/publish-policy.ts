/**
 * Política "a agência agenda e publica?" (puro). Com `agencyPublishes = false`
 * o cliente é só produção: nenhum post dele chega a scheduled, publishing ou
 * published. A produção (cronograma, aprovações, ajustes, sync de artes)
 * continua normal, com os posts em draft.
 */

/** Status que significam "na fila" ou "publicado" — proibidos para cliente só produção. */
export const QUEUE_STATUSES = ["scheduled", "publishing", "published"] as const;

export type QueueStatus = (typeof QUEUE_STATUSES)[number];

/** Corpo do 409 devolvido quando uma ação tentaria pôr na fila um post de cliente só produção. */
export const PUBLISH_BLOCKED = {
  code: "CLIENT_NO_PUBLISH",
  message:
    "Este cliente não tem postagem pela agência: os posts ficam como rascunho e não entram na fila de publicação.",
} as const;

/** `lastError` gravado quando o publicador recusa um post de cliente só produção. */
export const PUBLISH_BLOCKED_LAST_ERROR = "Cliente sem postagem pela agência — não publicado";

/**
 * O cliente aceita posts na fila? Exige o campo carregado (boolean): sem ele,
 * o tipo não compila — e na dúvida a resposta é "não" (falha fechada).
 */
export function canEnterQueue(client: { agencyPublishes: boolean }): boolean {
  return client.agencyPublishes === true;
}

/** `status` é de fila/publicação (scheduled, publishing, published)? */
export function isQueueStatus(status: string | null | undefined): status is QueueStatus {
  return (QUEUE_STATUSES as readonly string[]).includes(status ?? "");
}

/** Levar um post deste cliente para `nextStatus` é proibido pela política? */
export function blocksStatus(client: { agencyPublishes: boolean }, nextStatus: string | null | undefined): boolean {
  return isQueueStatus(nextStatus) && !canEnterQueue(client);
}
