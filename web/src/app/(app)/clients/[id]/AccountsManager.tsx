"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { BrandBadge, BRAND } from "@/components/BrandIcons";
import { Button, buttonClasses } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { DatePicker } from "@/components/DatePickers";
import { ConfirmDialog } from "@/components/Dialog";
import { Field, Input, Select, Textarea } from "@/components/Field";
import { Icon } from "@/components/Icons";
import { EmptyState, StatusBadge } from "@/components/ui";
import { formatDate } from "@/lib/format-date";
import { toUserMessage } from "@/lib/user-facing-error";
import ImportMetaButton from "./ImportMetaButton";

type Account = {
  id: string;
  platform: string;
  externalId: string;
  status: string;
  dailyPostLimit: number;
  tokenExpiresAt: string | null;
};

/** O que é o "ID da conta na rede" de cada plataforma (ajuda do campo) e um exemplo (placeholder). */
const PLATFORMS = [
  {
    id: "instagram",
    label: "Instagram",
    help: "O ID de usuário da conta Business ou Creator do Instagram, vinculada a uma Página do Facebook.",
    example: "ex.: 17841400000000000",
  },
  { id: "facebook", label: "Facebook", help: "O ID da Página do Facebook.", example: "ex.: 123456789" },
  {
    id: "linkedin",
    label: "LinkedIn",
    help: "O URN da organização (Company Page) no LinkedIn.",
    example: "ex.: urn:li:organization:12345",
  },
] as const;

const idHelp = (platform: string) => PLATFORMS.find((p) => p.id === platform)?.help ?? "O ID da conta na rede social.";

/** Aviso que a rota /api/linkedin/start devolve na URL quando o LinkedIn não está configurado (S17). */
const LINKEDIN_NOTICE = "linkedin-indisponivel";

/** Motivo mostrado à staff no lugar dos botões de conta (decisão "Só admin + registro", AC-07). */
const ADMIN_ONLY_ACCOUNTS =
  "Só administradoras podem adicionar, trocar ou excluir contas de publicação. Se precisar, peça a uma administradora.";

function AccountRow({ account, canManage }: { account: Account; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleteError, setDeleteError] = useState("");

  const [externalId, setExternalId] = useState(account.externalId);
  const [accessToken, setAccessToken] = useState("");
  const [limit, setLimit] = useState(String(account.dailyPostLimit));
  const [status, setStatus] = useState(account.status);

  const label = BRAND[account.platform]?.label ?? account.platform;

  async function save() {
    const dailyPostLimit = Number(limit);
    if (!Number.isInteger(dailyPostLimit) || dailyPostLimit < 1 || dailyPostLimit > 200) {
      setError("O limite diário precisa ser um número inteiro de 1 a 200.");
      return;
    }
    if (!externalId.trim()) {
      setError("Informe o ID da conta na rede.");
      return;
    }
    setBusy(true);
    setError("");

    const payload: Record<string, unknown> = { externalId: externalId.trim(), dailyPostLimit, status };
    // só manda um token novo se foi digitado (senão mantém o atual)
    if (accessToken.trim()) payload.accessToken = accessToken.trim();

    try {
      const res = await fetch(`/api/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(toUserMessage(data, "Não foi possível salvar. Confira os campos e tente de novo."));
        return;
      }
      setAccessToken("");
      setEditing(false);
      router.refresh();
    } catch {
      setError("Falha de conexão ao salvar. Verifique a internet e tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setExternalId(account.externalId);
    setAccessToken("");
    setLimit(String(account.dailyPostLimit));
    setStatus(account.status);
    setError("");
    setEditing(false);
  }

  async function remove() {
    setBusy(true);
    setDeleteError("");
    try {
      const res = await fetch(`/api/accounts/${account.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setDeleteError(toUserMessage(data, "Não foi possível excluir a conta. Tente de novo em instantes."));
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch {
      setDeleteError("Falha de conexão ao excluir. Verifique a internet e tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <BrandBadge platform={account.platform} size={38} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">{label}</p>
          <p className="truncate font-mono text-xs text-fg-muted" title={account.externalId}>
            {account.externalId}
          </p>
        </div>

        {!editing && (
          <div className="flex items-center gap-3">
            <div className="text-right">
              <StatusBadge kind="account" status={account.status} />
              <p className="mt-1 text-xs text-fg-muted">
                {account.dailyPostLimit}/dia
                {account.tokenExpiresAt && ` · token até ${formatDate(account.tokenExpiresAt)}`}
              </p>
            </div>
            {canManage && (
              <>
                <Button iconOnly variant="ghost" aria-label={`Editar conta ${label}`} title="Editar" onClick={() => setEditing(true)}>
                  <Icon.edit />
                </Button>
                <Button
                  iconOnly
                  variant="ghost"
                  aria-label={`Excluir conta ${label}`}
                  title="Excluir"
                  onClick={() => {
                    setDeleteError("");
                    setConfirming(true);
                  }}
                >
                  <Icon.trash />
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {editing && canManage && (
        <div className="mt-4 grid gap-4">
          <Field label="ID da conta na rede" help={idHelp(account.platform)} required>
            <Input value={externalId} onChange={(e) => setExternalId(e.target.value)} className="font-mono" />
          </Field>

          <Field label="Token de acesso" help="Deixe em branco para manter o token atual.">
            <Textarea
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              rows={2}
              autoComplete="off"
              spellCheck={false}
              placeholder="Cole um novo token só se for trocar"
              className="resize-none font-mono"
            />
          </Field>

          <div className="flex flex-wrap items-end gap-3">
            <Field label="Limite diário de posts" className="w-40">
              <Input type="number" inputMode="numeric" min={1} max={200} value={limit} onChange={(e) => setLimit(e.target.value)} />
            </Field>
            <Field label="Status" className="w-40">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="active">Ativa</option>
                <option value="inactive">Inativa</option>
              </Select>
            </Field>
            <div className="flex gap-2 sm:ml-auto">
              <Button disabled={busy} onClick={cancel}>
                Cancelar
              </Button>
              <Button variant="primary" loading={busy} loadingText="Salvando…" onClick={save}>
                Salvar
              </Button>
            </div>
          </div>

          {error && (
            <Callout tone="danger" live="assertive">
              {error}
            </Callout>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        tone="danger"
        title={`Excluir a conta ${label}?`}
        description={<span className="break-all font-mono">{account.externalId}</span>}
        consequences={[
          "A conta e o token salvo são apagados. Não dá para desfazer.",
          `Os posts deste cliente para o ${label} falham na publicação até outra conta ser conectada.`,
        ]}
        confirmLabel="Excluir conta"
        busy={busy}
        busyLabel="Excluindo…"
        error={deleteError}
        onCancel={() => setConfirming(false)}
        onConfirm={remove}
      />
    </li>
  );
}

/** Aviso "LinkedIn indisponível" vindo do redirecionamento de /api/linkedin/start. */
function LinkedinNotice() {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // a página recarrega no topo: leva o aviso para a vista e o foco para ele
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "center" });
    ref.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div ref={ref} tabIndex={-1} className="px-5 pt-4 outline-none">
      <Callout
        tone="warning"
        title="Não foi possível conectar o LinkedIn"
        // tira o ?aviso da URL sem recarregar (integra com useSearchParams)
        onDismiss={() => window.history.replaceState(null, "", pathname)}
      >
        A conexão com o LinkedIn não está disponível no momento. Avise o administrador do sistema.
      </Callout>
    </div>
  );
}

export default function AccountsManager({
  clientId,
  accounts,
  metaConnections = [],
  canManage = false,
}: {
  clientId: string;
  accounts: Account[];
  metaConnections?: { id: string; name: string }[];
  /** admin: importar do Meta, conectar LinkedIn, adicionar, editar e excluir contas (AC-07) */
  canManage?: boolean;
}) {
  const searchParams = useSearchParams();
  const linkedinUnavailable = searchParams.get("aviso") === LINKEDIN_NOTICE;

  return (
    <section aria-labelledby="contas-sociais" className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2 id="contas-sociais" className="font-display text-lg font-semibold tracking-title text-fg">
          Contas sociais
        </h2>
        {canManage && (
          <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
            <ImportMetaButton clientId={clientId} connections={metaConnections} />
            <a href={`/api/linkedin/start?clientId=${clientId}`} className={buttonClasses()}>
              <BrandBadge platform="linkedin" size={18} />
              Conectar LinkedIn
            </a>
            <Link href={`/clients/${clientId}/accounts/new`} className={buttonClasses({ variant: "ghost" })}>
              <span aria-hidden="true" className="inline-flex size-4.5 [&>svg]:size-full">
                <Icon.plus />
              </span>
              Adicionar manualmente
            </Link>
          </div>
        )}
      </div>

      {!canManage && (
        <p className="flex items-start gap-2 border-b border-line px-5 py-3 text-sm text-fg-muted">
          <span aria-hidden="true" className="mt-0.5 inline-flex size-4 shrink-0 [&>svg]:size-full">
            <Icon.shield />
          </span>
          {ADMIN_ONLY_ACCOUNTS}
        </p>
      )}

      {linkedinUnavailable && <LinkedinNotice />}

      {accounts.length === 0 ? (
        <EmptyState
          size="inline"
          headingLevel={3}
          title="Nenhuma conta conectada"
          description={
            canManage
              ? "Importe a Página e o Instagram do Meta, conecte o LinkedIn ou adicione uma conta manualmente."
              : "Peça a uma administradora para importar a Página do Meta ou conectar o LinkedIn deste cliente."
          }
        />
      ) : (
        <ul className="divide-y divide-line">
          {accounts.map((acc) => (
            <AccountRow key={acc.id} account={acc} canManage={canManage} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Formulário de /clients/[id]/accounts/new. Mora aqui (módulo cliente das contas sociais) para a
 * página continuar componente de servidor e exportar `metadata` (CC8).
 */
export function NewAccountForm({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [platform, setPlatform] = useState<string>("instagram");
  const [tokenExpiresAt, setTokenExpiresAt] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const current = PLATFORMS.find((p) => p.id === platform) ?? PLATFORMS[0];

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const expires = form.get("tokenExpiresAt");
    const data = {
      clientId,
      platform,
      externalId: String(form.get("externalId") ?? "").trim(),
      accessToken: String(form.get("accessToken") ?? "").trim(),
      dailyPostLimit: Number(form.get("dailyPostLimit") ?? 25),
      tokenExpiresAt: expires ? new Date(String(expires)).toISOString() : undefined,
    };

    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(toUserMessage(body, "Não foi possível adicionar a conta. Confira os dados e tente de novo."));
        return;
      }
      router.push(`/clients/${clientId}`);
      router.refresh();
    } catch {
      setError("Falha de conexão ao salvar. Verifique a internet e tente de novo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6">
      <Callout tone="info">
        O token é criptografado antes de ser salvo e nunca mais é exibido depois disso.
      </Callout>

      <form onSubmit={handleSubmit} className="card grid gap-5 p-4 sm:p-6">
        <Field label="Plataforma" kind="group">
          <div className="grid grid-cols-3 gap-2">
            {PLATFORMS.map((p) => (
              <label
                key={p.id}
                className="flex min-h-14 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-control border border-line-strong bg-surface px-2 py-2 text-sm font-medium text-fg-muted transition-colors duration-(--sf-dur-fast) hover:bg-hover hover:text-fg has-checked:border-selected has-checked:bg-selected has-checked:text-on-selected has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus sm:flex-row sm:gap-2"
              >
                <input
                  type="radio"
                  name="platform"
                  value={p.id}
                  checked={platform === p.id}
                  onChange={() => setPlatform(p.id)}
                  className="sr-only"
                />
                <BrandBadge platform={p.id} size={22} />
                {p.label}
              </label>
            ))}
          </div>
        </Field>

        <Field label="ID da conta na rede" help={current.help} required>
          <Input name="externalId" placeholder={current.example} autoComplete="off" className="font-mono" />
        </Field>

        <Field label="Token de acesso" required>
          <Textarea
            name="accessToken"
            rows={3}
            autoComplete="off"
            spellCheck={false}
            placeholder="Cole aqui o token da conta"
            className="resize-none font-mono"
          />
        </Field>

        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Field label="Limite diário de posts" help="Máximo de publicações por dia nesta conta (1 a 200).">
            <Input name="dailyPostLimit" type="number" inputMode="numeric" defaultValue={25} min={1} max={200} />
          </Field>
          <Field label="Expira em" optional>
            <DatePicker name="tokenExpiresAt" value={tokenExpiresAt} onChange={setTokenExpiresAt} />
          </Field>
        </div>

        {error && (
          <Callout tone="danger" live="assertive">
            {error}
          </Callout>
        )}

        <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row">
          <Link href={`/clients/${clientId}`} className={`${buttonClasses()} sm:flex-1`}>
            Cancelar
          </Link>
          <Button type="submit" variant="primary" loading={loading} loadingText="Salvando…" className="sm:flex-1">
            Salvar conta
          </Button>
        </div>
      </form>
    </div>
  );
}
