"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { Dialog } from "@/components/Dialog";
import { Icon } from "@/components/Icons";
import { BRAND } from "@/components/BrandIcons";
import { PUBLISH_BLOCKED } from "@/lib/publish-policy";

/** Abaixo disso a publicação é praticamente imediata (o mesmo limite do Novo post). */
const IMMINENT_MINUTES = 30;

/** "Instagram", "Instagram e Facebook", "Instagram, Facebook e LinkedIn". */
function joinPlatforms(targets: string[]): string {
  const labels = targets.map((t) => BRAND[t]?.label ?? t);
  if (labels.length <= 1) return labels[0] ?? "as redes do cliente";
  return `${labels.slice(0, -1).join(", ")} e ${labels[labels.length - 1]}`;
}

/**
 * "Aprovar e agendar" de um post individual, sempre por um diálogo que diz o que
 * vai acontecer antes (o post entra na fila de publicação).
 *
 * Dois casos pedem atenção a mais (antes eram o único motivo da confirmação):
 *  - post sem arte vai para a fila e falha na publicação;
 *  - cliente do plano "com aprovação" é agendado pulando o cronograma que o
 *    cliente precisa aprovar.
 * Nenhum dos dois é um beco sem saída: o admin confirma e segue.
 *
 * O erro fica DENTRO do diálogo (A-040). O 409 (cliente virou "só produção" ou
 * o post mudou de status) mostra a mensagem do servidor e, ao fechar, a página
 * é recarregada com o estado novo.
 */
export default function ApprovePostButton({
  postId,
  hasMedia,
  needsClientApproval,
  clientName,
  scheduleId,
  scheduledAt,
  whenText,
  targets,
}: {
  postId: string;
  hasMedia: boolean;
  needsClientApproval: boolean;
  clientName: string;
  scheduleId: string | null;
  /** ISO da data marcada (para avisar se já passou ou está muito perto) */
  scheduledAt: string;
  /** data por extenso, em minúsculas: "sexta-feira, 4 de setembro de 2026 às 12:45" */
  whenText: string;
  targets: string[];
}) {
  const router = useRouter();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 409: o servidor recusou de vez; só resta fechar e recarregar a página
  const [refused, setRefused] = useState(false);
  const [timing, setTiming] = useState<"past" | "soon" | null>(null);

  const blocked = !hasMedia || needsClientApproval;

  // depois da recusa o botão de confirmar some: o foco vai para "Entendi"
  useEffect(() => {
    if (refused) cancelRef.current?.focus();
  }, [refused]);

  function openDialog() {
    const minutes = (new Date(scheduledAt).getTime() - Date.now()) / 60_000;
    setTiming(minutes < 0 ? "past" : minutes < IMMINENT_MINUTES ? "soon" : null);
    setError(null);
    setRefused(false);
    setOpen(true);
  }

  function close() {
    if (busy) return;
    setOpen(false);
    if (refused) router.refresh();
  }

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "scheduled" }),
      });
      if (res.ok) {
        setOpen(false);
        router.refresh();
        return;
      }
      const d = await res.json().catch(() => null);
      if (res.status === 409) {
        // CLIENT_NO_PUBLISH: o cliente deixou de ter postagem pela agência depois que a tela abriu
        setRefused(true);
        setError(
          typeof d?.error === "string"
            ? d.error
            : d?.code === PUBLISH_BLOCKED.code
              ? PUBLISH_BLOCKED.message
              : "Este post não pode mais ser agendado."
        );
        return;
      }
      // N-14: só mostra `error` do servidor quando é texto (o 400 do zod é objeto)
      setError(typeof d?.error === "string" ? d.error : "Não foi possível agendar o post. Tente de novo.");
    } catch {
      setError("Falha de conexão ao agendar o post. Verifique a internet e tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="primary" leadingIcon={<Icon.check />} onClick={openDialog}>
        {needsClientApproval ? "Agendar sem aprovação" : "Aprovar e agendar"}
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title={blocked ? "Agendar mesmo assim?" : "Aprovar e agendar o post?"}
        description={`O post entra na fila de publicação e vai para ${joinPlatforms(targets)} em ${whenText}.`}
        busy={busy}
        error={error}
        initialFocusRef={blocked ? cancelRef : confirmRef}
        footer={
          <>
            <Button ref={cancelRef} variant="secondary" onClick={close} disabled={busy}>
              {refused ? "Entendi" : "Cancelar"}
            </Button>
            {!refused && (
              <Button
                ref={confirmRef}
                variant="primary"
                leadingIcon={<Icon.check />}
                loading={busy}
                loadingText="Agendando…"
                onClick={() => void approve()}
              >
                {blocked ? "Agendar assim" : "Aprovar e agendar"}
              </Button>
            )}
          </>
        }
      >
        {(!hasMedia || needsClientApproval || timing) && (
          <div className="grid gap-3 pb-2">
            {!hasMedia && (
              <Callout tone="danger" title="Este post não tem arte">
                Instagram e Facebook exigem mídia: na data marcada a publicação falha e o post vai para
                “Falhou”. <Link href={`/posts/${postId}/edit`}>Adicionar a mídia</Link>.
              </Callout>
            )}
            {needsClientApproval && (
              <Callout tone="warning" title={`${clientName} é do plano “com aprovação”`}>
                Agendar por aqui coloca o post na fila <strong>sem</strong> passar pela aprovação do cliente.
                {scheduleId && (
                  <>
                    {" "}
                    O caminho normal é enviar o cronograma em <Link href="/aprovacoes">Aprovações</Link>.
                  </>
                )}
              </Callout>
            )}
            {timing && (
              <Callout tone="warning">
                {timing === "past"
                  ? "A data marcada já passou: o post é publicado assim que entrar na fila."
                  : `Faltam menos de ${IMMINENT_MINUTES} minutos para a data marcada: o post é publicado em seguida.`}
              </Callout>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
