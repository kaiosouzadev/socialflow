import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { NavLinks } from "@/components/NavLinks";
import { Icon } from "@/components/Icons";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const isAdmin = (session.user as { role?: string } | undefined)?.role === "admin";

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 flex flex-col shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)]/60 backdrop-blur-xl">
        <div className="flex items-center gap-2.5 px-5 h-16 border-b border-[var(--color-border)]">
          <Logo size={30} />
          <span className="font-semibold tracking-tight text-[15px]">
            Social<span className="gradient-text">Flow</span>
          </span>
        </div>

        <NavLinks isAdmin={isAdmin} />

        <div className="px-3 py-4 border-t border-[var(--color-border)]">
          <div className="flex items-center gap-3 px-3 py-2.5 mb-1 rounded-xl">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold text-white shrink-0"
              style={{ background: "linear-gradient(135deg,#7c5cff,#ec4899)" }}
            >
              {session.user?.name?.[0]?.toUpperCase() ?? "U"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{session.user?.name}</p>
              <p className="text-xs text-[var(--color-text-faint)] truncate">
                {session.user?.email}
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
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-[var(--color-text-muted)] hover:text-white hover:bg-white/[0.03] transition-colors"
            >
              <Icon.logout className="w-[18px] h-[18px]" />
              Sair
            </button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <main className="relative flex-1 overflow-auto">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-64"
          style={{
            background:
              "radial-gradient(60rem 18rem at 30% -8rem, rgba(139,109,255,0.10), transparent 70%)",
          }}
        />
        <div className="relative">{children}</div>
      </main>
    </div>
  );
}
