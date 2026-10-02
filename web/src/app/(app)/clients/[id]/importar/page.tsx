import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { uuidString } from "@/lib/validators";
import ImportWizard from "./ImportWizard";

/*
 * Importador do documento mensal da redação (S33, DESIGN g.2) [RD §2.2, §6
 * telas 2 e 4]. O .docx é lido no navegador (ImportWizard + lib/docx-text) e só
 * o texto, já sem credenciais, vai para POST /api/clients/[id]/import-doc (S18).
 */

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/** Cliente para o título da aba e a tela (memorizado no mesmo render). */
const loadClient = cache(async (id: string) =>
  uuidString.safeParse(id).success
    ? prisma.client.findUnique({
        where: { id },
        select: { id: true, name: true, status: true, plan: true, agencyPublishes: true },
      })
    : null,
);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const client = await loadClient(id);
  return { title: client ? `Importar documento · ${client.name}` : "Cliente não encontrado" };
}

export default async function ImportDocumentPage({ params }: Props) {
  const { id } = await params;
  const client = await loadClient(id);
  if (!client) notFound();
  return <ImportWizard client={client} />;
}
