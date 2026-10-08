import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { BrandLockup } from "@/components/Logo";
import { MobileNav, NavLinks } from "@/components/NavLinks";
import { ThemeToggle } from "@/components/ThemeToggle";
import { FlashToast } from "@/components/FlashToast";
import { Icon } from "@/components/Icons";
import { prisma } from "@/lib/prisma";
import { spDateFromKey, spDateKey } from "@/lib/deadlines";
import { uuidString } from "@/lib/validators";

/**
 * Selo do item "Design" no menu: artes A FAZER do mês atual (SP) — as da usuária
 * (clientes em que ela é a designer) ou, se ela não é designer de nenhum cliente
 * ativo, todas. É o mesmo número que a página /design mostra no padrão
 * (mês atual, "Minhas"/"Todas", "A fazer"). Regra da arte = `hasArt` (lib/production):
 * sem art_done_at, sem mídia e não publicado. Uma consulta só; erro → sem selo.
 */
async function designBadgeCount(user: { id?: string; email?: string | null } | undefined): Promise<number> {
  try {
    const id = user?.id && uuidString.safeParse(user.id).success ? user.id : null;
    const email = user?.email ?? null;
    if (!id && !email) return 0;
    const month = spDateKey(new Date()).slice(0, 7);
    const [y, m] = month.split("-").map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    const rows = await prisma.$queryRaw<{ n: number }[]>`
      WITH me AS (
        SELECT u.id FROM users u
        WHERE (${id}::uuid IS NOT NULL AND u.id = ${id}::uuid) OR (${id}::uuid IS NULL AND u.email = ${email})
        LIMIT 1
      ), mine AS (
        SELECT EXISTS (
          SELECT 1 FROM clients c WHERE c.status = 'ativo' AND c.designer_user_id = (SELECT id FROM me)
        ) AS is_designer
      )
      SELECT count(*)::int AS n
      FROM posts p JOIN clients c ON c.id = p.client_id
      WHERE c.status = 'ativo'
        AND p.status <> 'published'
        AND p.scheduled_at >= ${spDateFromKey(`${month}-01`)} AND p.scheduled_at < ${spDateFromKey(`${next}-01`)}
        AND p.art_done_at IS NULL
        AND (p.media_url IS NULL OR p.media_url !~ '[^[:space:]]')
        AND (p.media_items IS NULL OR jsonb_typeof(p.media_items) <> 'array' OR jsonb_array_length(p.media_items) = 0)
        AND (NOT (SELECT is_designer FROM mine) OR c.designer_user_id = (SELECT id FROM me))`;
    return rows[0]?.n ?? 0;
  } catch (e) {
    console.error("[layout] selo do Design", e);
    return 0;
  }
}

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
  // auth() já revalida a sessão no banco (lib/session-guard): excluída, rebaixada, senha
  // trocada ou "Sair" em outra aba → null. Exige identidade, não só um objeto (CF-01).
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const isAdmin = (session.user as { role?: string } | undefined)?.role === "admin";
  const name = session.user?.name ?? "";
  const email = session.user?.email ?? "";
  const designCount = await designBadgeCount(session.user as { id?: string; email?: string | null } | undefined);

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
      {/* troca da própria senha (pede a senha atual) — vale para toda a equipe */}
      <Link
        href="/users/minha-senha"
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-control px-4 text-sm font-semibold text-fg-muted transition-colors duration-(--sf-dur-fast) hover:bg-hover hover:text-fg active:bg-press active:text-fg sm:min-h-10"
      >
        <Icon.shield className="size-4.5 shrink-0" />
        Minha senha
      </Link>
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
          <NavLinks isAdmin={isAdmin} designCount={designCount} />
          {footer}
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface px-2 md:hidden">
            <MobileNav isAdmin={isAdmin} footer={footer} designCount={designCount} />
            <BrandLockup size="sm" />
          </header>
          <main id="conteudo" tabIndex={-1} className="outline-none">
            {children}
          </main>
          {/* avisos que precisam sobreviver a um refresh (ver FlashToast) */}
          <FlashToast />
        </div>
      </div>
    </>
  );
}
