import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import { BrandLockup } from "@/components/Logo";
import { MobileNav, NavLinks } from "@/components/NavLinks";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Icon } from "@/components/Icons";

/** Iniciais do avatar: 1ª letra da 1ª e da última palavra ("?" sem nome). */
function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return `${first}${last}`.toUpperCase();
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const isAdmin = (session.user as { role?: string } | undefined)?.role === "admin";
  const name = session.user?.name ?? "";
  const email = session.user?.email ?? "";

  // Rodapé da sidebar, repetido na gaveta do celular: tema, usuário e Sair.
  const footer = (
    <div className="shrink-0 space-y-2 border-t border-line p-3">
      <div className="flex items-center justify-between gap-2 pl-1">
        <span aria-hidden="true" className="text-xs text-fg-muted">
          Tema
        </span>
        <ThemeToggle variant="icons" />
      </div>
      <div className="flex items-center gap-3 px-1 py-1">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-full bg-neutral-bg text-sm font-semibold text-fg"
        >
          {initials(name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg" title={name}>
            {name}
          </p>
          <p className="truncate text-xs text-fg-muted" title={email}>
            {email}
          </p>
        </div>
      </div>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <button
          type="submit"
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-control px-4 text-sm font-semibold text-fg-muted transition-colors duration-(--sf-dur-fast) hover:bg-hover hover:text-fg active:bg-press active:text-fg sm:min-h-10"
        >
          <Icon.logout className="size-4.5 shrink-0" />
          Sair
        </button>
      </form>
    </div>
  );

  return (
    <>
      <a
        href="#conteudo"
        className="fixed left-4 top-4 z-60 inline-flex h-10 -translate-y-24 items-center rounded-control bg-selected px-4 font-medium text-on-selected focus:translate-y-0"
      >
        Pular para o conteúdo
      </a>

      <div className="min-h-dvh md:grid md:grid-cols-[256px_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface md:flex">
          <div className="flex h-16 shrink-0 items-center border-b border-line px-5">
            <BrandLockup size="md" href="/" />
          </div>
          <NavLinks isAdmin={isAdmin} />
          {footer}
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface px-2 md:hidden">
            <MobileNav isAdmin={isAdmin} footer={footer} />
            <BrandLockup size="sm" />
          </header>
          <main id="conteudo" tabIndex={-1} className="outline-none">
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
