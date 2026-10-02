import Link from "next/link";

// 404 de todo o app (rota inexistente e notFound() sem not-found próprio).
export default function NotFound() {
  return (
    <main id="conteudo" className="page page--narrow">
      <div className="card p-8 text-center">
        <h1 className="font-display text-2xl font-semibold tracking-display">Página não encontrada</h1>
        <p className="mt-2 text-sm text-fg-muted">Verifique o endereço ou volte ao início.</p>
        <div className="mt-6 flex justify-center">
          <Link href="/" className="btn-primary">
            Ir para o início
          </Link>
        </div>
      </div>
    </main>
  );
}
