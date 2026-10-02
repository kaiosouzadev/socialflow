import type { Metadata } from "next";

// A página é "use client": o título da aba vem deste layout do segmento (CC8).
export const metadata: Metadata = { title: "Entrar" };

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
