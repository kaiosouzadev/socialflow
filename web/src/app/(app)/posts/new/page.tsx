"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PageHeader, PlatformChip } from "@/components/ui";
import { Icon } from "@/components/Icons";
import { CaptionFields } from "@/components/CaptionFields";
import { DateTimePicker } from "@/components/DatePickers";
import { spNowLocalInput, spLocalInputToISO } from "@/lib/format-date";

type Client = { id: string; name: string; email: string };
type Account = { id: string; platform: string; status: string };

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
};

function NewPostForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselected = searchParams.get("clientId") ?? "";

  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState(preselected);

  // accounts tagged with the client they belong to, so loading/visibility
  // can be derived without setting state synchronously inside an effect
  const [accountsData, setAccountsData] = useState<{
    clientId: string;
    accounts: Account[];
  } | null>(null);
  const [targets, setTargets] = useState<string[]>([]);

  const [theme, setTheme] = useState("");
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // load clients once
  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then(setClients)
      .catch(() => setClients([]));
  }, []);

  // when a client is chosen, fetch its connected accounts and auto-select networks
  useEffect(() => {
    if (!clientId) return;

    let cancelled = false;

    fetch(`/api/clients/${clientId}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const accs: Account[] = (data.socialAccounts ?? []).filter(
          (a: Account) => a.status === "active"
        );
        setAccountsData({ clientId, accounts: accs });
        // auto-define: all active platforms selected by default
        setTargets(Array.from(new Set(accs.map((a) => a.platform))));
      })
      .catch(() => {
        if (!cancelled) setAccountsData({ clientId, accounts: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  // derive loading/visibility from whether data matches the current client
  const loadingAccounts = !!clientId && accountsData?.clientId !== clientId;
  const visibleAccounts =
    accountsData?.clientId === clientId ? accountsData.accounts : null;
  const availablePlatforms = Array.from(
    new Set((visibleAccounts ?? []).map((a) => a.platform))
  );

  function toggleTarget(p: string) {
    setTargets((prev) => (prev.includes(p) ? prev.filter((t) => t !== p) : [...prev, p]));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    if (!clientId) {
      setError("Selecione um cliente primeiro.");
      return;
    }
    if (targets.length === 0) {
      setError("Selecione ao menos uma rede social.");
      return;
    }

    setSubmitting(true);
    const form = new FormData(e.currentTarget);
    const captionsForTargets = Object.fromEntries(
      targets.map((t) => [t, captions[t] ?? ""]).filter(([, v]) => v)
    );
    const data = {
      clientId,
      theme,
      captions: captionsForTargets,
      mediaUrl: form.get("mediaUrl") as string,
      scheduledAt: spLocalInputToISO(form.get("scheduledAt") as string),
      targets,
    };

    const res = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    setSubmitting(false);

    if (!res.ok) {
      setError("Não foi possível criar o post. Verifique os campos.");
      return;
    }

    router.push("/posts");
    router.refresh();
  }

  const [nowLocal] = useState(() => spNowLocalInput());

  return (
    <div className="p-8 max-w-2xl mx-auto animate-fade-up">
      <PageHeader title="Novo post" back="/posts" />

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Step 1 — Client (mandatory, first) */}
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold text-white bg-[var(--color-accent)]">
              1
            </span>
            <h2 className="font-semibold">Cliente</h2>
          </div>

          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            required
            className="input"
          >
            <option value="">Selecione um cliente</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Step 2 — Networks (auto-defined from client) */}
        <div className={`card p-6 transition-opacity ${clientId ? "" : "opacity-40 pointer-events-none"}`}>
          <div className="flex items-center gap-2 mb-4">
            <span className="flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold text-white bg-[var(--color-accent)]">
              2
            </span>
            <h2 className="font-semibold">Redes sociais</h2>
            <span className="text-xs text-[var(--color-text-faint)]">
              definidas pelas contas do cliente
            </span>
          </div>

          {!clientId ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              Selecione um cliente para ver as redes disponíveis.
            </p>
          ) : loadingAccounts ? (
            <p className="text-sm text-[var(--color-text-muted)]">Carregando contas...</p>
          ) : availablePlatforms.length === 0 ? (
            <div className="flex items-start gap-3 rounded-lg bg-amber-500/[0.07] border border-amber-500/20 px-4 py-3">
              <Icon.alert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-200/90">
                Este cliente não tem contas ativas conectadas.{" "}
                <Link href={`/clients/${clientId}/accounts/new`} className="underline">
                  Adicionar uma conta
                </Link>{" "}
                antes de agendar.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {availablePlatforms.map((p) => {
                const on = targets.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => toggleTarget(p)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                      on
                        ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-white"
                        : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)]"
                    }`}
                  >
                    <PlatformChip platform={p} />
                    {PLATFORM_LABEL[p] ?? p}
                    {on && <Icon.check className="w-4 h-4 text-[var(--color-accent)]" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Step 3 — Content */}
        <div className={`card p-6 space-y-5 transition-opacity ${clientId && availablePlatforms.length > 0 ? "" : "opacity-40 pointer-events-none"}`}>
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold text-white bg-[var(--color-accent)]">
              3
            </span>
            <h2 className="font-semibold">Conteúdo</h2>
          </div>

          <div>
            <label className="label">Tema</label>
            <input
              name="theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              className="input"
              placeholder="Ex: Lançamento produto X"
            />
          </div>

          <CaptionFields
            clientId={clientId}
            theme={theme}
            targets={targets}
            captions={captions}
            setCaptions={setCaptions}
            aiDisabled={!clientId}
          />

          <div>
            <label className="label">
              URL da mídia{" "}
              <span className="text-[var(--color-text-faint)] font-normal">
                (imagem ou vídeo público)
              </span>
            </label>
            <input
              name="mediaUrl"
              type="url"
              className="input"
              placeholder="https://exemplo.com/imagem.jpg"
            />
          </div>

          <div>
            <label className="label">Agendar para</label>
            <DateTimePicker name="scheduledAt" defaultValue={nowLocal} required />
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <Link href="/posts" className="btn-ghost flex-1">
            Cancelar
          </Link>
          <button
            type="submit"
            disabled={submitting || !clientId || targets.length === 0}
            className="btn-primary flex-1"
          >
            <Icon.send className="w-4 h-4" />
            {submitting ? "Agendando..." : "Agendar post"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function NewPostPage() {
  return (
    <Suspense>
      <NewPostForm />
    </Suspense>
  );
}
