import { PublicHeader } from "@/components/Logo";

// Token inexistente ou expirado (60 dias após o envio) (notFound() da página) → HTTP 404
// [A-010, A-018, AC-05]. A MESMA página nos dois casos: não revela qual.
// Sem link para o app: quem abre é o cliente, que não tem acesso ao sistema.
// Seletor de tema com alvos de 44 px no celular (controles do link, CC7).
export default function WeeklyLinkNotFound() {
  return (
    <>
      <PublicHeader maxWidth="xl" className="max-sm:**:[[role=radio]]:h-11 max-sm:**:[[role=radio]]:min-w-11" />
      <main id="conteudo" className="mx-auto w-full max-w-xl px-4 py-10">
        <div className="card mx-auto max-w-md p-8 text-center">
          <h1 className="font-display text-2xl font-semibold tracking-display text-fg">Este link expirou</h1>
          <p className="mt-3 text-base text-fg-muted">
            Os links de aprovação valem por 60 dias e deixam de funcionar quando a agência envia um novo. Peça um
            novo link à agência.
          </p>
        </div>
      </main>
    </>
  );
}
