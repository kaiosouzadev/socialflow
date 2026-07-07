import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui";
import TemplatesManager from "./TemplatesManager";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const templates = await prisma.artTemplate.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <div className="p-8 max-w-5xl mx-auto animate-fade-up">
      <PageHeader
        title="Calendário de artes básicas"
        subtitle="Banco mensal de artes que a IA personaliza (logo, cor, contatos) para cada cliente básico"
      />
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
