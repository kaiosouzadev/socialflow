// Esqueleto enquanto a página do app carrega (sem spinner de tela cheia).
export default function Loading() {
  return (
    <div className="page" aria-busy="true">
      <p role="status" className="sr-only">
        Carregando…
      </p>
      <div aria-hidden="true">
        <div className="skeleton h-8 w-48" />
        <div className="skeleton mt-3 h-4 w-64 max-w-full" />
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <div className="skeleton h-28 rounded-card" />
          <div className="skeleton h-28 rounded-card" />
          <div className="skeleton h-28 rounded-card" />
        </div>
      </div>
    </div>
  );
}
