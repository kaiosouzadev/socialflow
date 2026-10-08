"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { Button, buttonClasses } from "@/components/Button";
import { ConfirmDialog, Dialog } from "@/components/Dialog";
import { Field, Input, Select } from "@/components/Field";
import { Icon } from "@/components/Icons";
import { Toast, type ToastState } from "@/components/Toast";
import { PageHeader, ToneBadge } from "@/components/ui";
import { PASSWORD_HELP, PASSWORD_MESSAGES, checkPasswordPolicy } from "@/lib/password-policy";
import { toUserMessage } from "@/lib/user-facing-error";

type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  /** clientes em que é a redatora responsável */
  clients: number;
  /** posts em que é a redatora */
  posts: number;
  /** pendências em que é a responsável */
  pending: number;
};

type UserField = "name" | "email" | "password" | "role";
type FieldErrors = Partial<Record<UserField, string>>;

const OFFLINE = "Sem conexão com o servidor. Verifique a internet e tente de novo.";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIELD_ORDER: readonly UserField[] = ["name", "email", "password", "role"];
/** Textos por campo para o 400 do zod (o `error` da API é objeto em inglês, N-14). */
const FIELD_MESSAGES: Record<UserField, string> = {
  name: "Informe o nome.",
  email: "Informe um e-mail válido.",
  password: PASSWORD_MESSAGES.tooShort,
  role: "Escolha o papel.",
};
const ROLE_HELP =
  "Administrador também gerencia usuários e conexões Meta. A mudança de papel vale na hora: a pessoa precisa entrar de novo.";
const SELF_EDIT_NOTE = "Se você trocar o seu papel ou a sua senha, vai precisar entrar de novo.";

/** 400 da política de senha: `{ error: "<pt-BR>", field: "password" }`. */
function passwordFieldError(data: unknown): string | null {
  const d = data as { error?: unknown; field?: unknown } | null;
  return d?.field === "password" && typeof d.error === "string" ? d.error : null;
}

/** Texto da API só quando é string (N-14), sem detalhe técnico; senão o texto da tela. */
function apiMessage(status: number, data: unknown, fallback: string): string {
  if (status === 401) return "Sua sessão expirou. Entre de novo para continuar.";
  if (status === 403) return "Só administradores podem gerenciar usuários.";
  return toUserMessage(data, fallback);
}

/** Campos apontados pelo 400 de validação da API. */
function zodFields(data: unknown): FieldErrors {
  const fieldErrors = (data as { error?: { fieldErrors?: unknown } } | null)?.error?.fieldErrors;
  const out: FieldErrors = {};
  if (fieldErrors && typeof fieldErrors === "object") {
    for (const key of FIELD_ORDER) if (key in fieldErrors) out[key] = FIELD_MESSAGES[key];
  }
  return out;
}

function focusFirst(errors: FieldErrors, prefix: string): boolean {
  const first = FIELD_ORDER.find((k) => errors[k]);
  if (first) document.getElementById(`${prefix}-${first}`)?.focus();
  return !!first;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function RoleBadge({ role }: { role: string }) {
  return role === "admin" ? (
    <ToneBadge tone="accent" icon={<Icon.shield />}>
      Administrador
    </ToneBadge>
  ) : (
    <ToneBadge tone="neutral">Equipe</ToneBadge>
  );
}

function RoleOptions() {
  return (
    <>
      <option value="staff">Equipe</option>
      <option value="admin">Administrador</option>
    </>
  );
}

function CreateUserDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const [values, setValues] = useState({ name: "", email: "", password: "", role: "staff" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set(field: UserField, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = values.name.trim();
    const email = values.email.trim();
    const next: FieldErrors = {};
    if (!name) next.name = FIELD_MESSAGES.name;
    if (!EMAIL_RE.test(email)) next.email = FIELD_MESSAGES.email;
    const policy = checkPasswordPolicy(values.password, { email, name });
    if (!policy.ok) next.password = policy.message;
    setErrors(next);
    setError(null);
    if (focusFirst(next, "user-new")) return;

    setBusy(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password: values.password, role: values.role }),
      });
      if (!res.ok) {
        const data: unknown = await res.json().catch(() => null);
        const weak = res.status === 400 ? passwordFieldError(data) : null;
        const fields: FieldErrors =
          res.status === 409
            ? { email: "Já existe um usuário com este e-mail." }
            : weak
              ? { password: weak }
              : res.status === 400
                ? zodFields(data)
                : {};
        if (focusFirst(fields, "user-new")) {
          setErrors(fields);
          return;
        }
        setError(apiMessage(res.status, data, "Não foi possível criar o usuário. Tente de novo."));
        return;
      }
      onCreated(name);
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
      title="Novo usuário"
      description="A pessoa entra no painel com este e-mail e esta senha."
      busy={busy}
      error={error}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="user-new-form" variant="primary" loading={busy} loadingText="Criando…">
            Criar usuário
          </Button>
        </>
      }
    >
      <form id="user-new-form" noValidate onSubmit={submit} className="grid gap-4 pb-2 sm:grid-cols-2">
        <Field id="user-new-name" label="Nome" required error={errors.name}>
          <Input
            value={values.name}
            autoComplete="off"
            placeholder="Nome completo"
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <Field id="user-new-email" label="E-mail" required error={errors.email}>
          <Input
            type="email"
            value={values.email}
            autoComplete="off"
            placeholder="email@agencia.com"
            onChange={(e) => set("email", e.target.value)}
          />
        </Field>
        <Field id="user-new-password" label="Senha" required help={PASSWORD_HELP} error={errors.password}>
          <Input
            type="password"
            value={values.password}
            autoComplete="new-password"
            onChange={(e) => set("password", e.target.value)}
          />
        </Field>
        <Field id="user-new-role" label="Papel" help={ROLE_HELP} error={errors.role}>
          <Select value={values.role} onChange={(e) => set("role", e.target.value)}>
            <RoleOptions />
          </Select>
        </Field>
      </form>
    </Dialog>
  );
}

function EditUserDialog({
  user,
  isSelf,
  onClose,
  onSaved,
}: {
  user: User | null;
  /** a admin editando a si mesma: trocar papel ou senha encerra a própria sessão */
  isSelf: boolean;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const [name, setName] = useState(user?.name ?? "");
  const [role, setRole] = useState(user?.role ?? "staff");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!user) return;
    const trimmed = name.trim();
    // em branco = manter a senha; senão vai como foi digitada (espaços fazem parte da senha)
    const newPassword = password.trim() ? password : "";
    const next: FieldErrors = {};
    if (!trimmed) next.name = FIELD_MESSAGES.name;
    if (newPassword) {
      const policy = checkPasswordPolicy(newPassword, { email: user.email, name: trimmed });
      if (!policy.ok) next.password = policy.message;
    }
    setErrors(next);
    setError(null);
    if (focusFirst(next, "user-edit")) return;

    const payload: Record<string, unknown> = { name: trimmed, role };
    if (newPassword) payload.password = newPassword;

    setBusy(true);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data: unknown = await res.json().catch(() => null);
        const weak = res.status === 400 ? passwordFieldError(data) : null;
        const fields: FieldErrors = weak ? { password: weak } : res.status === 400 ? zodFields(data) : {};
        if (focusFirst(fields, "user-edit")) {
          setErrors(fields);
          return;
        }
        setError(
          res.status === 404
            ? "Este usuário não existe mais. Feche e atualize a página."
            : apiMessage(res.status, data, "Não foi possível salvar as alterações. Tente de novo."),
        );
        return;
      }
      onSaved(trimmed);
    } catch {
      setError(OFFLINE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={user !== null}
      onClose={onClose}
      title={user ? `Editar ${user.name}` : "Editar usuário"}
      description={user ? (isSelf ? `${user.email} · ${SELF_EDIT_NOTE}` : user.email) : undefined}
      busy={busy}
      error={error}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="user-edit-form" variant="primary" loading={busy} loadingText="Salvando…">
            Salvar
          </Button>
        </>
      }
    >
      <form id="user-edit-form" noValidate onSubmit={submit} className="grid gap-4 pb-2 sm:grid-cols-2">
        <Field id="user-edit-name" label="Nome" required error={errors.name}>
          <Input
            value={name}
            autoComplete="off"
            onChange={(e) => {
              setName(e.target.value);
              setErrors((s) => ({ ...s, name: undefined }));
            }}
          />
        </Field>
        <Field id="user-edit-role" label="Papel" help={ROLE_HELP} error={errors.role}>
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            <RoleOptions />
          </Select>
        </Field>
        <Field
          id="user-edit-password"
          label="Nova senha"
          optional
          help={`Deixe em branco para manter a senha atual. ${PASSWORD_HELP}`}
          error={errors.password}
          className="sm:col-span-2"
        >
          <Input
            type="password"
            value={password}
            autoComplete="new-password"
            onChange={(e) => {
              setPassword(e.target.value);
              setErrors((s) => ({ ...s, password: undefined }));
            }}
          />
        </Field>
      </form>
    </Dialog>
  );
}

export default function UsersManager({
  initialUsers,
  currentUserId,
}: {
  initialUsers: User[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [toast, setToast] = useState<ToastState>(null);
  // a chave remonta o diálogo de criação a cada abertura (campos limpos)
  const [createSeq, setCreateSeq] = useState(0);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [removing, setRemoving] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // exclusão só depois do ConfirmDialog; erro fica dentro do diálogo
  async function remove() {
    if (!removing) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/users/${removing.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data: unknown = await res.json().catch(() => null);
        setDeleteError(
          res.status === 404
            ? "Este usuário não existe mais. Feche e atualize a página."
            : apiMessage(res.status, data, "Não foi possível excluir o usuário. Tente de novo."),
        );
        return;
      }
      const removedName = removing.name;
      setRemoving(null);
      setToast({ kind: "success", text: `Usuário ${removedName} excluído.` });
      router.refresh();
    } catch {
      setDeleteError(OFFLINE);
    } finally {
      setDeleting(false);
    }
  }

  const consequences = removing
    ? [
        `${removing.name} não consegue mais entrar no painel.`,
        ...(removing.clients > 0
          ? [`${plural(removing.clients, "cliente fica", "clientes ficam")} sem redatora responsável.`]
          : []),
        ...(removing.posts > 0 ? [`${plural(removing.posts, "post fica", "posts ficam")} sem redatora.`] : []),
        ...(removing.pending > 0
          ? [`${plural(removing.pending, "pendência fica", "pendências ficam")} sem responsável.`]
          : []),
        "Não dá para desfazer.",
      ]
    : [];

  return (
    <>
      <PageHeader
        title="Usuários"
        subtitle="Quem tem acesso ao painel"
        action={
          <>
            <Link href="/users/minha-senha" className={buttonClasses({ variant: "secondary" })}>
              Minha senha
            </Link>
            <Button
              variant="primary"
              leadingIcon={<Icon.plus />}
              onClick={() => {
                setCreateSeq((n) => n + 1);
                setCreating(true);
              }}
            >
              Novo usuário
            </Button>
          </>
        }
      />

      <ul aria-label="Usuários" className="card divide-y divide-line overflow-hidden">
        {initialUsers.map((u) => {
          const isSelf = u.id === currentUserId;
          return (
            <li key={u.id} className="flex items-center gap-3 px-4 py-3 sm:gap-4 sm:px-5">
              <Avatar name={u.name} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="min-w-0 truncate text-sm font-medium text-fg" title={u.name}>
                    {u.name}
                  </p>
                  {isSelf && <span className="text-xs font-medium text-fg-muted">(você)</span>}
                  <RoleBadge role={u.role} />
                </div>
                <p className="mt-0.5 truncate text-sm text-fg-muted" title={u.email}>
                  {u.email}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  iconOnly
                  variant="ghost"
                  aria-label={`Editar ${u.name}`}
                  title="Editar"
                  onClick={() => setEditing(u)}
                >
                  <Icon.edit />
                </Button>
                <Button
                  iconOnly
                  variant="ghost"
                  aria-label={`Excluir ${u.name}`}
                  title={isSelf ? "Você não pode excluir o próprio usuário" : "Excluir"}
                  disabled={isSelf}
                  onClick={() => {
                    setDeleteError(null);
                    setRemoving(u);
                  }}
                >
                  <Icon.trash />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <CreateUserDialog
        key={`novo-${createSeq}`}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(name) => {
          setCreating(false);
          setToast({ kind: "success", text: `Usuário ${name} criado. Já pode entrar com o e-mail e a senha cadastrados.` });
          router.refresh();
        }}
      />

      <EditUserDialog
        key={editing?.id ?? "fechado"}
        user={editing}
        isSelf={editing?.id === currentUserId}
        onClose={() => setEditing(null)}
        onSaved={(name) => {
          setEditing(null);
          setToast({ kind: "success", text: `Alterações de ${name} salvas.` });
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        tone="danger"
        title={`Excluir o usuário ${removing?.name ?? ""}?`}
        description={removing?.email}
        consequences={consequences}
        confirmLabel="Excluir usuário"
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
    </>
  );
}
