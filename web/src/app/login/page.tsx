"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const res = await signIn("credentials", {
      email: form.get("email"),
      password: form.get("password"),
      redirect: false,
    });

    setLoading(false);

    if (res?.error) {
      setError("Email ou senha incorretos.");
    } else {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden">
      <div className="absolute inset-0 bg-grid pointer-events-none" />
      <div
        className="absolute -top-40 left-1/2 -translate-x-1/2 w-[40rem] h-[40rem] rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, rgba(124,92,255,0.18), transparent 60%)",
        }}
      />

      <div className="relative w-full max-w-sm animate-fade-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size={52} />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">
            Social<span className="gradient-text">Flow</span>
          </h1>
          <p className="mt-1.5 text-sm text-[var(--color-text-muted)]">
            Painel de automação da agência
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="card p-7 space-y-4 shadow-2xl"
        >
          <div>
            <label className="label">Email</label>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="input"
              placeholder="voce@agencia.com.br"
            />
          </div>

          <div>
            <label className="label">Senha</label>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="input"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full mt-1"
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-[var(--color-text-faint)]">
          Acesso restrito · SocialFlow © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
