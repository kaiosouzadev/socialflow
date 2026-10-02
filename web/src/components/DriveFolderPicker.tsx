"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button, Spinner } from "./Button";
import { Callout } from "./Callout";
import { Field, Input, useFieldControl } from "./Field";
import { Icon } from "./Icons";
import { Popover } from "./Popover";
import { toUserMessage } from "@/lib/user-facing-error";

type Folder = { id: string; name: string };

/**
 * Texto de ajuda da pasta do cliente, com a estrutura do Drive
 * (docs/08-DRIVE-ESTRUTURA.md: Raiz / Cliente / AAAA / MM - Mês / {N.jpg, Nstory.jpg, N/}).
 * Use em componentes de cliente (ex.: `help` de um <Field>).
 */
export const DRIVE_FOLDER_HELP =
  "Escolha a pasta do cliente. Dentro dela: AAAA/MM - Mês/1.jpg, 1story.jpg, 2/ (carrossel)";

const LOAD_ERROR = "Não foi possível carregar as pastas do Drive. Tente de novo em instantes.";
const NETWORK_ERROR = "Falha de conexão ao carregar as pastas do Drive. Verifique a internet e tente de novo.";

/** O mesmo texto de DRIVE_FOLDER_HELP, com os nomes de pasta e arquivo em fonte mono. */
function DriveHelpText() {
  const mono = "font-mono text-fg";
  return (
    <>
      Escolha a pasta do cliente. Dentro dela: <span className={mono}>AAAA/MM - Mês/1.jpg</span>,{" "}
      <span className={mono}>1story.jpg</span>, <span className={mono}>2/</span> (carrossel)
    </>
  );
}

/**
 * Seletor visual de pasta do Google Drive. Lista as pastas-cliente sob a raiz
 * (via GET /api/drive/folders) e deixa escolher uma da lista — em vez de colar
 * o ID na mão. Mantém um fallback de "inserir ID manualmente" caso o Drive não
 * esteja configurado ou a pasta esteja em outro lugar. O painel é um Popover
 * (portal, Esc, clique fora). A ajuda com a estrutura das pastas aparece sob o
 * gatilho, a menos que o <Field> em volta já tenha a sua.
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
  id,
  disabled = false,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  fallbackName?: string;
  /** id do gatilho (para <label htmlFor>) */
  id?: string;
  disabled?: boolean;
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
  const triggerRef = useRef<HTMLButtonElement>(null);

  const field = useFieldControl();
  const panelId = useId();
  const valueId = useId();
  const helpId = useId();
  // o <Field> em volta já mostra uma ajuda? então não repete a nossa
  const fieldHasHelp = !!field?.describedBy?.split(" ").includes(`${field.id}-help`);

  function setSelected(next: string) {
    if (!isControlled) setInternal(next);
    onChange?.(next);
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/drive/folders").catch(() => null);
      if (!res) {
        setError(NETWORK_ERROR);
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(toUserMessage(data, LOAD_ERROR));
        return;
      }
      setConfigured(data?.configured !== false);
      setFolders(Array.isArray(data?.folders) ? data.folders : []);
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

  const selectedFolder = folders?.find((f) => f.id === selectedId);
  const selectedLabel = selectedFolder?.name || fallbackName || selectedId;

  const filtered = (folders ?? []).filter((f) =>
    f.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  const look = disabled
    ? "cursor-not-allowed border-line bg-disabled text-fg-disabled"
    : field?.invalid
      ? "border-danger-solid bg-surface"
      : "border-line-strong bg-surface hover:border-fg-muted";

  return (
    <div>
      {name && <input type="hidden" name={name} value={selectedId} />}

      <button
        ref={triggerRef}
        type="button"
        id={id ?? field?.id}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-labelledby={field ? `${field.labelId} ${valueId}` : undefined}
        aria-describedby={[field?.describedBy, fieldHasHelp ? null : helpId].filter(Boolean).join(" ") || undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-11 w-full items-center justify-between gap-2 rounded-control border px-3 text-left text-base transition-colors duration-(--sf-dur-fast) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus sm:h-10 sm:text-sm ${look}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Icon.folder className="size-4 shrink-0 text-fg-muted" />
          <span
            id={valueId}
            className={`truncate ${disabled ? "text-fg-disabled" : selectedId ? "text-fg" : "text-fg-faint"}`}
          >
            {selectedId ? selectedLabel : "Selecionar pasta do Drive…"}
          </span>
        </span>
        <Icon.chevronDown className="size-4 shrink-0 text-fg-muted" />
      </button>

      {!fieldHasHelp && (
        <p id={helpId} className="mt-1.5 text-xs text-fg-muted">
          <DriveHelpText />
        </p>
      )}

      <Popover
        open={open}
        onOpenChange={setOpen}
        anchorRef={triggerRef}
        id={panelId}
        aria-label="Escolher pasta do Drive"
        matchAnchorWidth
        className="min-w-72"
      >
        {/* Busca + atualizar */}
        <div className="flex items-end gap-2">
          <Field label="Buscar pasta" labelHidden className="min-w-0 flex-1">
            <Input
              size="sm"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar pasta…"
              leadingIcon={<Icon.search />}
            />
          </Field>
          <Button iconOnly variant="ghost" size="sm" aria-label="Atualizar lista" loading={loading} onClick={load}>
            <Icon.refresh />
          </Button>
        </div>

        {/* Lista / estados */}
        <div aria-busy={loading || undefined} className="-mx-1 mt-2 max-h-64 overflow-y-auto px-1">
          {loading && (
            <p className="flex items-center justify-center gap-2 py-6 text-sm text-fg-muted">
              <Spinner size={16} />
              Carregando pastas…
            </p>
          )}

          {!loading && error && (
            <Callout
              tone="danger"
              live="polite"
              action={
                <Button size="sm" onClick={load}>
                  Tentar de novo
                </Button>
              }
            >
              {error}
            </Callout>
          )}

          {!loading && !error && !configured && (
            <Callout tone="info">
              O Google Drive não está configurado no servidor. Cole o ID da pasta em “Inserir ID manualmente”, abaixo.
            </Callout>
          )}

          {!loading && !error && configured && folders !== null && filtered.length === 0 && (
            <p className="py-6 text-center text-sm text-fg-muted">Nenhuma pasta encontrada.</p>
          )}

          {!loading && !error && configured && filtered.length > 0 && (
            <ul aria-label="Pastas do Drive" className="space-y-0.5">
              {filtered.map((f) => {
                const active = f.id === selectedId;
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setSelected(f.id);
                        setOpen(false);
                        triggerRef.current?.focus();
                      }}
                      className={`flex min-h-10 w-full items-center gap-2.5 rounded-control px-2.5 text-left text-sm transition-colors duration-(--sf-dur-fast) sm:min-h-9 ${
                        active ? "bg-selected font-medium text-on-selected" : "text-fg hover:bg-hover"
                      }`}
                    >
                      <Icon.folder className={`size-4 shrink-0 ${active ? "" : "text-fg-muted"}`} />
                      <span className="flex-1 truncate">{f.name}</span>
                      {active && <Icon.check className="size-4 shrink-0" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Rodapé: limpar + ID manual */}
        <div className="mt-2 space-y-2 border-t border-line pt-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" size="sm" aria-expanded={manual} onClick={() => setManual((v) => !v)}>
              {manual ? "Ocultar ID manual" : "Inserir ID manualmente"}
            </Button>
            {selectedId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelected("");
                  setSearch("");
                }}
              >
                Limpar seleção
              </Button>
            )}
          </div>
          {manual && (
            <Field label="ID da pasta no Drive">
              <Input
                size="sm"
                value={selectedId}
                onChange={(e) => setSelected(e.target.value.trim())}
                placeholder="Cole o ID da pasta do Drive"
                className="font-mono"
              />
            </Field>
          )}
        </div>
      </Popover>
    </div>
  );
}
