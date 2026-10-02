"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Spinner } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { Dialog } from "@/components/Dialog";
import { Icon } from "@/components/Icons";
import { ToneBadge } from "@/components/ui";
import { formatMonthLabel } from "@/lib/format-date";
import { toUserMessage } from "@/lib/user-facing-error";

/* Resposta de POST /api/drive/sync (contrato do S16, docs/08-DRIVE-ESTRUTURA.md). */
type Missing = { client: string; post: string; expected: string };
type Skipped = { client: string; reason: string };
type FolderLayout = { client: string; month: string; layout: "ano/mes" | "legado" | null; path: string };
type Ambiguous = { client: string; post?: string; path: string; chosen: string; candidates: string[] };
type SyncResult = {
  attached: number;
  checked: number;
  skipped: Skipped[];
  missing: Missing[];
  layout: FolderLayout[];
  ambiguous: Ambiguous[];
};

const SYNC_ERROR = "Não foi possível sincronizar as mídias agora. Tente de novo em instantes.";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const LEGACY_SUFFIX = / \(estrutura antiga\)$/;

const LAYOUT_BADGE: Record<"ano/mes" | "legado" | "none", { tone: "success" | "info" | "warning"; label: string }> = {
  "ano/mes": { tone: "success", label: "Ano/mês" },
  legado: { tone: "info", label: "Estrutura antiga" },
  none: { tone: "warning", label: "Pasta não encontrada" },
};

function summary(r: SyncResult): string {
  if (r.checked === 0) return "Nenhum post sem arte para buscar no Drive agora.";
  const checked = `${r.checked} ${plural(r.checked, "post verificado", "posts verificados")}`;
  if (r.attached === 0) return `Nenhuma arte nova anexada · ${checked}.`;
  return `${r.attached} ${plural(r.attached, "arte anexada", "artes anexadas")} · ${checked}.`;
}

function monthName(key: string): string {
  return /^\d{4}-\d{2}$/.test(key) ? formatMonthLabel(key) : key;
}

/** Sincroniza as artes do Drive do cliente e mostra onde procurou e o que faltou (S16). */
export default function SyncMediaButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState("");
  const open = !!result || !!error;

  async function sync() {
    // o botão continua focável enquanto sincroniza (o foco volta a ele quando o resultado fecha)
    if (busy) return;
    setBusy(true);
    setResult(null);
    setError("");
    try {
      const res = await fetch("/api/drive/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(toUserMessage(data, SYNC_ERROR));
        return;
      }
      setResult({
        attached: typeof data?.attached === "number" ? data.attached : 0,
        checked: typeof data?.checked === "number" ? data.checked : 0,
        skipped: list<Skipped>(data?.skipped),
        missing: list<Missing>(data?.missing),
        layout: list<FolderLayout>(data?.layout),
        ambiguous: list<Ambiguous>(data?.ambiguous),
      });
      router.refresh();
    } catch {
      setError("Falha de conexão ao sincronizar. Verifique a internet e tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setResult(null);
    setError("");
  }

  return (
    <>
      <Button
        aria-busy={busy || undefined}
        leadingIcon={busy ? <Spinner size={16} /> : <Icon.refresh />}
        onClick={sync}
      >
        {busy ? "Sincronizando…" : "Sincronizar mídia"}
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title="Sincronização de mídia"
        description={result ? summary(result) : "A sincronização não foi concluída."}
        footer={
          <Button variant="primary" onClick={close}>
            Fechar
          </Button>
        }
      >
        {error ? (
          <div className="pb-2">
            <Callout tone="danger" live="assertive">
              {error}
            </Callout>
          </div>
        ) : result ? (
          <div className="grid gap-5 pb-2 text-sm text-fg">
            {result.layout.length > 0 && (
              <section aria-labelledby="sync-pastas" className="grid gap-2">
                <h3 id="sync-pastas" className="font-semibold">
                  Pastas do mês no Drive
                </h3>
                <ul className="grid gap-2">
                  {result.layout.map((l) => {
                    const badge = LAYOUT_BADGE[l.layout ?? "none"];
                    return (
                      <li key={`${l.client}:${l.month}`} className="grid gap-1 rounded-control border border-line bg-sunken p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{monthName(l.month)}</span>
                          <ToneBadge tone={badge.tone}>{badge.label}</ToneBadge>
                        </div>
                        <p className="text-fg-muted">
                          {l.layout ? "Pasta usada: " : "Esperada: "}
                          <span className="break-all font-mono text-fg">{l.path.replace(LEGACY_SUFFIX, "")}</span>
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {result.missing.length > 0 && (
              <section aria-labelledby="sync-faltando" className="grid gap-2">
                <h3 id="sync-faltando" className="font-semibold">
                  Sem arte no Drive ({result.missing.length})
                </h3>
                <ul className="grid gap-1.5">
                  {result.missing.map((mi, i) => (
                    <li key={i}>
                      <span className="font-medium">{mi.post}</span>
                      <span className="text-fg-muted"> · esperado: </span>
                      <span className="break-all font-mono">{mi.expected}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {result.ambiguous.length > 0 && (
              <section aria-labelledby="sync-ambiguos" className="grid gap-2">
                <h3 id="sync-ambiguos" className="font-semibold">
                  Mais de uma opção ({result.ambiguous.length})
                </h3>
                <p className="text-fg-muted">Deixe só uma pasta ou arquivo para evitar surpresa.</p>
                <ul className="grid gap-1.5">
                  {result.ambiguous.map((a, i) => (
                    <li key={i}>
                      {a.post && <span className="font-medium">{a.post} · </span>}
                      em <span className="break-all font-mono">{a.path}</span>: usada{" "}
                      <span className="break-all font-mono">{a.chosen}</span>
                      {a.candidates.length > 0 && (
                        <span className="text-fg-muted">
                          {" "}
                          (opções: <span className="break-all font-mono">{a.candidates.join(", ")}</span>)
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {result.skipped.length > 0 && (
              <section aria-labelledby="sync-ignorados" className="grid gap-2">
                <h3 id="sync-ignorados" className="font-semibold">
                  Não verificados ({result.skipped.length})
                </h3>
                <ul className="grid gap-1.5">
                  {result.skipped.map((s, i) => (
                    <li key={i} className="text-fg-muted">
                      {s.reason}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {result.missing.length === 0 && result.ambiguous.length === 0 && result.skipped.length === 0 && (
              <Callout tone="success">Tudo certo: nenhuma arte faltando no Drive.</Callout>
            )}
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
