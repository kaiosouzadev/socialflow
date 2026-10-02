"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandBadge } from "@/components/BrandIcons";
import { Button } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { ConfirmDialog, Dialog } from "@/components/Dialog";
import { Field, Input, Textarea } from "@/components/Field";
import { Icon } from "@/components/Icons";
import { Toast, type ToastState } from "@/components/Toast";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { toUserMessage } from "@/lib/user-facing-error";

type Connection = {
  id: string;
  name: string;
  businessId: string | null;
  status: string;
  accounts: number;
  createdAt: string;
};

type Asset = {
  pageId: string;
  pageName: string;
  instagramId: string | null;
  instagramUsername: string | null;
};

const OFFLINE = "Sem conexão com o servidor. Verifique a internet e tente de novo.";
const SESSION_EXPIRED = "Sua sessão expirou. Entre de novo para continuar.";
const ADMIN_ONLY = "Só administradores podem gerenciar as conexões com a Meta.";

/** Erro de "Ver ativos" e o que a tela oferece junto dele. */
type AssetsProblem = {
  text: string;
  /** "Tentar de novo": só quando repetir pode resolver (rede, Meta fora do ar, limite de pedidos) */
  retry: boolean;
  /** a rota pede para atualizar a conexão; a tela faz isso removendo e conectando de novo */
  reconnect: boolean;
};

/** Textos da rota de ativos (S17/P4-A2) que pedem um token novo: "…e atualize a conexão". */
const ASKS_UPDATE = /atualiz(?:e|ar) a conexão/i;
/** Não existe "atualizar conexão" nesta tela: o caminho é remover e criar de novo. */
const UPDATE_HOW = "Para isso, remova esta conexão e conecte o Business Manager de novo em “Nova conexão”.";

/**
 * Mensagem de "Ver ativos" (A-026). A rota já devolve a causa e a ação em pt-BR (S17/P4-A2);
 * aqui só entram os casos sem texto útil: sessão, conexão sumida ou inativa e falhas sem `error`.
 * 503 é falha de configuração no servidor (ex.: token salvo ilegível): tentar de novo não resolve.
 */
function assetsError(status: number, data: unknown): AssetsProblem {
  if (status === 401) return { text: SESSION_EXPIRED, retry: false, reconnect: false };
  if (status === 404) return { text: "Esta conexão não existe mais. Atualize a página.", retry: false, reconnect: false };
  if (status === 409) {
    return {
      text: "Esta conexão está inativa. Para listar as Páginas de novo, conecte o Business Manager com um token novo em “Nova conexão”.",
      retry: false,
      reconnect: false,
    };
  }
  const config = status === 503;
  const text = toUserMessage(
    data,
    config
      ? "Esta conexão não pode ser usada por uma falha de configuração no servidor. Avise o administrador do sistema."
      : "Não foi possível listar as Páginas e as contas do Instagram desta conexão. Tente de novo em instantes.",
  );
  const reconnect = ASKS_UPDATE.test(text);
  return { text: reconnect ? `${text} ${UPDATE_HOW}` : text, retry: !config && status !== 403, reconnect };
}

const TOKEN_REFUSED = "Token recusado pela Meta";

/**
 * Erro ao conectar: no campo do token quando a Meta recusou o token; no diálogo nos demais casos.
 * Na recusa (400), a rota manda depois do prefixo a causa e a ação em pt-BR (inválido/expirado,
 * sem permissão ou recusa sem causa conhecida); demora e falha de rede vêm como 502.
 */
function connectError(status: number, data: unknown): { token?: string; form?: string } {
  if (status === 401) return { form: SESSION_EXPIRED };
  if (status === 403) return { form: ADMIN_ONLY };
  const raw = (data as { error?: unknown } | null)?.error;
  if (status === 400 && typeof raw !== "string") {
    // 400 do zod: o token tem menos de 20 caracteres
    return { token: "O token parece incompleto. Copie o token inteiro e cole de novo." };
  }
  if (status === 400 && typeof raw === "string" && raw.startsWith(TOKEN_REFUSED)) {
    const cause = toUserMessage(raw.slice(TOKEN_REFUSED.length).replace(/^:?\s*/, ""), "");
    return {
      token: cause
        ? `A Meta recusou este token: ${cause}`
        : "A Meta recusou este token. Confira se você copiou o token inteiro do usuário do sistema e tente de novo.",
    };
  }
  return { form: toUserMessage(data, "Não foi possível conectar o Business Manager. Tente de novo em instantes.") };
}

function accountsLabel(n: number): string {
  if (n === 0) return "Nenhuma conta de cliente usa esta conexão";
  return n === 1 ? "1 conta de cliente conectada" : `${n} contas de clientes conectadas`;
}

function ConnectionRow({ conn, onRemove }: { conn: Connection; onRemove: (conn: Connection) => void }) {
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<AssetsProblem | null>(null);
  const listId = useId();

  async function loadAssets(refresh = false) {
    if (assets && !refresh) {
      setOpen((v) => !v);
      return;
    }
    setLoading(true);
    setProblem(null);
    try {
      const res = await fetch(`/api/meta/connections/${conn.id}/assets${refresh ? "?refresh=1" : ""}`);
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setProblem(assetsError(res.status, data));
        return;
      }
      const list = (data as { assets?: unknown } | null)?.assets;
      setAssets(Array.isArray(list) ? (list as Asset[]) : []);
      setOpen(true);
    } catch {
      setProblem({ text: OFFLINE, retry: true, reconnect: false });
    } finally {
      setLoading(false);
    }
  }

  const showList = open && assets !== null;

  return (
    <li className="px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-grid size-10 shrink-0 place-items-center rounded-control bg-neutral-bg text-fg-muted"
          >
            <Icon.link className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <p className="min-w-0 truncate text-sm font-medium text-fg" title={conn.name}>
                {conn.name}
              </p>
              {conn.status !== "active" && <StatusBadge kind="account" status={conn.status} />}
            </div>
            <p className="text-sm text-fg-muted">
              {accountsLabel(conn.accounts)}
              {conn.businessId && (
                <>
                  {" "}
                  · ID na Meta <span className="font-mono">{conn.businessId}</span>
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            leadingIcon={<Icon.users />}
            loading={loading && assets === null}
            loadingText="Carregando…"
            aria-expanded={showList}
            aria-controls={showList ? listId : undefined}
            onClick={() => void loadAssets()}
          >
            {showList ? "Ocultar ativos" : "Ver ativos"}
          </Button>
          {showList && (
            <Button
              iconOnly
              variant="ghost"
              aria-label="Atualizar a lista na Meta"
              title="Atualizar a lista na Meta"
              loading={loading}
              onClick={() => void loadAssets(true)}
            >
              <Icon.refresh />
            </Button>
          )}
          <Button
            iconOnly
            variant="ghost"
            aria-label={`Remover a conexão ${conn.name}`}
            title="Remover conexão"
            onClick={() => onRemove(conn)}
          >
            <Icon.trash />
          </Button>
        </div>
      </div>

      {problem && (
        <Callout
          tone="danger"
          live="assertive"
          className="mt-3"
          action={
            problem.retry || problem.reconnect ? (
              <div className="flex flex-wrap gap-2">
                {problem.retry && (
                  <Button size="sm" disabled={loading} onClick={() => void loadAssets(true)}>
                    Tentar de novo
                  </Button>
                )}
                {problem.reconnect && (
                  <Button size="sm" onClick={() => onRemove(conn)}>
                    Remover conexão
                  </Button>
                )}
              </div>
            ) : undefined
          }
        >
          {problem.text}
        </Callout>
      )}

      {showList &&
        (assets.length === 0 ? (
          <div id={listId} className="mt-4 rounded-card border border-line px-4">
            <EmptyState
              size="inline"
              headingLevel={3}
              icon={<Icon.link />}
              title="Nenhuma Página encontrada neste Business"
              description="O usuário do sistema não tem acesso a nenhuma Página. Dê acesso no Gerenciador de Negócios da Meta e atualize a lista."
            />
          </div>
        ) : (
          <ul
            id={listId}
            aria-label={`Páginas e contas do Instagram de ${conn.name}`}
            className="mt-4 divide-y divide-line rounded-card border border-line"
          >
            {assets.map((a) => (
              <li key={a.pageId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                <span aria-hidden="true" className="inline-flex">
                  <BrandBadge platform="facebook" size={22} />
                </span>
                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate text-sm font-medium text-fg" title={a.pageName}>
                    {a.pageName}
                  </p>
                  <p className="font-mono text-xs text-fg-muted">{a.pageId}</p>
                </div>
                {a.instagramId ? (
                  <span className="flex min-w-0 items-center gap-1.5 text-sm text-fg-muted">
                    <span aria-hidden="true" className="inline-flex">
                      <BrandBadge platform="instagram" size={18} />
                    </span>
                    <span className="sr-only">Instagram: </span>
                    <span className="truncate">@{a.instagramUsername ?? a.instagramId}</span>
                  </span>
                ) : (
                  <span className="text-sm text-fg-muted">Sem Instagram vinculado</span>
                )}
              </li>
            ))}
          </ul>
        ))}
    </li>
  );
}

function NewConnectionDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = token.trim();
    setError(null);
    if (value.length < 20) {
      setTokenError(value ? "O token parece incompleto. Copie o token inteiro e cole de novo." : "Cole o token do usuário do sistema.");
      document.getElementById("meta-new-token")?.focus();
      return;
    }
    setTokenError(null);
    setBusy(true);
    try {
      // o token vai só no corpo do POST (nunca em URL)
      const res = await fetch("/api/meta/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || undefined, token: value }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const problem = connectError(res.status, data);
        if (problem.token) {
          setTokenError(problem.token);
          document.getElementById("meta-new-token")?.focus();
        } else {
          setError(problem.form ?? null);
        }
        return;
      }
      const created = (data as { name?: unknown } | null)?.name;
      onCreated(typeof created === "string" && created ? created : name.trim() || "Business Manager");
    } catch {
      setError(OFFLINE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Conectar Business Manager"
      busy={busy}
      error={error}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="meta-new-form" variant="primary" loading={busy} loadingText="Validando na Meta…">
            Conectar
          </Button>
        </>
      }
    >
      <form id="meta-new-form" noValidate onSubmit={submit} className="grid gap-4 pb-2">
        <Callout tone="info">
          Cole o token do usuário do sistema (System User) do Gerenciador de Negócios. O token é conferido na Meta e
          guardado criptografado. Com ele, o sistema lista as Páginas e as contas do Instagram que o Business administra.
        </Callout>
        <Field
          id="meta-new-name"
          label="Nome"
          optional
          help="Para reconhecer a conexão na lista. Sem nome, usamos o nome que vem da Meta."
        >
          <Input value={name} autoComplete="off" placeholder="Ex.: Business da agência" onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field
          id="meta-new-token"
          label="Token do usuário do sistema"
          required
          help="Gerado no Gerenciador de Negócios da Meta, em Usuários do sistema."
          error={tokenError}
        >
          <Textarea
            value={token}
            rows={3}
            autoComplete="off"
            spellCheck={false}
            placeholder="EAAB…"
            className="font-mono"
            onChange={(e) => {
              setToken(e.target.value);
              setTokenError(null);
            }}
          />
        </Field>
      </form>
    </Dialog>
  );
}

export default function MetaConnectionsManager({ initial }: { initial: Connection[] }) {
  const router = useRouter();
  const [toast, setToast] = useState<ToastState>(null);
  // a chave remonta o diálogo a cada abertura (campos limpos; o token não fica na memória da tela)
  const [createSeq, setCreateSeq] = useState(0);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<Connection | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // exclusão só depois do ConfirmDialog; erro fica dentro do diálogo
  async function remove() {
    if (!removing) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/meta/connections/${removing.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data: unknown = await res.json().catch(() => null);
        setDeleteError(
          res.status === 404
            ? "Esta conexão já foi removida. Feche e atualize a página."
            : res.status === 401
              ? SESSION_EXPIRED
              : res.status === 403
                ? ADMIN_ONLY
                : toUserMessage(data, "Não foi possível remover a conexão. Tente de novo."),
        );
        return;
      }
      const removedName = removing.name;
      setRemoving(null);
      setToast({ kind: "success", text: `Conexão ${removedName} removida.` });
      router.refresh();
    } catch {
      setDeleteError(OFFLINE);
    } finally {
      setDeleting(false);
    }
  }

  const consequences = removing
    ? [
        "O token desta conexão é apagado do sistema. Nada é apagado na Meta.",
        ...(removing.accounts > 0
          ? [
              removing.accounts === 1
                ? "A conta de cliente importada por ela continua conectada e publicando: ela guarda o token da própria Página."
                : `As ${removing.accounts} contas de clientes importadas por ela continuam conectadas e publicando: cada uma guarda o token da própria Página.`,
            ]
          : []),
        "Para importar novas Páginas deste Business, será preciso conectar de novo com um token.",
      ]
    : [];

  return (
    <>
      <PageHeader
        title="Conexões Meta"
        subtitle="Business Manager → Páginas e Instagram dos clientes"
        action={
          <Button
            variant="primary"
            leadingIcon={<Icon.plus />}
            onClick={() => {
              setCreateSeq((n) => n + 1);
              setCreating(true);
            }}
          >
            Nova conexão
          </Button>
        }
      />

      {initial.length === 0 ? (
        <EmptyState
          headingLevel={2}
          icon={<Icon.link />}
          title="Nenhuma conexão com a Meta"
          description="Conecte o Business Manager da agência em “Nova conexão” para importar as Páginas e as contas do Instagram dos clientes."
        />
      ) : (
        <ul aria-label="Conexões com a Meta" className="card divide-y divide-line overflow-hidden">
          {initial.map((c) => (
            <ConnectionRow
              key={c.id}
              conn={c}
              onRemove={(conn) => {
                setDeleteError(null);
                setRemoving(conn);
              }}
            />
          ))}
        </ul>
      )}

      <NewConnectionDialog
        key={`nova-${createSeq}`}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(name) => {
          setCreating(false);
          setToast({ kind: "success", text: `Conexão ${name} criada. Use “Ver ativos” para conferir as Páginas.` });
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        tone="danger"
        title={`Remover a conexão ${removing?.name ?? ""}?`}
        consequences={consequences}
        confirmLabel="Remover conexão"
        busy={deleting}
        busyLabel="Removendo…"
        error={deleteError}
        onConfirm={() => void remove()}
        onCancel={() => {
          setRemoving(null);
          setDeleteError(null);
        }}
      />

      <Toast toast={toast} onClose={() => setToast(null)} />
    </>
  );
}
