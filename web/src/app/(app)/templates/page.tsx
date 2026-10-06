import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import TemplatesManager from "./TemplatesManager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Artes-base" };

export default async function TemplatesPage() {
  const templates = await prisma.artTemplate.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <div className="page">
      {/* o cabeçalho (h1 "Artes-base", igual ao menu) fica no TemplatesManager: as ações abrem diálogos (U-13) */}
      <TemplatesManager
        initial={templates.map((t) => ({
          id: t.id,
          name: t.name,
          month: t.month,
          day: t.day,
          time: t.time,
          baseImageUrl: t.baseImageUrl,
          active: t.active,
        }))}
      />
    </div>
  );
}
