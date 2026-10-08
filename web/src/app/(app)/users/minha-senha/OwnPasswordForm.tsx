"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, buttonClasses } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { Field, Input } from "@/components/Field";
import { PASSWORD_HELP, checkPasswordPolicy } from "@/lib/password-policy";

type FieldName = "current" | "next" | "confirm";
type Errors = Partial<Record<FieldName, string>>;
const ORDER: readonly FieldName[] = ["current", "next", "confirm"];

const OFFLINE = "Sem conexão com o servidor. Verifique a internet e tente de novo.";
const FAILED = "Não foi possível trocar a senha agora. Tente de novo.";

function focusFirst(errors: Errors): boolean {
  const first = ORDER.find((k) => errors[k]);
  if (first) document.getElementById(`own-pw-${first}`)?.focus();
  return !!first;
}

/** Troca da própria senha: pede a atual; ao concluir, todas as sessões se encerram. */
export default function OwnPasswordForm({ email, name }: { email: string; name: string }) {
  const [values, setValues] = useState({ current: "", next: "", confirm: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  function set(field: FieldName, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const next: Errors = {};
    if (!values.current) next.current = "Informe a senha atual.";
    const policy = checkPasswordPolicy(values.next, { email, name });
    if (!policy.ok) next.next = policy.message;
    else if (values.next === values.current) next.next = "A nova senha precisa ser diferente da atual.";
    if (!next.next && values.confirm !== values.next) next.confirm = "As senhas não são iguais.";
    setErrors(next);
    setError(null);
    if (focusFirst(next)) return;

    setBusy(true);
    try {
      const res = await fetch("/api/users/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: values.current, newPassword: values.next }),
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: unknown; field?: unknown } | null;
      const text = typeof data?.error === "string" ? data.error : null;
      if (res.status === 400 && text && (data?.field === "currentPassword" || data?.field === "newPassword")) {
        const fields: Errors = data.field === "currentPassword" ? { current: text } : { next: text };
        setErrors(fields);
        focusFirst(fields);
        return;
      }
      if (res.status === 401) setError("Sua sessão expirou. Entre de novo para continuar.");
      else setError(text ?? FAILED);
    } catch {
      setError(OFFLINE);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="card grid max-w-lg gap-4 p-6">
        <Callout tone="success" live="polite" title="Senha alterada">
          Por segurança, todas as suas sessões foram encerradas, inclusive esta. Entre de novo com a nova senha.
        </Callout>
        <div>
          <Link href="/login" className={buttonClasses({ variant: "primary" })}>
            Entrar de novo
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={submit} className="card grid max-w-lg gap-4 p-6">
      <Field id="own-pw-current" label="Senha atual" required error={errors.current}>
        <Input
          type="password"
          autoComplete="current-password"
          value={values.current}
          onChange={(e) => set("current", e.target.value)}
        />
      </Field>
      <Field id="own-pw-next" label="Nova senha" required help={PASSWORD_HELP} error={errors.next}>
        <Input
          type="password"
          autoComplete="new-password"
          value={values.next}
          onChange={(e) => set("next", e.target.value)}
        />
      </Field>
      <Field id="own-pw-confirm" label="Repita a nova senha" required error={errors.confirm}>
        <Input
          type="password"
          autoComplete="new-password"
          value={values.confirm}
          onChange={(e) => set("confirm", e.target.value)}
        />
      </Field>
      <p className="text-sm text-fg-muted">Ao trocar a senha, você sai de todos os aparelhos e entra de novo com a nova.</p>
      {error && (
        <Callout tone="danger" live="assertive">
          {error}
        </Callout>
      )}
      <div>
        <Button type="submit" variant="primary" loading={busy} loadingText="Salvando…">
          Trocar senha
        </Button>
      </div>
    </form>
  );
}
