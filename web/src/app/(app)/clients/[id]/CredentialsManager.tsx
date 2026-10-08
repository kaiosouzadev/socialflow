"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { Field, Input } from "@/components/Field";
import { Icon } from "@/components/Icons";

type Credential = { network: string; login: string; password: string; note?: string };

const EMPTY_ROW: Credential = { network: "", login: "", password: "", note: "" };

/** Botão mostrar/ocultar senha (A-044): estado em aria-pressed, nome fixo. */
function RevealButton({
  pressed,
  onToggle,
  label,
}: {
  pressed: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <Button
      iconOnly
      variant="ghost"
      size="sm"
      aria-label={label}
      aria-pressed={pressed}
      title={pressed ? "Ocultar senha" : "Mostrar senha"}
      onClick={onToggle}
    >
      {pressed ? <Icon.eyeOff /> : <Icon.eye />}
    </Button>
  );
}

export default function CredentialsManager({
  clientId,
  hasCredentials,
}: {
  clientId: string;
  hasCredentials: boolean;
}) {
  const router = useRouter();
  const [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<Credential[]>([]);
  const [loadedRows, setLoadedRows] = useState<Credential[]>([]);
  const [show, setShow] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/clients/${clientId}/credentials`, { cache: "no-store" });
      const data: unknown = await res.json().catch(() => null);
      const list = (data as { credentials?: unknown } | null)?.credentials;
      if (!res.ok || !Array.isArray(list)) {
        // 429 (limite de revelações por hora) e 503 trazem o motivo em pt-BR (N-14: só texto)
        const reason = (data as { error?: unknown } | null)?.error;
        setError(
          (res.status === 429 || res.status === 503) && typeof reason === "string"
            ? reason
            : "Não foi possível carregar as credenciais. Tente de novo.",
        );
        return;
      }
      setRows(list as Credential[]);
      setLoadedRows(list as Credential[]);
      setShow({});
      setRevealed(true);
    } catch {
      setError("Sem conexão com o servidor. Verifique a internet e tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  function startEditing() {
    const base = revealed ? loadedRows : [];
    setRows(base.length > 0 ? base.map((r) => ({ ...r })) : [{ ...EMPTY_ROW }]);
    setShow({});
    setError("");
    setEditing(true);
  }

  function cancel() {
    setRows(loadedRows);
    setShow({});
    setError("");
    setEditing(false);
  }

  async function save() {
    // linhas totalmente em branco (ex.: "Adicionar rede" sem preencher) não vão ao servidor
    const filled = rows.filter((r) => r.network.trim() || r.login.trim() || r.password.trim());
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/clients/${clientId}/credentials`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials: filled }),
      });
      if (!res.ok) {
        setError(
          res.status === 400
            ? "Preencha a rede de cada credencial antes de salvar."
            : "Não foi possível salvar as credenciais. Tente de novo.",
        );
        return;
      }
      // o servidor descarta as linhas vazias: o que ficou na tela é o que foi gravado
      const kept = filled.filter((r) => r.network.trim() && (r.login.trim() || r.password.trim()));
      setRows(kept);
      setLoadedRows(kept);
      setRevealed(true);
      setShow({});
      setEditing(false);
      router.refresh();
    } catch {
      setError("Sem conexão com o servidor. Verifique a internet e tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  const setRow = (i: number, patch: Partial<Credential>) =>
    setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const toggleShow = (i: number) => setShow((s) => ({ ...s, [i]: !s[i] }));

  const hasSaved = hasCredentials || loadedRows.length > 0;

  return (
    <section aria-labelledby="credenciais-titulo" className="card p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-flex size-4 text-fg-muted [&>svg]:size-full">
            <Icon.shield />
          </span>
          <h2 id="credenciais-titulo" className="font-display text-lg font-semibold tracking-title text-fg">
            Credenciais
          </h2>
          <span className="text-xs text-fg-muted">(criptografadas)</span>
        </div>
        {!editing && (
          <div className="flex flex-wrap gap-2">
            {hasSaved && !revealed && (
              <Button size="sm" leadingIcon={<Icon.eye />} loading={busy} loadingText="Carregando…" onClick={() => void load()}>
                Revelar
              </Button>
            )}
            {(revealed || !hasSaved) && (
              <Button size="sm" leadingIcon={hasSaved ? <Icon.edit /> : <Icon.plus />} onClick={startEditing}>
                {hasSaved ? "Editar" : "Adicionar"}
              </Button>
            )}
          </div>
        )}
      </div>

      {!revealed && hasSaved && !editing && (
        <p className="text-sm text-fg-muted">
          Credenciais salvas e criptografadas. Use “Revelar” para ver; cada revelação fica no registro de ações.
        </p>
      )}
      {!revealed && !hasSaved && !editing && <p className="text-sm text-fg-muted">Nenhuma credencial cadastrada.</p>}

      {revealed && !editing && (
        <>
          {rows.length === 0 ? (
            <p className="text-sm text-fg-muted">Nenhuma credencial cadastrada.</p>
          ) : (
            <ul className="@container grid gap-2">
              {rows.map((r, i) => (
                <li
                  key={i}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-control border border-line bg-sunken px-3 py-2 text-sm @lg:grid-cols-[6rem_minmax(0,1fr)_minmax(0,10rem)_auto]"
                >
                  <span className="font-medium text-fg">{r.network}</span>
                  <span className="col-start-1 truncate text-fg-muted @lg:col-start-auto" title={r.login}>
                    {r.login || "—"}
                  </span>
                  <span className="col-start-1 truncate font-mono text-fg-muted @lg:col-start-auto">
                    {show[i] ? (
                      r.password
                    ) : (
                      <>
                        <span aria-hidden="true">••••••••</span>
                        <span className="sr-only">Senha oculta</span>
                      </>
                    )}
                  </span>
                  <span className="col-start-2 row-span-3 row-start-1 @lg:col-start-auto @lg:row-span-1 @lg:row-start-auto">
                    <RevealButton
                      pressed={!!show[i]}
                      onToggle={() => toggleShow(i)}
                      label={`Mostrar senha de ${r.network}`}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {editing && (
        <div className="@container grid gap-4">
          {rows.map((r, i) => (
            <fieldset key={i} className="m-0 grid min-w-0 gap-3 rounded-control border border-line p-3 @lg:grid-cols-12 @lg:items-end">
              <legend className="sr-only">Credencial {i + 1}</legend>
              <Field label="Rede" className="@lg:col-span-3">
                <Input
                  value={r.network}
                  onChange={(e) => setRow(i, { network: e.target.value })}
                  disabled={busy}
                  autoComplete="off"
                  placeholder="Instagram"
                />
              </Field>
              <Field label="Login" className="@lg:col-span-4">
                <Input
                  value={r.login}
                  onChange={(e) => setRow(i, { login: e.target.value })}
                  disabled={busy}
                  autoComplete="off"
                  placeholder="usuário ou e-mail"
                />
              </Field>
              <Field label="Senha" className="@lg:col-span-4">
                <Input
                  type={show[i] ? "text" : "password"}
                  value={r.password}
                  onChange={(e) => setRow(i, { password: e.target.value })}
                  disabled={busy}
                  // não é a senha de quem está logado: o navegador não deve preencher nem oferecer salvar
                  autoComplete="new-password"
                  spellCheck={false}
                  className="font-mono"
                  trailingSlot={
                    <RevealButton
                      pressed={!!show[i]}
                      onToggle={() => toggleShow(i)}
                      label={`Mostrar senha da credencial ${i + 1}`}
                    />
                  }
                />
              </Field>
              <div className="@lg:col-span-1 @lg:justify-self-end">
                <Button
                  iconOnly
                  variant="ghost"
                  aria-label={`Remover credencial ${i + 1}`}
                  disabled={busy}
                  onClick={() => setRows((list) => list.filter((_, j) => j !== i))}
                >
                  <Icon.trash />
                </Button>
              </div>
            </fieldset>
          ))}

          <div>
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<Icon.plus />}
              disabled={busy}
              onClick={() => setRows((list) => [...list, { ...EMPTY_ROW }])}
            >
              Adicionar rede
            </Button>
          </div>

          {error && (
            <Callout tone="danger" live="assertive">
              {error}
            </Callout>
          )}

          <div className="flex flex-col-reverse gap-3 border-t border-line pt-4 sm:flex-row sm:justify-end">
            <Button variant="secondary" disabled={busy} onClick={cancel}>
              Cancelar
            </Button>
            <Button variant="primary" loading={busy} loadingText="Salvando…" onClick={() => void save()}>
              Salvar credenciais
            </Button>
          </div>
        </div>
      )}

      {error && !editing && (
        <Callout tone="danger" live="assertive" className="mt-3">
          {error}
        </Callout>
      )}
    </section>
  );
}
