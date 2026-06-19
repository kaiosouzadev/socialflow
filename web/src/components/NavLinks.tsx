"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icons";

const items = [
  { href: "/", label: "Dashboard", icon: Icon.dashboard },
  { href: "/clients", label: "Clientes", icon: Icon.users },
  { href: "/posts", label: "Posts", icon: Icon.list },
  { href: "/calendar", label: "Calendário", icon: Icon.grid },
  { href: "/users", label: "Usuários", icon: Icon.shield, adminOnly: true },
];

export function NavLinks({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const visible = items.filter((i) => !i.adminOnly || isAdmin);

  return (
    <nav className="flex-1 px-3 py-4 space-y-1">
      {visible.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);
        const ItemIcon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
              active
                ? "text-white"
                : "text-[var(--color-text-muted)] hover:text-white"
            }`}
          >
            {active && (
              <span
                className="absolute inset-0 rounded-xl"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(124,92,255,0.18), rgba(236,72,153,0.12))",
                  border: "1px solid rgba(124,92,255,0.3)",
                  boxShadow: "0 2px 12px -4px rgba(124,92,255,0.4)",
                }}
              />
            )}
            {!active && (
              <span className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity bg-white/[0.03]" />
            )}
            <ItemIcon className="w-[18px] h-[18px] relative z-10 shrink-0" />
            <span className="relative z-10">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
