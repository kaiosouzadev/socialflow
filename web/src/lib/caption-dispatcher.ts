/**
 * Despacho da geração de legendas em segundo plano da revisão do cronograma
 * (CalendarReviewModal). Não depende de React: o modal liga `getPosts`/`getStatus` aos seus
 * refs, e `send` faz a chamada a POST /api/ai/calendar/captions e aplica a resposta.
 *
 * - Fila = posts com status "pending" que ainda precisam de legenda (`needs`) e não estão no ar.
 *   Lotes de `batchSize`, no máximo `parallel` ao mesmo tempo.
 * - A fonte da verdade é SÍNCRONA: `send` aplica a resposta (e limpa o status) antes de
 *   resolver, e só depois o post sai de "no ar" e o próximo despacho roda. Assim, dois lotes
 *   que terminam no mesmo instante nunca reenviam posts já respondidos (gate F9, F3).
 * - Título/explicação/formato editados há menos de `idleMs` esperam a pessoa parar de digitar
 *   (`touch`), para não gerar a legenda de um título pela metade.
 * - Salvar (`settle`): para de despachar, espera os lotes no ar até `capMs` (o que chegar vai no
 *   commit) e cancela o resto ANTES do commit; o servidor completa os que faltarem (gate F9, F2).
 *   Se o commit falhar, `resume` volta a gerar de onde parou.
 */

export type DispatchStatus = "pending" | "failed";

export type CaptionDispatcherOptions<P extends { uid: string }> = {
  getPosts: () => readonly P[];
  getStatus: () => Readonly<Record<string, DispatchStatus | undefined>>;
  needs: (post: P) => boolean;
  /** envia um lote e aplica a resposta antes de resolver; `signal` cancela (salvar/fechar) */
  send: (batch: P[], signal: AbortSignal) => Promise<void>;
  batchSize: number;
  parallel: number;
  idleMs: number;
  now?: () => number;
};

export type CaptionDispatcher = {
  /** despacha o que estiver pronto para ir (chamar depois de qualquer mudança) */
  pump: () => void;
  /** o que a IA usa mudou agora (título/explicação/formato) */
  touch: (uid: string) => void;
  /** pode ir já, sem esperar digitação (ex.: nova ideia do Substituir) */
  untouch: (uid: string) => void;
  /** salvar: para de despachar, espera os lotes no ar (e `extra`) até `capMs` e cancela o resto */
  settle: (capMs: number, extra?: Promise<unknown>[]) => Promise<void>;
  /** o commit falhou: volta a despachar */
  resume: () => void;
  /** fechou/salvou: cancela tudo e não despacha mais */
  stop: () => void;
  /** lotes no ar agora */
  inFlight: () => number;
};

export function createCaptionDispatcher<P extends { uid: string }>(
  o: CaptionDispatcherOptions<P>
): CaptionDispatcher {
  const now = o.now ?? Date.now;
  let alive = true;
  let saving = false;
  let running = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const inflight = new Set<string>();
  const controllers = new Set<AbortController>();
  const tasks = new Set<Promise<void>>();
  const editedAt = new Map<string, number>();

  function start(batch: P[]) {
    const ctrl = new AbortController();
    controllers.add(ctrl);
    running++;
    for (const p of batch) inflight.add(p.uid);
    const task = (async () => {
      try {
        await o.send(batch, ctrl.signal);
      } catch {
        // `send` trata os próprios erros; aqui só garante a limpeza
      } finally {
        controllers.delete(ctrl);
        running--;
        for (const p of batch) inflight.delete(p.uid);
      }
    })();
    tasks.add(task);
    void task.then(() => {
      tasks.delete(task);
      pump();
    });
  }

  function pump() {
    if (!alive || saving) return;
    const t = now();
    const status = o.getStatus();
    let wait = 0;
    const waiting = o.getPosts().filter((p) => {
      if (status[p.uid] !== "pending" || inflight.has(p.uid) || !o.needs(p)) return false;
      const at = editedAt.get(p.uid);
      const idle = at === undefined ? Infinity : t - at;
      if (idle >= o.idleMs) return true;
      wait = wait ? Math.min(wait, o.idleMs - idle) : o.idleMs - idle;
      return false;
    });
    for (let i = 0; running < o.parallel && i < waiting.length; i += o.batchSize) {
      start(waiting.slice(i, i + o.batchSize));
    }
    if (wait > 0 && !retry) {
      retry = setTimeout(() => {
        retry = null;
        pump();
      }, wait);
    }
  }

  return {
    pump,
    touch: (uid) => {
      editedAt.set(uid, now());
    },
    untouch: (uid) => {
      editedAt.delete(uid);
    },
    settle: async (capMs, extra = []) => {
      saving = true;
      const pending = [...tasks, ...extra];
      if (pending.length > 0) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          Promise.allSettled(pending),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, capMs);
          }),
        ]);
        clearTimeout(timer);
      }
      for (const c of controllers) c.abort();
    },
    resume: () => {
      saving = false;
      pump();
    },
    stop: () => {
      alive = false;
      if (retry) clearTimeout(retry);
      retry = null;
      for (const c of controllers) c.abort();
    },
    inFlight: () => tasks.size,
  };
}
