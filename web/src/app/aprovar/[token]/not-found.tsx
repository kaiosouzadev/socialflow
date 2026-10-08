import { PublicHeader } from "@/components/Logo";

// Token inexistente, expirado (60 dias após o envio) ou substituído por um reenvio (notFound() da
// página) → HTTP 404 [A-010, A-018, AC-05]. A MESMA página nos três casos: não revela qual.
// Sem link para o app: quem abre é o cliente, que não tem acesso ao sistema.
export default function ApprovalLinkNotFound() {
  return (
    <>
      <PublicHeader maxWidth="3xl" />
      <main id="conteudo" className="mx-auto w-full max-w-3xl px-4 py-10">
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
