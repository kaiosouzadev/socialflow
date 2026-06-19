"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icons";

type Folder = { id: string; name: string };

/**
 * Seletor visual de pasta do Google Drive. Lista as pastas-cliente sob a raiz
 * (via GET /api/drive/folders) e deixa escolher uma da lista — em vez de colar
 * o ID na mão. Mantém um fallback de "inserir ID manualmente" caso o Drive não
 * esteja configurado ou a pasta esteja em outro lugar.
 *
 * Uso controlado (editor):     <DriveFolderPicker value={id} onChange={setId} />
 * Uso com formulário (FormData): <DriveFolderPicker name="driveFolderId" />
 */
export default function DriveFolderPicker({
  name,
  value,
  defaultValue = "",
  onChange,
  fallbackName = "",
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  fallbackName?: string;
}) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue);
  const selectedId = isControlled ? (value as string) : internal;

  const [open, setOpen] = useState(false);
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState(true);
  const [search, setSearch] = useState("");
  const [manual, setManual] = useState(false);
  const loadedRef = useRef(false);

  function setSelected(id: string) {
    if (!isControlled) setInternal(id);
    onChange?.(id);
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/drive/folders");
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Falha ao carregar pastas");
      }
      setConfigured(data.configured !== false);
      setFolders(data.folders ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar pastas");
    } finally {
      setLoading(false);
    }
  }

  // carrega ao abrir, ou na montagem se já há um ID (para resolver o nome)
  useEffect(() => {
    if (!loadedRef.current && (open || selectedId)) {
      loadedRef.current = true;
      load();
    }
  }, [open, selectedId]);

  // fecha no Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const selectedFolder = folders?.find((f) => f.id === selectedId);
  const selectedLabel = selectedFolder?.name || fallbackName || selectedId;

  const filtered = (folders ?? []).filter((f) =>
    f.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div className="relative">
      {name && <input type="hidden" name={name} value={selectedId} />}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="input flex items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Icon.folder className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />
          <span className={`truncate ${selectedId ? "" : "text-[var(--color-text-faint)]"}`}>
            {selectedId ? selectedLabel : "Selecionar pasta do Drive…"}
          </span>
        </span>
        <Icon.chevronDown className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className="absolute left-0 right-0 top-full mt-2 z-40 rounded-xl border border-[var(--color-border-strong)] shadow-2xl animate-fade-up overflow-hidden"
            style={{
              background: "var(--color-surface-2)",
              boxShadow: "0 20px 50px -16px rgba(0,0,0,0.85), 0 1px 0 rgba(255,255,255,0.05) inset",
            }}
          >
            {/* Busca + atualizar */}
            <div className="flex items-center gap-2 p-2.5 border-b border-[var(--color-border)]">
              <div className="relative flex-1">
                <Icon.search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)] pointer-events-none" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar pasta…"
                  className="input !py-1.5 !pl-9 text-sm"
                  autoFocus
                />
              </div>
              <button
                type="button"
                onClick={load}
                disabled={loading}
                title="Atualizar lista"
                className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-white hover:bg-white/5 transition disabled:opacity-50"
              >
                <Icon.refresh className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>

            {/* Lista / estados */}
            <div className="max-h-64 overflow-y-auto p-1.5">
              {loading && (
                <p className="px-2 py-6 text-center text-sm text-[var(--color-text-muted)]">
                  Carregando pastas…
                </p>
              )}

              {!loading && error && (
                <div className="px-2 py-5 text-center">
                  <p className="text-sm text-red-400">{error}</p>
                  <button
                    type="button"
                    onClick={load}
                    className="mt-2 text-xs text-[var(--color-accent)] hover:underline"
                  >
                    Tentar de novo
                  </button>
                </div>
              )}

              {!loading && !error && !configured && (
                <p className="px-2 py-5 text-center text-sm text-amber-300">
                  Drive não configurado. Insira o ID da pasta manualmente abaixo.
                </p>
              )}

              {!loading && !error && configured && filtered.length === 0 && (
                <p className="px-2 py-6 text-center text-sm text-[var(--color-text-muted)]">
                  Nenhuma pasta encontrada.
                </p>
              )}

              {!loading &&
                !error &&
                configured &&
                filtered.map((f) => {
                  const active = f.id === selectedId;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        setSelected(f.id);
                        setOpen(false);
                      }}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-left transition ${
                        active
                          ? "bg-[var(--color-accent)]/15 text-white"
                          : "text-[var(--color-text-muted)] hover:text-white hover:bg-white/5"
                      }`}
                    >
                      <Icon.folder
                        className={`w-4 h-4 shrink-0 ${active ? "text-[var(--color-accent)]" : ""}`}
                      />
                      <span className="truncate flex-1">{f.name}</span>
                      {active && <Icon.check className="w-4 h-4 text-[var(--color-accent)] shrink-0" />}
                    </button>
                  );
                })}
            </div>

            {/* Rodapé: limpar + ID manual */}
            <div className="border-t border-[var(--color-border)] p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setManual((v) => !v)}
                  className="text-xs text-[var(--color-text-muted)] hover:text-white transition"
                >
                  {manual ? "Ocultar ID manual" : "Inserir ID manualmente"}
                </button>
                {selectedId && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelected("");
                      setSearch("");
                    }}
                    className="text-xs text-[var(--color-text-muted)] hover:text-red-400 transition"
                  >
                    Limpar seleção
                  </button>
                )}
              </div>
              {manual && (
                <input
                  value={selectedId}
                  onChange={(e) => setSelected(e.target.value.trim())}
                  placeholder="Cole o ID da pasta do Drive"
                  className="input font-mono text-xs !py-1.5"
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
