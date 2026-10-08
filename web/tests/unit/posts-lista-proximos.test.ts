/**
 * QW-3 (U-19, U-37): lista /posts em "Próximos" e "todos deste filtro" sob demanda.
 *   - sem `range` na URL o período é "Próximos"; o atalho de Aprovações (scheduleId/noted) abre em "Todas";
 *   - "Próximos" = grupo fixo no topo (falharam em qualquer data + agendados/em publicação que passaram
 *     da hora, só de cliente que publica) e depois de hoje (00:00 SP) em diante, em ordem crescente;
 *     rascunho/publicado de dias passados fica fora; nada aparece duas vezes;
 *   - a paginação com o grupo fixo (planPage) e a seleção "todos deste filtro" (fetchFilterItems)
 *     dão a MESMA ordem: páginas 1..n concatenadas = itens do filtro;
 *   - GET /api/posts/ids: 401 sem sessão, 400 pt-BR com filtro inválido, { items, total } na ordem da lista.
 *
 * Técnica do posts-bulk-delete.test.ts: hooks de módulo resolvem "@/" para os fontes e trocam Prisma
 * e a sessão por versões falsas em memória. O Prisma falso INTERPRETA o `where` (AND/OR/NOT, igualdade,
 * in, lt/gte, not null, relação client.is, contains) e o `orderBy` — a semântica é testada, não a forma.
 */
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CLIENT_PUB = uid(9001);
const CLIENT_PROD = uid(9002);

// ------------------------------------------------------------ banco e sessão falsos

type Row = {
  id: string;
  clientId: string;
  status: string;
  scheduledAt: Date;
  theme: string | null;
  scheduleId: string | null;
  clientNote: string | null;
};
type Client = { id: string; name: string; agencyPublishes: boolean };
type Session = { user: { id?: string; role?: string } } | null;

const state = {
  session: { user: { id: "00000000-0000-4000-8000-0000000000a5", role: "staff" } } as Session,
  posts: [] as Row[],
  clients: [
    { id: CLIENT_PUB, name: "ZZ QA Publica", agencyPublishes: true },
    { id: CLIENT_PROD, name: "ZZ QA Producao", agencyPublishes: false },
  ] as Client[],
};

type W = Record<string, unknown>;

function cmp(value: unknown, cond: unknown): boolean {
  if (cond === null || typeof cond !== "object" || cond instanceof Date) {
    return cond instanceof Date ? (value as Date).getTime() === cond.getTime() : value === cond;
  }
  const c = cond as Record<string, unknown>;
  for (const [op, arg] of Object.entries(c)) {
    if (op === "in") {
      if (!(arg as unknown[]).includes(value)) return false;
    } else if (op === "not") {
      if (arg === null ? value === null : value === arg) return false;
    } else if (op === "lt") {
      if (!((value as Date).getTime() < (arg as Date).getTime())) return false;
    } else if (op === "gte") {
      if (!((value as Date).getTime() >= (arg as Date).getTime())) return false;
    } else if (op === "contains") {
      const insensitive = c.mode === "insensitive";
      const v = String(value ?? "");
      if (!(insensitive ? v.toLowerCase().includes(String(arg).toLowerCase()) : v.includes(String(arg)))) return false;
    } else if (op === "mode") {
      // usado com contains
    } else {
      assert.fail(`operador inesperado no where: ${op}`);
    }
  }
  return true;
}

function matches(row: Row, where: W): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === "AND") {
      if (!(v as W[]).every((w) => matches(row, w))) return false;
    } else if (k === "OR") {
      if (!(v as W[]).some((w) => matches(row, w))) return false;
    } else if (k === "NOT") {
      if (matches(row, v as W)) return false;
    } else if (k === "client") {
      const is = (v as { is: Record<string, unknown> }).is;
      const client = state.clients.find((c) => c.id === row.clientId)!;
      for (const [ck, cv] of Object.entries(is)) {
        if (!cmp((client as Record<string, unknown>)[ck], cv)) return false;
      }
    } else if (k in row) {
      if (!cmp((row as Record<string, unknown>)[k], v)) return false;
    } else {
      assert.fail(`chave inesperada no where: ${k}`);
    }
  }
  return true;
}

type OrderBy = Record<string, "asc" | "desc">[];
function sorted(rows: Row[], orderBy: OrderBy): Row[] {
  return [...rows].sort((a, b) => {
    for (const o of orderBy) {
      const [k, dir] = Object.entries(o)[0];
      const av = (a as Record<string, unknown>)[k];
      const bv = (b as Record<string, unknown>)[k];
      const x = av instanceof Date ? av.getTime() : String(av);
      const y = bv instanceof Date ? bv.getTime() : String(bv);
      if (x < y) return dir === "asc" ? -1 : 1;
      if (x > y) return dir === "asc" ? 1 : -1;
    }
    return 0;
  });
}

type FindArgs = { where: W; orderBy: OrderBy; skip?: number; take?: number; select?: Record<string, boolean> };
const fakePrisma = {
  post: {
    count: async ({ where }: { where: W }) => state.posts.filter((p) => matches(p, where)).length,
    findMany: async ({ where, orderBy, skip = 0, take, select }: FindArgs) => {
      const rows = sorted(state.posts.filter((p) => matches(p, where)), orderBy).slice(skip, take === undefined ? undefined : skip + take);
      return rows.map((r) =>
        select
          ? Object.fromEntries(Object.keys(select).map((k) => [k, (r as Record<string, unknown>)[k]]))
          : { ...r, client: state.clients.find((c) => c.id === r.clientId) }
      );
    },
  },
};

const FAKE_MODULES: Record<string, string> = {
  "next/server": "export class NextRequest extends Request {} export class NextResponse extends Response {}",
  "@/auth": "export const auth = async () => globalThis.__qw3.state.session;",
  "@/lib/prisma": "export const prisma = globalThis.__qw3.prisma;",
};
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown
) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };

(globalThis as unknown as { __qw3: unknown }).__qw3 = { state, prisma: fakePrisma };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in FAKE_MODULES) {
      return { url: `data:text/javascript,${encodeURIComponent(FAKE_MODULES[specifier])}`, shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      return { url: pathToFileURL(path.join(SRC, `${specifier.slice(2)}.ts`)).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const Q = await import("../../src/app/(app)/posts/list-query.ts");
const { GET } = await import("../../src/app/api/posts/ids/route.ts");

// ------------------------------------------------------------ cenário

/** "Agora": 06/10/2026 15:00 em SP (18:00Z). Hoje começa em 06/10 00:00 SP = 03:00Z. */
const NOW = new Date("2026-10-06T18:00:00Z");
const at = (iso: string) => new Date(iso);

let n = 0;
function post(status: string, when: string, extra: Partial<Row> = {}): Row {
  n++;
  return {
    id: uid(n),
    clientId: CLIENT_PUB,
    status,
    scheduledAt: at(when),
    theme: `ZZ QA tema ${n}`,
    scheduleId: null,
    clientNote: null,
    ...extra,
  };
}

function seed() {
  n = 0;
  state.posts = [
    post("failed", "2026-08-26T13:00:00Z"), // 1  falhou, passado → topo
    post("draft", "2026-09-14T21:00:00Z"), // 2  rascunho passado → fora
    post("published", "2026-09-20T21:00:00Z"), // 3  publicado passado → fora
    post("scheduled", "2026-10-02T21:00:00Z"), // 4  agendado que passou da hora → topo
    post("scheduled", "2026-10-03T21:00:00Z", { clientId: CLIENT_PROD }), // 5  só produção: não é "atrasado" → fora
    post("published", "2026-10-06T11:00:00Z"), // 6  hoje cedo, publicado → hoje em diante
    post("scheduled", "2026-10-06T17:50:00Z"), // 7  hoje, 10 min atrás: ainda no prazo → hoje em diante
    post("scheduled", "2026-10-06T16:00:00Z"), // 8  hoje, 2 h atrás → topo (atrasado)
    post("failed", "2026-10-06T12:00:00Z"), // 9  falhou hoje → topo (não repete embaixo)
    post("draft", "2026-10-07T21:00:00Z"), // 10 futuro
    post("scheduled", "2026-10-07T21:15:00Z", { theme: "ZZ QA tema 10" }), // 11 story do mesmo tema
    post("publishing", "2026-10-06T17:30:00Z"), // 12 em publicação há 30 min → topo (travado)
    post("draft", "2026-12-28T21:00:00Z"), // 13 futuro distante
  ];
}

const ids = (rows: { id: string }[]) => rows.map((r) => Number(r.id.slice(-12)));

beforeEach(() => {
  state.session = { user: { id: "00000000-0000-4000-8000-0000000000a5", role: "staff" } };
  seed();
});

// ------------------------------------------------------------ testes

describe("parseListParams / listQueryString", () => {
  test("sem range = Próximos; atalho de Aprovações (scheduleId/noted) = Todas; range explícito vale", () => {
    assert.equal(Q.parseListParams({}).range, "upcoming");
    assert.equal(Q.parseListParams({ status: "failed" }).range, "upcoming");
    assert.equal(Q.parseListParams({ scheduleId: uid(1) }).range, "all");
    assert.equal(Q.parseListParams({ noted: "1" }).range, "all");
    assert.equal(Q.parseListParams({ scheduleId: uid(1), range: "upcoming" }).range, "upcoming");
    assert.equal(Q.parseListParams({ range: "week" }).range, "week");
    assert.equal(Q.parseListParams({ range: "xpto" }).range, "upcoming");
    assert.equal(Q.parseListParams({ ref: "lixo" }, "2026-10-06").ref, "2026-10-06");
  });

  test("a query string reproduz exatamente os mesmos parâmetros (página → rota de ids)", () => {
    for (const raw of [
      {},
      { range: "all", status: "draft" },
      { range: "week", ref: "2026-10-01", clientId: CLIENT_PUB, q: "tema" },
      { scheduleId: uid(5), noted: "1" },
    ]) {
      const p = Q.parseListParams(raw, "2026-10-06");
      const back = Q.parseListParams(Object.fromEntries(new URLSearchParams(Q.listQueryString(p))), "2026-10-06");
      assert.deepEqual(back, p);
    }
  });
});

describe("planPage (grupo fixo no topo)", () => {
  test("fatias corretas nas bordas", () => {
    assert.deepEqual(Q.planPage(0, 1, 25), { pinned: null, main: { skip: 0, take: 25 } });
    assert.deepEqual(Q.planPage(15, 1, 25), { pinned: { skip: 0, take: 15 }, main: { skip: 0, take: 10 } });
    assert.deepEqual(Q.planPage(15, 2, 25), { pinned: null, main: { skip: 10, take: 25 } });
    assert.deepEqual(Q.planPage(25, 1, 25), { pinned: { skip: 0, take: 25 }, main: null });
    assert.deepEqual(Q.planPage(30, 2, 25), { pinned: { skip: 25, take: 5 }, main: { skip: 0, take: 20 } });
    assert.deepEqual(Q.planPage(50, 3, 25), { pinned: null, main: { skip: 0, take: 25 } });
  });
});

describe("Próximos (U-19)", () => {
  test("topo = falhas + atrasados (cliente que publica), depois de hoje em diante, crescente; sem repetidos", async () => {
    const q = Q.buildListQuery(Q.parseListParams({}, "2026-10-06"), NOW);
    const counts = await Q.countList(q);
    const page = await Q.fetchListPage(q, counts.pinned, 1);
    const top = page.filter((r) => r.pinned).map((r) => r.post);
    const rest = page.filter((r) => !r.pinned).map((r) => r.post);
    assert.deepEqual(ids(top), [1, 4, 9, 8, 12], "falhas e atrasados, do mais antigo ao mais novo");
    assert.deepEqual(ids(rest), [6, 7, 10, 11, 13], "de hoje 00:00 SP em diante, crescente");
    assert.deepEqual(counts, { pinned: 5, main: 5 });
    // fora: rascunho e publicado de dias passados, e o "agendado" de cliente só produção
    for (const out of [2, 3, 5]) assert.ok(!ids([...top, ...rest]).includes(out), `post ${out} não deveria aparecer`);
  });

  test("isOverdue marca a linha com o mesmo critério do grupo fixo", () => {
    const byId = (k: number) => {
      const r = state.posts[k - 1];
      return { ...r, client: state.clients.find((c) => c.id === r.clientId) };
    };
    assert.equal(Q.isOverdue(byId(4), NOW), true);
    assert.equal(Q.isOverdue(byId(8), NOW), true);
    assert.equal(Q.isOverdue(byId(12), NOW), true);
    assert.equal(Q.isOverdue(byId(7), NOW), false, "10 min de atraso ainda está no prazo do publicador");
    assert.equal(Q.isOverdue(byId(5), NOW), false, "cliente só produção não publica");
    assert.equal(Q.isOverdue(byId(10), NOW), false);
  });

  test("filtro de status: Falharam mostra todas as falhas; Publicados só de hoje em diante", async () => {
    const failed = Q.buildListQuery(Q.parseListParams({ status: "failed" }, "2026-10-06"), NOW);
    assert.deepEqual(await Q.countList(failed), { pinned: 2, main: 0 });
    const pub = Q.buildListQuery(Q.parseListParams({ status: "published" }, "2026-10-06"), NOW);
    assert.deepEqual(await Q.countList(pub), { pinned: 0, main: 1 });
  });

  test("páginas 1..n concatenadas = 'todos deste filtro' (mesma ordem, sem buraco nem repetido)", async () => {
    // muitos posts: o grupo fixo ocupa mais de uma página
    for (let i = 0; i < 30; i++) state.posts.push(post("failed", `2026-07-${String(1 + (i % 28)).padStart(2, "0")}T12:00:00Z`));
    for (let i = 0; i < 40; i++) state.posts.push(post("draft", "2026-11-10T21:00:00Z")); // mesmo horário: desempate por id
    const q = Q.buildListQuery(Q.parseListParams({}, "2026-10-06"), NOW);
    const counts = await Q.countList(q);
    const total = counts.pinned + counts.main;
    const pages: string[] = [];
    for (let p = 1; p <= Math.ceil(total / Q.PAGE_SIZE); p++) {
      pages.push(...(await Q.fetchListPage(q, counts.pinned, p)).map((r) => r.post.id));
    }
    const filter = (await Q.fetchFilterItems(q)).map((r) => r.id);
    assert.equal(pages.length, total);
    assert.equal(new Set(pages).size, total, "nenhum post repetido entre páginas");
    assert.deepEqual(filter, pages);
    // limite: só os primeiros N, na mesma ordem
    assert.deepEqual((await Q.fetchFilterItems(q, 40)).map((r) => r.id), pages.slice(0, 40));
  });

  test("Todas segue decrescente; semana usa a janela e ordem crescente", async () => {
    const all = Q.buildListQuery(Q.parseListParams({ range: "all" }, "2026-10-06"), NOW);
    const allRows = (await Q.fetchListPage(all, 0, 1)).map((r) => r.post);
    assert.equal(allRows.length, 13);
    assert.deepEqual(ids(allRows).slice(0, 3), [13, 11, 10]);
    const week = Q.buildListQuery(Q.parseListParams({ range: "week", ref: "2026-10-06" }, "2026-10-06"), NOW);
    assert.equal(week.pinned, null);
    const weekRows = (await Q.fetchListPage(week, 0, 1)).map((r) => r.post);
    // semana de dom 04/10 a sáb 10/10 (SP): o 4 (02/10) e o 5 (sáb 03/10) ficam fora
    assert.deepEqual(ids(weekRows), [6, 9, 8, 12, 7, 10, 11]);
  });
});

describe("GET /api/posts/ids (U-37)", () => {
  const call = async (qs: string) => {
    const res = await GET(new Request(`http://localhost/api/posts/ids?${qs}`));
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };

  test("sem sessão → 401 pt-BR", async () => {
    state.session = null;
    const r = await call("range=upcoming");
    assert.equal(r.status, 401);
    assert.equal(typeof r.json.error, "string");
    assert.match(String(r.json.error), /sessão/i);
  });

  test("clientId/scheduleId fora do formato → 400 com frase pt-BR", async () => {
    for (const qs of ["clientId=abc", "scheduleId=1%20OR%201"]) {
      const r = await call(qs);
      assert.equal(r.status, 400);
      assert.match(String(r.json.error), /Filtro inválido/);
    }
  });

  test("devolve { items: {id,status}[], total } na ordem da lista (a mesma da página)", async () => {
    const r = await call("range=upcoming");
    assert.equal(r.status, 200);
    const items = r.json.items as { id: string; status: string }[];
    assert.ok(items.length > 0);
    assert.deepEqual(Object.keys(items[0]).sort(), ["id", "status"]);
    // a rota usa o relógio real (o cenário é de 06/10/2026): compara com a mesma consulta montada agora
    const q = Q.buildListQuery(Q.parseListParams({ range: "upcoming" }));
    const counts = await Q.countList(q);
    assert.equal(r.json.total, counts.pinned + counts.main);
    assert.deepEqual(items.map((i) => i.id), (await Q.fetchFilterItems(q)).map((i) => i.id));
  });
});
