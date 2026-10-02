"use client";

import { useState } from "react";
import { getProviders, signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { Field, Input } from "@/components/Field";
import { BrandLockup } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

const NETWORK_ERROR = "Não foi possível entrar agora. Verifique a conexão e tente de novo.";
const WRONG_CREDENTIALS = "E-mail ou senha incorretos.";
const TOO_MANY_ATTEMPTS = "Muitas tentativas com este e-mail. Aguarde 5 minutos e tente de novo.";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);

    const form = new FormData(e.currentTarget);
    let signedIn = false;
    try {
      // Sem a lista de provedores (servidor fora do ar), o signIn do next-auth troca de
      // página para /api/auth/error em vez de devolver o erro: checar antes mantém a
      // pessoa aqui, com a mensagem [A-007].
      const providers = await getProviders();
      if (!providers?.credentials) {
        setError(NETWORK_ERROR);
        return;
      }
      const res = await signIn("credentials", {
        email: form.get("email"),
        password: form.get("password"),
        redirect: false,
      });
      if (res?.ok && !res.error) {
        signedIn = true;
        router.push("/");
        router.refresh();
        return;
      }
      if (res?.error === "CredentialsSignin") {
        setError(res.code === "rate_limited" ? TOO_MANY_ATTEMPTS : WRONG_CREDENTIALS);
      } else {
        setError(NETWORK_ERROR);
      }
    } catch {
      // rede caída ou resposta que não é JSON (ex.: 500 em HTML)
      setError(NETWORK_ERROR);
    } finally {
      // no sucesso o botão segue em "Entrando…" até a troca de página
      if (!signedIn) setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-grid" />

      <header className="relative mx-auto flex h-14 w-full max-w-6xl items-center justify-end px-4">
        <ThemeToggle variant="icons" className="max-sm:**:[[role=radio]]:h-11 max-sm:**:[[role=radio]]:min-w-11" />
      </header>

      <main id="conteudo" className="relative flex flex-1 items-center justify-center px-4 pb-16 pt-4">
        <div className="w-full max-w-sm animate-fade-up">
          <div className="mb-8 flex flex-col items-center text-center">
            <BrandLockup size="lg" />
            <h1 className="mt-6 font-display text-3xl font-semibold tracking-display text-fg sm:text-4xl">Entrar</h1>
            <p className="mt-2 text-base text-fg-muted">Painel de automação da agência</p>
          </div>

          <form onSubmit={handleSubmit} className="card grid gap-4 p-6 shadow-raised sm:p-7">
            <Field label="E-mail" required>
              <Input name="email" type="email" autoComplete="email" placeholder="voce@agencia.com.br" />
            </Field>

            <Field label="Senha" required>
              <Input name="password" type="password" autoComplete="current-password" />
            </Field>

            {error && (
              <Callout tone="danger" live="assertive">
                {error}
              </Callout>
            )}

            <Button type="submit" variant="primary" size="lg" fullWidth loading={loading} loadingText="Entrando…">
              Entrar
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-fg-muted">
            Acesso restrito · Grupo Coletivo © {new Date().getFullYear()}
          </p>
        </div>
      </main>
    </div>
  );
}
