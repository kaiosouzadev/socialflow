import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  PUBLISH_BLOCKED,
  PUBLISH_BLOCKED_LAST_ERROR,
  QUEUE_STATUSES,
  blocksStatus,
  canEnterQueue,
  isQueueStatus,
} from "../../src/lib/publish-policy.ts";

describe("publish-policy", () => {
  test("canEnterQueue segue agencyPublishes", () => {
    assert.equal(canEnterQueue({ agencyPublishes: true }), true);
    assert.equal(canEnterQueue({ agencyPublishes: false }), false);
  });

  test("falha fechada se o campo vier sem valor (dado não carregado)", () => {
    assert.equal(canEnterQueue({ agencyPublishes: undefined as unknown as boolean }), false);
  });

  test("PUBLISH_BLOCKED: código estável e mensagem em pt-BR", () => {
    assert.equal(PUBLISH_BLOCKED.code, "CLIENT_NO_PUBLISH");
    assert.match(PUBLISH_BLOCKED.message, /agência/);
    assert.match(PUBLISH_BLOCKED_LAST_ERROR, /não publicado/);
  });

  test("status de fila", () => {
    assert.deepEqual([...QUEUE_STATUSES], ["scheduled", "publishing", "published"]);
    assert.equal(isQueueStatus("scheduled"), true);
    assert.equal(isQueueStatus("draft"), false);
    assert.equal(isQueueStatus("failed"), false);
    assert.equal(isQueueStatus(undefined), false);
  });

  test("blocksStatus: só bloqueia status de fila para cliente só produção", () => {
    const noPublish = { agencyPublishes: false };
    const publishes = { agencyPublishes: true };
    assert.equal(blocksStatus(noPublish, "scheduled"), true);
    assert.equal(blocksStatus(noPublish, "publishing"), true);
    assert.equal(blocksStatus(noPublish, "draft"), false);
    assert.equal(blocksStatus(noPublish, "failed"), false);
    assert.equal(blocksStatus(publishes, "scheduled"), false);
  });
});
