"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/Dialog";
import { Icon } from "@/components/Icons";

/** Excluir cliente com ConfirmDialog que diz a consequência antes (A-016, A-032). */
export default function DeleteClientButton({
  clientId,
  clientName,
  postsCount,
  accountsCount,
}: {
  clientId: string;
  clientName: string;
  /** para as consequências do diálogo (opcional) */
  postsCount?: number;
  accountsCount?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}`, { method: "DELETE" });
      if (!res.ok) {
        setError(
          res.status === 404
            ? "Este cliente não existe mais. Volte para a lista de clientes."
            : "Não foi possível excluir o cliente. Tente de novo.",
        );
        setLoading(false);
        return;
      }
    } catch {
      setError("Sem conexão com o servidor. Verifique a internet e tente de novo.");
      setLoading(false);
      return;
    }
    router.push("/clients");
    router.refresh();
  }

  const posts =
    postsCount === 0
      ? null
      : postsCount === 1
        ? "O post do cliente é apagado."
        : `${postsCount === undefined ? "Todos os posts" : `Os ${postsCount} posts`} do cliente são apagados.`;
  const accounts =
    accountsCount === 0
      ? null
      : accountsCount === 1
        ? "A conta conectada sai do sistema (nada é apagado na rede social)."
        : `${accountsCount === undefined ? "As contas conectadas" : `As ${accountsCount} contas conectadas`} saem do sistema (nada é apagado nas redes sociais).`;

  return (
    <>
      <Button variant="danger" leadingIcon={<Icon.trash />} onClick={() => setOpen(true)}>
        Excluir cliente
      </Button>
      <ConfirmDialog
        open={open}
        tone="danger"
        title={`Excluir o cliente ${clientName}?`}
        consequences={[
          ...(posts ? [posts] : []),
          "Cronogramas, aprovações, pendências, credenciais e briefing também são apagados.",
          ...(accounts ? [accounts] : []),
          "Não dá para desfazer.",
        ]}
        confirmLabel="Excluir cliente"
        busy={loading}
        busyLabel="Excluindo…"
        error={error}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          setOpen(false);
          setError(null);
        }}
      />
    </>
  );
}
