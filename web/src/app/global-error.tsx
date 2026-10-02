"use client"; // error boundaries precisam ser Client Components

import { useEffect } from "react";
import { ThemeSync } from "@/components/ThemeToggle";
import "./globals.css";

// Substitui o layout raiz quando ele mesmo quebra: precisa de <html>/<body>
// próprios. Sem as fontes do layout, o body cai na fonte do sistema.
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body className="min-h-dvh bg-canvas text-fg antialiased">
        <title>Algo deu errado · Grupo Coletivo</title>
        <ThemeSync />
        <main className="page page--narrow">
          <div className="card p-8 text-center">
            <h1 className="text-2xl font-semibold tracking-display">Algo deu errado</h1>
            <p className="mt-2 text-sm text-fg-muted">
              Não foi possível carregar esta página. Tente de novo; se continuar, avise a equipe técnica.
            </p>
            <div className="mt-6 flex justify-center">
              <button type="button" onClick={() => unstable_retry()} className="btn-primary">
                Tentar de novo
              </button>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
