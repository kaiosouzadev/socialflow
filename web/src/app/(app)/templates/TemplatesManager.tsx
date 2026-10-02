"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { MonthPicker, TimePicker } from "@/components/DatePickers";
import { ConfirmDialog } from "@/components/Dialog";
import { Field, Input } from "@/components/Field";
import { Icon } from "@/components/Icons";
import { Toast, type ToastState } from "@/components/Toast";
import { EmptyState, ToneBadge } from "@/components/ui";
import { formatMonthLabel } from "@/lib/format-date";
import { toUserMessage } from "@/lib/user-facing-error";

type Template = {
  id: string;
  name: string;
  month: string | null;
  day: number | null;
  time: string | null;
  baseImageUrl: string;
  active: boolean;
};

const OFFLINE = "Sem conexão com o servidor. Verifique a internet e tente de novo.";
const SESSION_EXPIRED = "Sua sessão expirou. Entre de novo para continuar.";

/** Imagens aceitas pelo /api/upload (8 MB). */
const ACCEPT = "image/png,image/jpeg,image/webp";
const MAX_BYTES = 8 * 1024 * 1024;

/** Texto da API só quando é string (N-14), sem detalhe técnico; senão o texto da tela. */
function apiMessage(status: number, data: unknown, fallback: string): string {
  if (status === 401) return SESSION_EXPIRED;
  return toUserMessage(data, fallback);
}

/** Problema do arquivo escolhido (antes de enviar), ou null se serve. */
function fileProblem(file: File): string | null {
  if (!ACCEPT.split(",").includes(file.type)) return "Use uma imagem PNG, JPG ou WebP.";
  if (file.size > MAX_BYTES) return "A imagem passa de 8 MB. Use um arquivo menor.";
  return null;
}

async function uploadImage(file: File): Promise<{ url: string } | { error: string }> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("kind", "template");
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  const data: unknown = await res.json().catch(() => null);
  const url = (data as { url?: unknown } | null)?.url;
  if (res.ok && typeof url === "string") return { url };
  return { error: apiMessage(res.status, data, "Não foi possível enviar a imagem. Tente de novo em instantes.") };
}

function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const pad = (n: number) => String(n).padStart(2, "0");

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Quando a arte entra no calendário: "05/11 às 18:00", ou o motivo de ficar fora. */
function whenLabel(t: Template): string {
  if (!t.day) return "Sem dia: fica fora do calendário automático";
  const time = t.time ?? "18:00";
  if (!t.month) return `Dia ${pad(t.day)} às ${time} · sem mês, fica fora do calendário automático`;
  return `${pad(t.day)}/${t.month.slice(5, 7)} às ${time}`;
}

function focusById(id: string) {
  document.getElementById(id)?.focus();
}

/** Primeiro campo com erro, na ordem da tela. */
function firstError<K extends string>(errors: Partial<Record<K, string>>, order: readonly K[]): K | undefined {
  return order.find((k) => errors[k]);
}

/**
 * Upload por teclado (A-006): um <button> abre o seletor via inputRef.click();
 * o <input type=file> fica fora da ordem de Tab.
 */
function FilePick({
  id,
  label,
  changeLabel,
  help,
  file,
  error,
  disabled,
  onPick,
}: {
  id: string;
  label: string;
  changeLabel: string;
  help: string;
  file: File | null;
  error?: string;
  disabled?: boolean;
  onPick: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          id={id}
          variant="secondary"
          leadingIcon={<Icon.upload />}
          aria-describedby={error ? `${helpId} ${errorId}` : helpId}
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          {file ? changeLabel : label}
        </Button>
        {file && (
          <span className="min-w-0 max-w-full truncate text-sm text-fg-muted" title={file.name}>
            {file.name}
          </span>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          tabIndex={-1}
          aria-hidden="true"
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            // limpa para o mesmo arquivo poder ser escolhido de novo
            e.target.value = "";
            if (picked) onPick(picked);
          }}
        />
      </div>
      <p id={helpId} className="text-xs text-fg-muted">
        {help}
      </p>
      {error && (
        <p id={errorId} className="flex items-start gap-1 text-xs font-medium text-danger-fg">
          <span aria-hidden="true" className="mt-px inline-flex size-3.5 shrink-0 text-danger-solid [&>svg]:size-full">
            <Icon.alert />
          </span>
          {error}
        </p>
      )}
    </div>
  );
}

type GenErrors = Partial<Record<"month" | "count" | "file", string>>;
type NewErrors = Partial<Record<"name" | "day" | "file", string>>;

const GEN_IDS = { month: "tpl-gen-month", count: "tpl-gen-count", file: "tpl-gen-file" } as const;
const NEW_IDS = { name: "tpl-name", day: "tpl-day", file: "tpl-file" } as const;

export default function TemplatesManager({ initial }: { initial: Template[] }) {
  const router = useRouter();
  const [toast, setToast] = useState<ToastState>(null);

  // gerar mês inteiro com IA (títulos + legendas padronizadas + arte-base do mês)
  const [genMonth, setGenMonth] = useState("");
  const [genCount, setGenCount] = useState("12");
  const [genFile, setGenFile] = useState<File | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [genErrors, setGenErrors] = useState<GenErrors>({});
  const [genError, setGenError] = useState<string | null>(null);

  // nova arte-base avulsa
  const [name, setName] = useState("");
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [time, setTime] = useState("18:00");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [newErrors, setNewErrors] = useState<NewErrors>({});
  const [newError, setNewError] = useState<string | null>(null);

  // ativar/desativar e excluir
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Template | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function generateMonth(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const errors: GenErrors = {};
    if (!genMonth) errors.month = "Escolha o mês das artes.";
    const count = Number(genCount);
    if (!genCount || !Number.isInteger(count) || count < 1 || count > 31) errors.count = "Use um número de 1 a 31.";
    if (!genFile) errors.file = "Selecione a arte-base do mês.";
    setGenErrors(errors);
    setGenError(null);
    const first = firstError(errors, ["month", "count", "file"] as const);
    if (first || !genFile) {
      if (first) focusById(GEN_IDS[first]);
      return;
    }

    setGenBusy(true);
    try {
      const up = await uploadImage(genFile);
      if ("error" in up) {
        setGenError(up.error);
        return;
      }
      const res = await fetch("/api/art-templates/generate-month", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: genMonth, baseImageUrl: up.url, count }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setGenError(apiMessage(res.status, data, "Não foi possível gerar as artes do mês. Tente de novo em instantes."));
        return;
      }
      const created = (data as { created?: unknown } | null)?.created;
      const n = typeof created === "number" ? created : count;
      setGenFile(null);
      setToast({
        kind: "success",
        text: `${plural(n, "arte criada", "artes criadas")} para ${formatMonthLabel(genMonth)}, com títulos e legendas padronizadas.`,
      });
      router.refresh();
    } catch {
      setGenError(OFFLINE);
    } finally {
      setGenBusy(false);
    }
  }

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const errors: NewErrors = {};
    if (!name.trim()) errors.name = "Informe o título da postagem.";
    const dayNum = day ? Number(day) : null;
    if (dayNum !== null) {
      const max = month ? daysInMonth(month) : 31;
      if (dayNum < 1 || dayNum > max) {
        errors.day = month ? `${formatMonthLabel(month)} tem ${max} dias: use de 1 a ${max}.` : "Use um dia de 1 a 31.";
      }
    }
    if (!file) errors.file = "Selecione a imagem-base.";
    setNewErrors(errors);
    setNewError(null);
    const first = firstError(errors, ["name", "day", "file"] as const);
    if (first || !file) {
      if (first) focusById(NEW_IDS[first]);
      return;
    }

    setBusy(true);
    try {
      const up = await uploadImage(file);
      if ("error" in up) {
        setNewError(up.error);
        return;
      }
      const title = name.trim();
      const res = await fetch("/api/art-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: title,
          month: month || undefined,
          day: dayNum,
          time: time || undefined,
          baseImageUrl: up.url,
        }),
      });
      if (!res.ok) {
        const data: unknown = await res.json().catch(() => null);
        setNewError(apiMessage(res.status, data, "Não foi possível adicionar a arte-base. Tente de novo."));
        return;
      }
      // mês e hora ficam, para cadastrar várias artes do mesmo mês em seguida
      setName("");
      setDay("");
      setFile(null);
      setToast({ kind: "success", text: `Arte-base “${title}” adicionada.` });
      router.refresh();
    } catch {
      setNewError(OFFLINE);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(t: Template) {
    setTogglingId(t.id);
    try {
      const res = await fetch(`/api/art-templates/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !t.active }),
      });
      if (!res.ok) {
        const data: unknown = await res.json().catch(() => null);
        const fallback = `Não foi possível ${t.active ? "desativar" : "ativar"} a arte-base. Tente de novo.`;
        setToast({
          kind: "error",
          text: res.status === 404 ? "Esta arte-base já não existe. Atualize a página." : apiMessage(res.status, data, fallback),
        });
        return;
      }
      router.refresh();
    } catch {
      setToast({ kind: "error", text: OFFLINE });
    } finally {
      setTogglingId(null);
    }
  }

  // exclusão só depois do ConfirmDialog; erro fica dentro do diálogo e o item continua (H-05)
  async function remove() {
    if (!removing) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/art-templates/${removing.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data: unknown = await res.json().catch(() => null);
        setDeleteError(
          res.status === 404
            ? "Esta arte-base já não existe. Feche e atualize a página."
            : apiMessage(res.status, data, "Não foi possível excluir a arte-base. Tente de novo."),
        );
        return;
      }
      const removedName = removing.name;
      setRemoving(null);
      setToast({ kind: "success", text: `Arte-base “${removedName}” excluída.` });
      router.refresh();
    } catch {
      setDeleteError(OFFLINE);
    } finally {
      setDeleting(false);
    }
  }

  // agrupa por mês (itens sem mês = "avulsas")
  const groups = new Map<string, Template[]>();
  for (const t of initial) {
    const key = t.month ?? "";
    const arr = groups.get(key) ?? [];
    arr.push(t);
    groups.set(key, arr);
  }
  const orderedKeys = [...groups.keys()].sort((a, b) => {
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b);
  });

  const removingInCalendar = !!removing && removing.active && !!removing.month && !!removing.day;

  return (
    <div className="grid gap-6">
      {/* gerar mês inteiro com IA */}
      <form noValidate onSubmit={generateMonth} aria-labelledby="tpl-gen-title" className="card p-4 sm:p-6">
        <h2 id="tpl-gen-title" className="flex items-center gap-2 font-display text-lg font-semibold tracking-title text-fg">
          <span aria-hidden="true" className="inline-flex size-4.5 text-fg-muted [&>svg]:size-full">
            <Icon.zap />
          </span>
          Gerar mês com IA
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          Igual ao calendário dos clientes completos: a IA cria os títulos do mês e as legendas padronizadas, todos com
          a mesma arte-base. As datas caem em seg, qua e sex, nunca no passado.
        </p>

        {genError && (
          <Callout tone="danger" live="assertive" className="mt-4">
            {genError}
          </Callout>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field id={GEN_IDS.month} label="Mês" required error={genErrors.month}>
            <MonthPicker
              value={genMonth}
              disabled={genBusy}
              onChange={(v) => {
                setGenMonth(v);
                setGenErrors((s) => ({ ...s, month: undefined }));
              }}
            />
          </Field>
          <Field id={GEN_IDS.count} label="Qtd. de posts" help="De 1 a 31." error={genErrors.count}>
            <Input
              value={genCount}
              inputMode="numeric"
              autoComplete="off"
              disabled={genBusy}
              onChange={(e) => {
                setGenCount(e.target.value.replace(/\D/g, "").slice(0, 2));
                setGenErrors((s) => ({ ...s, count: undefined }));
              }}
            />
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <FilePick
            id={GEN_IDS.file}
            label="Arte-base do mês"
            changeLabel="Trocar arte-base"
            help="PNG, JPG ou WebP, até 8 MB. Vale para todos os posts do mês."
            file={genFile}
            error={genErrors.file}
            disabled={genBusy}
            onPick={(f) => {
              const problem = fileProblem(f);
              setGenFile(problem ? null : f);
              setGenErrors((s) => ({ ...s, file: problem ?? undefined }));
            }}
          />
          <Button
            type="submit"
            variant="primary"
            leadingIcon={<Icon.zap />}
            loading={genBusy}
            loadingText="Gerando…"
            className="w-full sm:w-auto"
          >
            Gerar artes do mês
          </Button>
        </div>
      </form>

      {/* nova arte-base */}
      <form noValidate onSubmit={create} aria-labelledby="tpl-new-title" className="card p-4 sm:p-6">
        <h2 id="tpl-new-title" className="font-display text-lg font-semibold tracking-title text-fg">
          Nova arte do calendário básico
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          Mesmo título e layout para todos os clientes básicos; a IA personaliza logo, cores e contatos. Com mês e dia
          preenchidos, a arte entra no calendário automático.
        </p>

        {newError && (
          <Callout tone="danger" live="assertive" className="mt-4">
            {newError}
          </Callout>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field id={NEW_IDS.name} label="Título da postagem" required error={newErrors.name} className="sm:col-span-2">
            <Input
              value={name}
              placeholder="Ex.: Dia dos Pais — homenagem"
              disabled={busy}
              onChange={(e) => {
                setName(e.target.value);
                setNewErrors((s) => ({ ...s, name: undefined }));
              }}
            />
          </Field>
          <Field id="tpl-month" label="Mês" optional>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <MonthPicker
                  value={month}
                  disabled={busy}
                  onChange={(v) => {
                    setMonth(v);
                    setNewErrors((s) => ({ ...s, day: undefined }));
                  }}
                />
              </div>
              {month && (
                <Button
                  iconOnly
                  variant="ghost"
                  aria-label="Limpar mês"
                  title="Limpar mês"
                  disabled={busy}
                  onClick={() => {
                    setMonth("");
                    setNewErrors((s) => ({ ...s, day: undefined }));
                    focusById("tpl-month");
                  }}
                >
                  <Icon.x />
                </Button>
              )}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id={NEW_IDS.day} label="Dia" optional error={newErrors.day}>
              <Input
                value={day}
                placeholder="10"
                inputMode="numeric"
                autoComplete="off"
                disabled={busy}
                onChange={(e) => {
                  setDay(e.target.value.replace(/\D/g, "").slice(0, 2));
                  setNewErrors((s) => ({ ...s, day: undefined }));
                }}
              />
            </Field>
            <Field id="tpl-time" label="Hora">
              <TimePicker value={time} onChange={setTime} disabled={busy} />
            </Field>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <FilePick
            id={NEW_IDS.file}
            label="Selecionar imagem-base"
            changeLabel="Trocar imagem"
            help="PNG, JPG ou WebP, até 8 MB."
            file={file}
            error={newErrors.file}
            disabled={busy}
            onPick={(f) => {
              const problem = fileProblem(f);
              setFile(problem ? null : f);
              setNewErrors((s) => ({ ...s, file: problem ?? undefined }));
            }}
          />
          <Button
            type="submit"
            variant="primary"
            leadingIcon={<Icon.plus />}
            loading={busy}
            loadingText="Salvando…"
            className="w-full sm:w-auto"
          >
            Adicionar arte-base
          </Button>
        </div>
      </form>

      {/* banco de artes por mês */}
      <section aria-labelledby="tpl-list-title" className="grid gap-4">
        <h2 id="tpl-list-title" className="font-display text-lg font-semibold tracking-title text-fg">
          Banco de artes
        </h2>
        {initial.length === 0 ? (
          <EmptyState
            headingLevel={3}
            icon={<Icon.folder />}
            title="Nenhuma arte-base cadastrada"
            description="Gere o mês com IA ou adicione uma arte acima. Com mês e dia, ela entra no calendário dos clientes básicos."
          />
        ) : (
          orderedKeys.map((key) => {
            const items = [...(groups.get(key) ?? [])].sort((a, b) => (a.day ?? 99) - (b.day ?? 99));
            const headingId = `tpl-group-${key || "avulsas"}`;
            return (
              <section key={key || "avulsas"} aria-labelledby={headingId}>
                <h3 id={headingId} className="mb-3 text-sm font-semibold text-fg">
                  {key ? formatMonthLabel(key) : "Avulsas (sem mês)"}
                  <span className="font-normal text-fg-muted"> · {plural(items.length, "arte", "artes")}</span>
                </h3>
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((t) => (
                    <li key={t.id} className="card overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={t.baseImageUrl} alt="" loading="lazy" className="aspect-square w-full bg-sunken object-cover" />
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="line-clamp-2 min-w-0 font-medium text-fg" title={t.name}>
                            {t.name}
                          </h4>
                          <ToneBadge tone={t.active ? "success" : "neutral"}>{t.active ? "Ativa" : "Inativa"}</ToneBadge>
                        </div>
                        <p className="mt-0.5 text-sm text-fg-muted">{whenLabel(t)}</p>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`${t.active ? "Desativar" : "Ativar"} ${t.name}`}
                            loading={togglingId === t.id}
                            onClick={() => void toggle(t)}
                          >
                            {t.active ? "Desativar" : "Ativar"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            leadingIcon={<Icon.trash />}
                            aria-label={`Excluir ${t.name}`}
                            onClick={() => {
                              setDeleteError(null);
                              setRemoving(t);
                            }}
                          >
                            Excluir
                          </Button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </section>

      <ConfirmDialog
        open={removing !== null}
        tone="danger"
        title={`Excluir a arte-base “${removing?.name ?? ""}”?`}
        consequences={[
          removingInCalendar
            ? "Ela sai do banco de artes e deixa de entrar no calendário dos clientes básicos."
            : "Ela sai do banco de artes.",
          "Os posts já criados a partir dela continuam como estão.",
          "Não dá para desfazer. Para só tirar a arte do calendário, use Desativar.",
        ]}
        confirmLabel="Excluir arte-base"
        busy={deleting}
        busyLabel="Excluindo…"
        error={deleteError}
        onConfirm={() => void remove()}
        onCancel={() => {
          setRemoving(null);
          setDeleteError(null);
        }}
      />

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
