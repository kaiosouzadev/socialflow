import Link from "next/link";
import { buttonClasses } from "@/components/Button";

// 404 de notFound() dentro do app (/clients/[id], /posts/[id]…). Renderiza dentro de (app)/layout.tsx, que já tem
// o <main id="conteudo">: aqui não há <main> próprio. Rota inexistente continua em app/not-found.tsx.
export default function AppNotFound() {
  return (
    <div className="page page--narrow">
      <div className="card p-8 text-center">
        <h1 className="font-display text-2xl font-semibold tracking-display">Página não encontrada</h1>
        <p className="mt-2 text-sm text-fg-muted">Verifique o endereço ou volte ao início.</p>
        <div className="mt-6 flex justify-center">
          <Link href="/" className={buttonClasses({ variant: "primary" })}>
            Ir para o início
          </Link>
        </div>
      </div>
    </div>
  );
}
