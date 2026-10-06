import Link from "next/link";
import { buttonClasses } from "@/components/Button";
import { BrandLockup } from "@/components/Logo";

// 404 de todo o app (rota inexistente e notFound() sem not-found próprio). Fica fora da casca do (app)
// (sem menu): por isso leva o logotipo, fica centralizado e oferece atalhos para as áreas principais
// (U-15). Os atalhos são rotas protegidas; sem sessão, o login pede para entrar.
const SHORTCUTS = [
  { href: "/", label: "Dashboard", variant: "primary" },
  { href: "/posts", label: "Posts", variant: "secondary" },
  { href: "/clients", label: "Clientes", variant: "secondary" },
] as const;

export default function NotFound() {
  return (
    <main id="conteudo" className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md text-center">
        <BrandLockup size="lg" />
        <div className="card mt-8 px-6 py-8 sm:px-8">
          <p className="text-xs font-semibold uppercase tracking-overline text-fg-muted">Erro 404</p>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-display text-balance text-fg">
            Página não encontrada
          </h1>
          <p className="mt-2 text-sm text-fg-muted">
            O endereço pode estar errado ou a página foi removida. Escolha para onde ir:
          </p>
          <nav aria-label="Atalhos" className="mt-6">
            <ul className="flex flex-wrap justify-center gap-2">
              {SHORTCUTS.map((s) => (
                <li key={s.href}>
                  <Link href={s.href} className={buttonClasses({ variant: s.variant })}>
                    {s.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
    </main>
  );
}
