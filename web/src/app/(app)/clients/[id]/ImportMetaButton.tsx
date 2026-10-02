"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BrandBadge } from "@/components/BrandIcons";
import { Button, Spinner } from "@/components/Button";
import { Dialog } from "@/components/Dialog";
import { Field, Input, Select } from "@/components/Field";
import { Icon } from "@/components/Icons";
import { Toast, type ToastState } from "@/components/Toast";
import { toUserMessage } from "@/lib/user-facing-error";

type Conn = { id: string; name: string };
type Asset = {
  pageId: string;
  pageName: string;
  instagramId: string | null;
  instagramUsername: string | null;
};

const LIST_ERROR =
  "Não foi possível listar as Páginas e as contas do Instagram desta conexão. Tente de novo em instantes.";

export default function ImportMetaButton({
  clientId,
  connections,
}: {
  clientId: string;
  connections: Conn[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [connId, setConnId] = useState(connections[0]?.id ?? "");
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [connectingId, setConnectingId] = useState("");
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  async function loadAssets(id: string, refresh = false) {
    setConnId(id);
    setAssets(null);
    setError("");
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/meta/connections/${id}/assets${refresh ? "?refresh=1" : ""}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(toUserMessage(data, LIST_ERROR));
        return;
      }
      setAssets(Array.isArray(data?.assets) ? data.assets : []);
    } catch {
      setError("Falha de conexão ao listar as páginas. Verifique a internet e tente de novo.");
    } finally {
      setLoading(false);
    }
  }

  // abre e já carrega as páginas da conexão pré-selecionada
  function openDialog() {
    setToast(null);
    setOpen(true);
    if (connId && assets === null && !loading) void loadAssets(connId);
  }

  function close() {
    setOpen(false);
    setError("");
    setQuery("");
  }

  async function connect(a: Asset) {
    setConnectingId(a.pageId);
    setError("");
    try {
      const res = await fetch("/api/meta/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          connectionId: connId,
          pageId: a.pageId,
          connectFacebook: true,
          connectInstagram: !!a.instagramId,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(toUserMessage(data, "Não foi possível vincular a Página. Tente de novo em instantes."));
        return;
      }

      // Recarrega os dados do servidor junto com o fechamento do diálogo: fechando
      // antes, a tela reaparecia com a contagem antiga ("0 contas") até um F5.
      // O Toast só aparece com o diálogo fechado (mesma renderização).
      const linked = ["Facebook", ...(a.instagramId ? ["Instagram"] : [])].join(" + ");
      setRefreshing(true);
      router.refresh();
      setToast({ kind: "success", text: `${linked} ${a.instagramId ? "vinculados" : "vinculado"} em ${a.pageName}` });
      close();
    } catch {
      setError("Falha de conexão ao vincular. Verifique a internet e tente de novo.");
    } finally {
      setConnectingId("");
      setRefreshing(false);
    }
  }

  const filtered =
    assets?.filter((a) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (
        a.pageName.toLowerCase().includes(q) ||
        a.pageId.includes(q) ||
        (a.instagramUsername ?? "").toLowerCase().includes(q)
      );
    }) ?? null;

  return (
    <>
      <Button
        loading={refreshing}
        loadingText="Atualizando…"
        leadingIcon={<BrandBadge platform="facebook" size={18} />}
        onClick={openDialog}
      >
        Importar do Meta
      </Button>

      <Toast toast={toast} onClose={() => setToast(null)} />

      <Dialog
        open={open}
        onClose={close}
        title="Importar conta do Meta"
        description="Escolha a conexão e vincule uma Página a este cliente."
        error={error}
        footer={<Button onClick={close}>Fechar</Button>}
      >
        {connections.length === 0 ? (
          <p className="py-6 text-center text-sm text-fg-muted">
            Nenhuma conexão com a Meta.{" "}
            <Link href="/meta" className="font-medium text-link underline underline-offset-2 hover:text-link-hover">
              Conecte um Gerenciador de Negócios
            </Link>{" "}
            primeiro.
          </p>
        ) : (
          <div className="grid gap-4 pb-2">
            <Field label="Conexão">
              <Select
                value={connId}
                placeholderOption="Selecione…"
                onChange={(e) => loadAssets(e.target.value)}
              >
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>

            {assets && assets.length > 0 && (
              <div className="flex items-end gap-2">
                <Field label="Buscar página" className="flex-1">
                  <Input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Nome, ID ou @instagram"
                    leadingIcon={<Icon.search />}
                  />
                </Field>
                <Button
                  iconOnly
                  aria-label="Buscar a lista atualizada na Meta"
                  title="Buscar a lista atualizada na Meta"
                  loading={loading}
                  onClick={() => loadAssets(connId, true)}
                >
                  <Icon.refresh />
                </Button>
              </div>
            )}

            {loading && (
              <p role="status" className="flex flex-col items-center gap-3 py-8 text-sm text-fg-muted">
                <Spinner size={20} />
                Carregando as Páginas do Gerenciador de Negócios…
              </p>
            )}

            {!loading && !connId && (
              <p className="py-8 text-center text-sm text-fg-muted">Selecione uma conexão para ver as páginas.</p>
            )}

            {!loading && assets && assets.length === 0 && (
              <p className="py-8 text-center text-sm text-fg-muted">Nenhuma Página nesta conexão.</p>
            )}

            {!loading && filtered && filtered.length === 0 && assets && assets.length > 0 && (
              <p className="py-8 text-center text-sm text-fg-muted">Nenhuma página corresponde a “{query}”.</p>
            )}

            {!loading && filtered && filtered.length > 0 && (
              <ul aria-label="Páginas da conexão" className="divide-y divide-line overflow-hidden rounded-card border border-line">
                {filtered.map((a) => (
                  <li key={a.pageId} className="flex items-center gap-3 px-4 py-3">
                    <BrandBadge platform="facebook" size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">{a.pageName}</p>
                      <p className="truncate font-mono text-xs text-fg-muted">{a.pageId}</p>
                      {a.instagramId ? (
                        <span className="mt-1 inline-flex items-center gap-1 text-xs text-fg-muted">
                          <BrandBadge platform="instagram" size={14} />@{a.instagramUsername ?? a.instagramId}
                        </span>
                      ) : (
                        <span className="mt-1 inline-block text-xs text-fg-muted">sem Instagram vinculado</span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="primary"
                      leadingIcon={<Icon.link />}
                      loading={connectingId === a.pageId}
                      loadingText="Vinculando…"
                      disabled={connectingId !== "" && connectingId !== a.pageId}
                      onClick={() => connect(a)}
                    >
                      Vincular<span className="sr-only"> {a.pageName}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
