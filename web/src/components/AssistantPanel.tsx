"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button, Spinner } from "./Button";
import { Callout } from "./Callout";
import { Icon } from "./Icons";
import { hasOpenPopover } from "./Popover";
import { toUserMessage } from "@/lib/user-facing-error";

export type AssistantPostContext = {
  theme?: string;
  format?: string;
  targets?: string[];
  caption?: string;
  scheduledAt?: string;
  slides?: string[];
};

type Msg = {
  role: "user" | "assistant";
  content: string;
  title?: string;
  caption?: string;
  artPrompt?: string;
};

const ASSISTANT_ERROR = "O assistente não conseguiu responder agora. Tente de novo em instantes.";
const DEFAULT_SUBTITLE = "Sugestões de legenda, tom, hashtags e artes";
const SUGGESTIONS = ["Deixe o tom mais agressivo para vendas", "Sugira hashtags", "Me dê uma ideia de arte"];

const INPUT =
  "max-h-40 min-h-11 w-full min-w-0 flex-1 resize-none rounded-control border border-line-strong bg-surface px-3 py-2.5 text-base text-fg transition-colors duration-(--sf-dur-fast) placeholder:text-fg-faint hover:border-fg-muted focus:border-focus focus:outline-2 focus:outline-offset-1 focus:outline-focus sm:min-h-10 sm:text-sm";

function BotIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M12 8V4M8 13h.01M16 13h.01M9 17h6" />
    </svg>
  );
}

/** Bloco de sugestão (título, legenda ou prompt de arte) dentro da resposta. */
function Suggestion({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-control border border-line bg-sunken p-3">
      <p className="text-xs font-semibold text-fg-muted">{label}</p>
      {children}
    </div>
  );
}

/**
 * Chat interno com a IA sobre o post em edição. `getPost` é lido a cada envio,
 * então o assistente sempre vê o estado atual do formulário. Sugestões de
 * legenda chegam com botão "Usar esta legenda" (aplica via onApplyCaption).
 *
 * Semântica (A-039): sem `onClose` é um painel fixo da página (<section> com
 * título). Com `onClose` vira um painel lateral com role="dialog": recebe o
 * foco ao abrir, Esc (com o foco dentro) e o X chamam `onClose`, e o foco
 * volta para onde estava ao fechar.
 */
export function AssistantPanel({
  clientId,
  getPost,
  onApplyCaption,
  onApplyTitle,
  className = "",
  onClose,
  subtitle,
}: {
  clientId: string;
  getPost: () => AssistantPostContext;
  onApplyCaption?: (caption: string) => void;
  onApplyTitle?: (title: string) => void;
  className?: string;
  /** Pedido de fechar (Esc ou X). Com ele, o painel vira role="dialog" e cuida do foco. */
  onClose?: () => void;
  /** Linha sob o título (ex.: o tema do post). Padrão: o que o assistente faz. */
  subtitle?: React.ReactNode;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const subtitleId = useId();
  const inputId = useId();
  const isDialog = !!onClose;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  // Como painel/diálogo: foco no campo ao abrir e de volta ao gatilho ao fechar.
  useEffect(() => {
    if (!isDialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      if ((!active || active === document.body) && previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [isDialog]);

  function onPanelKeyDown(e: KeyboardEvent<HTMLElement>) {
    // um Popover aberto (ex.: seletor de data) fecha primeiro, por conta própria
    if (e.key !== "Escape" || !onClose || e.defaultPrevented || hasOpenPopover()) return;
    // não deixa o Esc chegar a um Dialog por baixo (nem ao fechamento nativo do <dialog>)
    e.preventDefault();
    e.stopPropagation();
    onClose();
  }

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setInput("");
    setError("");
    const history = [...messages, { role: "user" as const, content }];
    setMessages(history);
    setBusy(true);
    try {
      // últimos 12 turnos (limite da rota é 20); Gemini exige que a conversa
      // comece com turno de usuário — descarta resposta órfã no início
      const turns = history.slice(-12);
      while (turns[0]?.role === "assistant") turns.shift();
      // trunca no cliente para nunca estourar os limites da rota
      const raw = getPost();
      const post = {
        ...raw,
        theme: raw.theme?.slice(0, 400),
        caption: raw.caption?.slice(0, 8000),
        slides: raw.slides?.slice(0, 20).map((s) => s.slice(0, 2000)),
      };
      const res = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          post,
          messages: turns.map((m) => ({
            role: m.role,
            content: m.content.slice(0, 4000),
          })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(toUserMessage(data, ASSISTANT_ERROR));
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: typeof data?.reply === "string" ? data.reply : "…",
          title: typeof data?.title === "string" ? data.title : undefined,
          caption: typeof data?.caption === "string" ? data.caption : undefined,
          artPrompt: typeof data?.artPrompt === "string" ? data.artPrompt : undefined,
        },
      ]);
    } catch {
      setError("Falha de conexão com o assistente. Verifique a internet e tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  function copyArtPrompt(prompt: string, idx: number) {
    navigator.clipboard
      ?.writeText(prompt)
      .then(() => {
        setCopied(idx);
        setTimeout(() => setCopied(-1), 2000);
      })
      .catch(() => setError("Não foi possível copiar. Selecione o texto manualmente."));
  }

  const Root = isDialog ? "div" : "section";
  const rootA11y = isDialog
    ? { role: "dialog" as const, "aria-labelledby": titleId, "aria-describedby": subtitleId }
    : { "aria-labelledby": titleId };

  return (
    <Root
      {...rootA11y}
      onKeyDown={onPanelKeyDown}
      className={`flex flex-col rounded-card border border-line bg-surface text-fg ${className}`}
    >
      {/* header */}
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-control bg-brand text-on-brand"
        >
          <BotIcon className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-sm font-semibold text-fg">
            Assistente de IA
          </h2>
          <p id={subtitleId} className="text-xs text-fg-muted">
            {subtitle ?? DEFAULT_SUBTITLE}
          </p>
        </div>
        {onClose && (
          <Button iconOnly variant="ghost" size="sm" aria-label="Fechar assistente" onClick={onClose} className="-mr-1.5">
            <Icon.x />
          </Button>
        )}
      </div>

      {/* messages */}
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-label="Conversa com o assistente"
        aria-busy={busy || undefined}
        tabIndex={0}
        className="max-h-104 min-h-40 flex-1 space-y-3 overflow-y-auto p-4"
      >
        {messages.length === 0 && (
          <div className="space-y-2 text-sm text-fg-muted">
            <p>Peça ajuda com este post. Exemplos:</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  disabled={busy}
                  className="inline-flex min-h-10 items-center rounded-full border border-line-strong px-3 py-1.5 text-left text-xs text-fg-muted transition-colors duration-(--sf-dur-fast) hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:text-fg-disabled sm:min-h-8"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-card rounded-br-chip bg-neutral-bg px-3.5 py-2 text-sm text-fg">
                {m.content}
              </p>
            </div>
          ) : (
            <div
              key={i}
              className="max-w-[95%] space-y-2.5 rounded-card rounded-bl-chip border border-line bg-raised px-3.5 py-2.5"
            >
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{m.content}</p>

              {m.title && (
                <Suggestion label="Sugestão de título">
                  <p className="text-sm font-semibold leading-relaxed text-fg">{m.title}</p>
                  {onApplyTitle && (
                    <Button size="sm" leadingIcon={<Icon.check />} onClick={() => onApplyTitle(m.title!)}>
                      Usar este título
                    </Button>
                  )}
                </Suggestion>
              )}

              {m.caption && (
                <Suggestion label="Sugestão de legenda">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{m.caption}</p>
                  {onApplyCaption && (
                    <Button size="sm" leadingIcon={<Icon.check />} onClick={() => onApplyCaption(m.caption!)}>
                      Usar esta legenda
                    </Button>
                  )}
                </Suggestion>
              )}

              {m.artPrompt && (
                <Suggestion label="Sugestão de arte (prompt)">
                  <p className="whitespace-pre-wrap font-mono text-xs text-fg-muted">{m.artPrompt}</p>
                  <Button size="sm" leadingIcon={<Icon.copy />} onClick={() => copyArtPrompt(m.artPrompt!, i)}>
                    {copied === i ? "Copiado" : "Copiar prompt"}
                  </Button>
                </Suggestion>
              )}
            </div>
          )
        )}

        {busy && (
          <p className="flex items-center gap-2 text-xs text-fg-muted">
            <Spinner size={16} />
            Pensando…
          </p>
        )}
        {error && <Callout tone="danger">{error}</Callout>}
      </div>

      {/* input */}
      <div className="border-t border-line p-3">
        <div className="flex items-end gap-2">
          <label htmlFor={inputId} className="sr-only">
            Mensagem para o assistente
          </label>
          <textarea
            ref={inputRef}
            id={inputId}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Peça para alterar o tom, sugerir hashtags…"
            className={INPUT}
          />
          <Button
            iconOnly
            variant="primary"
            aria-label="Enviar mensagem"
            loading={busy}
            disabled={!input.trim()}
            onClick={() => send()}
          >
            <Icon.send />
          </Button>
        </div>
      </div>
    </Root>
  );
}
