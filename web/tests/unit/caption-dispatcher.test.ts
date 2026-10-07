/**
 * Gate F9 (F2/F3): despacho das legendas em segundo plano da revisão do cronograma
 * (lib/caption-dispatcher.ts, usado pelo CalendarReviewModal), contando as chamadas à IA falsa.
 *   - lotes de 4, até 3 no ar; cada post vai à IA UMA vez;
 *   - F3: lotes que terminam no MESMO instante não reenviam posts já respondidos;
 *   - F2: salvar no meio não despacha lote novo, espera (com teto) os que estão no ar — o que
 *     chega entra no commit — e cancela o resto (o `signal` chega cancelado à IA) ANTES do commit;
 *     gerações concluídas no modal + as do servidor (after) = nº de posts;
 *   - commit falhou → volta a gerar; fechar → cancela e para; edição de título espera digitar.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createCaptionDispatcher } from "../../src/lib/caption-dispatcher.ts";

type P = { uid: string };
type Gate = { uids: string[]; signal: AbortSignal; resolve: () => void };

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** n posts "pending"; a IA falsa só responde quando o teste abre a porteira do lote. */
function setup(n: number, { idleMs = 0 } = {}) {
  const posts: P[] = Array.from({ length: n }, (_, i) => ({ uid: `p${String(i + 1).padStart(2, "0")}` }));
  const status: Record<string, "pending" | "failed" | undefined> = Object.fromEntries(posts.map((p) => [p.uid, "pending"]));
  const done = new Set<string>();
  const calls: string[][] = [];
  const gates: Gate[] = [];
  const d = createCaptionDispatcher<P>({
    getPosts: () => posts,
    getStatus: () => status,
    needs: (p) => !done.has(p.uid),
    // como o modal: aplica a resposta (legenda + status) ANTES de resolver; cancelado não aplica
    send: (batch, signal) =>
      new Promise<void>((resolve) => {
        const uids = batch.map((p) => p.uid);
        calls.push(uids);
        signal.addEventListener("abort", () => resolve());
        gates.push({
          uids,
          signal,
          resolve: () => {
            if (!signal.aborted) {
              for (const uid of uids) {
                done.add(uid);
                delete status[uid];
              }
            }
            resolve();
          },
        });
      }),
    batchSize: 4,
    parallel: 3,
    idleMs,
  });
  return { posts, status, done, calls, gates, d };
}

const flat = (calls: string[][]) => calls.flat();
const unique = (xs: string[]) => new Set(xs).size === xs.length;

describe("caption-dispatcher — lotes e contagem", () => {
  test("14 posts: 3 lotes de 4 no ar, depois o de 2; cada post vai à IA uma vez", async () => {
    const { calls, gates, d } = setup(14);
    d.pump();
    assert.deepEqual(calls.map((c) => c.length), [4, 4, 4]);
    d.pump(); // chamar de novo não duplica nada no ar
    assert.equal(calls.length, 3);
    gates[0].resolve();
    await tick();
    assert.deepEqual(calls.map((c) => c.length), [4, 4, 4, 2]);
    for (const g of gates.slice(1)) g.resolve();
    await tick();
    assert.equal(calls.length, 4);
    assert.equal(flat(calls).length, 14);
    assert.ok(unique(flat(calls)));
  });

  test("post 'failed' ou que não precisa mais de legenda não vai", () => {
    const { status, done, calls, d } = setup(3);
    status.p01 = "failed";
    done.add("p02");
    d.pump();
    assert.deepEqual(calls, [["p03"]]);
  });
});

describe("caption-dispatcher — F3: lotes que terminam no mesmo instante", () => {
  test("12 posts, 3 lotes resolvidos no mesmo tique (com despachos no meio) → 3 chamadas, nenhum post reenviado", async () => {
    const { calls, gates, d } = setup(12);
    d.pump();
    assert.equal(calls.length, 3);
    for (const g of gates) g.resolve();
    d.pump(); // despacho no meio da conclusão (como o timer antigo do modal)
    await Promise.resolve();
    d.pump();
    await tick();
    d.pump();
    await tick(5);
    assert.equal(calls.length, 3, JSON.stringify(calls));
    assert.ok(unique(flat(calls)));
  });
});

describe("caption-dispatcher — F2: salvar no meio da geração", () => {
  test("não despacha lote novo, espera os lotes no ar (o que chega entra) e cancela o resto ANTES do commit", async () => {
    const { calls, gates, done, d } = setup(14);
    d.pump();
    assert.equal(calls.length, 3);
    const settling = d.settle(80);
    gates[0].resolve();
    gates[1].resolve();
    await tick(5);
    assert.equal(calls.length, 3, "nenhum lote novo durante o salvar");
    await settling; // lote 3 não chegou: teto de 80 ms
    assert.equal(gates[2].signal.aborted, true, "o lote que não chegou foi cancelado (também na IA)");
    assert.equal(gates[0].signal.aborted, false);
    assert.equal(done.size, 8, "as 8 legendas que chegaram vão no commit");
    d.pump();
    await tick();
    assert.equal(calls.length, 3, "salvando: nada é despachado");
    // concluídas no modal: só os 2 lotes que chegaram, uma vez cada
    assert.ok(unique(flat(calls)));
    assert.deepEqual([...done].sort(), flat(calls).slice(0, 8).sort());
    // o servidor (after) completa os 6 que foram sem legenda: 8 + 6 = 14 gerações para 14 posts
    assert.equal(14 - done.size, 6);
  });

  test("todos os lotes chegam antes do teto: settle termina logo e nada fica para o servidor além dos não despachados", async () => {
    const { calls, gates, done, d } = setup(12);
    d.pump();
    const t0 = Date.now();
    const settling = d.settle(5000);
    for (const g of gates) g.resolve();
    await settling;
    assert.ok(Date.now() - t0 < 1000, "não esperou o teto");
    assert.equal(done.size, 12);
    assert.equal(calls.length, 3);
    assert.ok(gates.every((g) => !g.signal.aborted));
  });

  test("commit falhou → resume: volta a gerar de onde parou (o lote cancelado vai de novo, uma vez)", async () => {
    const { calls, gates, done, d } = setup(14);
    d.pump();
    const settling = d.settle(30);
    gates[0].resolve();
    gates[1].resolve();
    await settling;
    d.resume();
    assert.deepEqual(calls.slice(3), [["p09", "p10", "p11", "p12"], ["p13", "p14"]]);
    for (const g of gates.slice(3)) g.resolve();
    await tick();
    assert.equal(done.size, 14);
    assert.equal(calls.length, 5);
  });
});

describe("caption-dispatcher — fechar e digitar", () => {
  test("stop (fechar/salvar): cancela os lotes no ar e não despacha mais", async () => {
    const { calls, gates, d } = setup(14);
    d.pump();
    d.stop();
    assert.ok(gates.every((g) => g.signal.aborted));
    await tick();
    d.pump();
    await tick();
    assert.equal(calls.length, 3);
  });

  test("título editado agora: espera a pessoa parar de digitar (idleMs) e então vai uma vez", async () => {
    const { calls, d } = setup(1, { idleMs: 40 });
    d.touch("p01");
    d.pump();
    d.pump();
    assert.equal(calls.length, 0);
    await tick(70);
    assert.deepEqual(calls, [["p01"]]);
    d.untouch("p01");
  });
});
