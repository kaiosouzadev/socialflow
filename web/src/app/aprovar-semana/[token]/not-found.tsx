import { PublicHeader } from "@/components/Logo";

// Token inexistente, expirado ou substituído (notFound() da página) → HTTP 404 [A-010, A-018].
// Sem link para o app: quem abre é o cliente, que não tem acesso ao sistema.
// Seletor de tema com alvos de 44 px no celular (controles do link, CC7).
export default function WeeklyLinkNotFound() {
  return (
    <>
      <PublicHeader maxWidth="xl" className="max-sm:**:[[role=radio]]:h-11 max-sm:**:[[role=radio]]:min-w-11" />
      <main id="conteudo" className="mx-auto w-full max-w-xl px-4 py-10">
        <div className="card mx-auto max-w-md p-8 text-center">
          <h1 className="font-display text-2xl font-semibold tracking-display text-fg">
            Este link não está mais disponível
          </h1>
          <p className="mt-3 text-base text-fg-muted">
            O link pode ter expirado ou sido substituído. Peça um novo link à agência.
          </p>
        </div>
      </main>
    </>
  );
}
