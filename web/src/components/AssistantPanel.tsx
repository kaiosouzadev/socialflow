"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";

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

function BotIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M12 8V4M8 13h.01M16 13h.01M9 17h6" />
    </svg>
  );
}

/**
 * Chat interno com a IA sobre o post em edição. `getPost` é lido a cada envio,
 * então o assistente sempre vê o estado atual do formulário. Sugestões de
 * legenda chegam com botão "Usar esta legenda" (aplica via onApplyCaption).
 */
export function AssistantPanel({
  clientId,
  getPost,
  onApplyCaption,
  onApplyTitle,
  className = "",
}: {
  clientId: string;
  getPost: () => AssistantPostContext;
  onApplyCaption?: (caption: string) => void;
  onApplyTitle?: (title: string) => void;
  className?: string;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

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
        setError(typeof data?.error === "string" ? data.error : "Falha ao falar com o assistente.");
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: typeof data.reply === "string" ? data.reply : "…",
          title: typeof data.title === "string" ? data.title : undefined,
          caption: typeof data.caption === "string" ? data.caption : undefined,
          artPrompt: typeof data.artPrompt === "string" ? data.artPrompt : undefined,
        },
      ]);
    } catch {
      setError("Falha de conexão com o assistente. Tente novamente.");
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

  return (
    <div className={`flex flex-col rounded-2xl border border-[var(--color-border)] bg-white/[0.02] ${className}`}>
      {/* header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--color-border)]">
        <span
          className="flex items-center justify-center w-8 h-8 rounded-xl text-white shrink-0"
          style={{ background: "linear-gradient(135deg,#8b6dff,#a855f7)" }}
        >
          <BotIcon className="w-4.5 h-4.5" />
        </span>
        <div>
          <p className="text-sm font-semibold">SocialFlow AI Assistant</p>
          <p className="text-[11px] text-[var(--color-text-faint)]">
            Sugestões de legenda, tom, hashtags e artes
          </p>
        </div>
      </div>

      {/* messages */}
      <div ref={scrollRef} className="flex-1 min-h-40 max-h-[26rem] overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-xs text-[var(--color-text-muted)] space-y-2">
            <p>Peça ajuda com este post. Exemplos:</p>
            <div className="flex flex-wrap gap-1.5">
              {[
                "Deixe o tom mais agressivo para vendas",
                "Sugira hashtags",
                "Me dê uma ideia de arte",
              ].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="px-2.5 py-1 rounded-full border border-[var(--color-border)] text-[11px] text-[var(--color-text-muted)] hover:text-white hover:border-[var(--color-accent)]/50 transition-colors"
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
              <p className="max-w-[85%] rounded-2xl rounded-br-md bg-white/[0.07] px-3.5 py-2 text-sm whitespace-pre-wrap">
                {m.content}
              </p>
            </div>
          ) : (
            <div
              key={i}
              className="max-w-[95%] rounded-2xl rounded-bl-md border border-[var(--color-accent)]/25 bg-[var(--color-accent)]/[0.06] px-3.5 py-2.5 space-y-2.5"
            >
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</p>

              {m.title && (
                <div className="rounded-xl border border-[var(--color-border)] bg-black/25 p-3 space-y-2">
                  <p className="text-[11px] font-medium text-[var(--color-accent)]">
                    Sugestão de título
                  </p>
                  <p className="text-sm font-semibold leading-relaxed">{m.title}</p>
                  {onApplyTitle && (
                    <button
                      type="button"
                      onClick={() => onApplyTitle(m.title!)}
                      className="btn-ghost !py-1.5 !px-3 text-xs"
                    >
                      <Icon.check className="w-3.5 h-3.5" />
                      Usar este título
                    </button>
                  )}
                </div>
              )}

              {m.caption && (
                <div className="rounded-xl border border-[var(--color-border)] bg-black/25 p-3 space-y-2">
                  <p className="text-[11px] font-medium text-[var(--color-accent)]">
                    Sugestão de legenda
                  </p>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.caption}</p>
                  {onApplyCaption && (
                    <button
                      type="button"
                      onClick={() => onApplyCaption(m.caption!)}
                      className="btn-ghost !py-1.5 !px-3 text-xs"
                    >
                      <Icon.check className="w-3.5 h-3.5" />
                      Usar esta legenda
                    </button>
                  )}
                </div>
              )}

              {m.artPrompt && (
                <div className="rounded-xl border border-[var(--color-border)] bg-black/25 p-3 space-y-2">
                  <p className="text-[11px] font-medium text-[var(--color-accent)]">
                    Sugestão de arte (prompt)
                  </p>
                  <p className="text-xs font-mono whitespace-pre-wrap text-[var(--color-text-muted)]">
                    {m.artPrompt}
                  </p>
                  <button
                    type="button"
                    onClick={() => copyArtPrompt(m.artPrompt!, i)}
                    className="btn-ghost !py-1.5 !px-3 text-xs"
                  >
                    <Icon.link className="w-3.5 h-3.5" />
                    {copied === i ? "Copiado ✓" : "Copiar prompt"}
                  </button>
                </div>
              )}
            </div>
          )
        )}

        {busy && (
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            <Icon.refresh className="w-3.5 h-3.5 animate-spin text-[var(--color-accent)]" />
            Pensando…
          </div>
        )}
        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </div>

      {/* input */}
      <div className="p-3 border-t border-[var(--color-border)]">
        <div className="flex items-end gap-2">
          <textarea
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
            className="input flex-1 resize-none !rounded-2xl text-sm"
          />
          <button
            type="button"
            onClick={() => send()}
            disabled={busy || !input.trim()}
            aria-label="Enviar"
            className="flex items-center justify-center w-10 h-10 rounded-full text-white shrink-0 transition-opacity disabled:opacity-40"
            style={{ background: "linear-gradient(135deg,#8b6dff,#a855f7)" }}
          >
            <Icon.send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
