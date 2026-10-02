import type { Metadata } from "next";

// A página é "use client": o título da aba vem deste layout do segmento (CC8, A-020).
export const metadata: Metadata = { title: "Novo post" };

export default function NewPostLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
