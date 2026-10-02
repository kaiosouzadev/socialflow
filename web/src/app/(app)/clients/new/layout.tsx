import type { Metadata } from "next";

// Título da aba de /clients/new (CC8).
export const metadata: Metadata = { title: "Novo cliente" };

export default function NewClientLayout({ children }: { children: React.ReactNode }) {
  return children;
}
