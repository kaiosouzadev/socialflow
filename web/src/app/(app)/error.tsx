"use client"; // error boundaries precisam ser Client Components

import Link from "next/link";
import { useEffect } from "react";

export default function AppError({
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
    <div className="page page--narrow">
      <div className="card p-8 text-center">
        <h1 className="font-display text-2xl font-semibold tracking-display">Algo deu errado</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Não foi possível carregar esta página. Tente de novo; se continuar, avise a equipe técnica.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => unstable_retry()} className="btn-primary">
            Tentar de novo
          </button>
          <Link href="/" className="btn-ghost">
            Ir para o início
          </Link>
        </div>
      </div>
    </div>
  );
}
