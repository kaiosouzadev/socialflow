import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Bricolage_Grotesque, DM_Sans, Geist_Mono } from "next/font/google";
import { ThemeSync } from "@/components/ThemeToggle";
import "./globals.css";

// Texto e UI (padrão do body). O eixo opsz melhora 12–14 px.
const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
  axes: ["opsz"],
});

// Display: títulos e números de KPI.
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  display: "swap",
});

// Só para font-mono (IDs, tokens, códigos).
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Grupo Coletivo",
    template: "%s · Grupo Coletivo",
  },
  description: "Automação de postagens para agências",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
};

// A meta theme-color só aceita cor literal (não lê var(--sf-*)): os valores são
// os de --sf-canvas em globals.css (claro e escuro). Mudou o token, mude aqui.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4efe3" }, // cor-de-meta: --sf-canvas (claro)
    { media: "(prefers-color-scheme: dark)", color: "#171510" }, // cor-de-meta: --sf-canvas (escuro)
  ],
};

// Anti-flash (contrato C1.1): aplica o tema salvo em <html data-theme> antes da
// primeira pintura. Conteúdo constante, sem dado de usuário.
const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem("sf-theme");if(p!=="light"&&p!=="dark")p="system";var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var h=document.documentElement;h.dataset.theme=d?"dark":"light";h.dataset.themePref=p;}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // CSP (proxy.ts): o script de tema só roda com o nonce desta resposta. Ler o cabeçalho deixa
  // todas as páginas dinâmicas, que é o exigido para o nonce valer (nada de HTML pré-gerado).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${dmSans.variable} ${bricolage.variable} ${geistMono.variable}`}
    >
      <head>
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-canvas text-fg font-sans antialiased">
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
