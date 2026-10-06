"use client";

import { useEffect, useId, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { Button } from "./Button";
import { Input } from "./Field";
import { Icon } from "./Icons";
import { MAX_EXTRA_EMAILS, isValidEmail, normalizeEmail } from "@/lib/client-emails";

/*
 * Lista de e-mails adicionais do cliente (DESIGN e.12, plano A3). Mesma regra de
 * `normalizeExtraEmails` (lib/client-emails): trim + minúsculas, formato válido,
 * sem duplicata, sem repetir o principal e no máximo 10. Dentro de <Field>, o
 * campo de digitar recebe o id/aria do Field (o rótulo foca nele).
 */

export type MultiEmailInputProps = {
  /** e-mails já normalizados (trim + minúsculas) */
  value: string[];
  onChange: (emails: string[]) => void;
  /** bloqueia repetir o e-mail principal */
  primaryEmail?: string;
  /** padrão 10 (MAX_EXTRA_EMAILS) */
  max?: number;
  /** <input type="hidden" name value={JSON.stringify(value)}> para formulários com FormData */
  name?: string;
  disabled?: boolean;
  /** formulário salvando: desabilita tudo e marca aria-busy na lista (aditivo ao contrato e.12) */
  busy?: boolean;
  /** erros vindos do servidor, por e-mail: { "a@x.com": "mensagem" } */
  errors?: Record<string, string>;
  /** vêm do Field quando omitidos */
  id?: string;
  "aria-describedby"?: string;
  invalid?: boolean;
};

/** Separadores aceitos ao digitar/colar vários de uma vez. */
const SEPARATORS = /[\s,;]+/;

function joinIds(...ids: (string | false | null | undefined)[]): string | undefined {
  const v = ids.filter(Boolean).join(" ");
  return v || undefined;
}

type PendingFocus = { kind: "input" } | { kind: "remove"; index: number } | null;

export function MultiEmailInput({
  value,
  onChange,
  primaryEmail,
  max = MAX_EXTRA_EMAILS,
  name,
  disabled = false,
  busy = false,
  errors,
  id,
  "aria-describedby": describedBy,
  invalid,
}: MultiEmailInputProps) {
  const [draft, setDraft] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const removeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const pendingFocus = useRef<PendingFocus>(null);
  const baseId = useId();
  const errorId = `${baseId}-erro`;
  const limitId = `${baseId}-limite`;

  const primary = primaryEmail ? normalizeEmail(primaryEmail) : "";
  const blocked = disabled || busy;
  const atLimit = value.length >= max;

  // foco depois de adicionar/remover (o botão "Remover" seguinte só existe após o render)
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    if (target.kind === "remove" && removeRefs.current[target.index]) {
      removeRefs.current[target.index]?.focus();
    } else if (inputRef.current && !inputRef.current.disabled) {
      inputRef.current.focus();
    } else {
      // no limite o campo fica desabilitado: o foco vai para o último "Remover"
      removeRefs.current[value.length - 1]?.focus();
    }
  }, [value]);

  function counterText(n: number) {
    return `${n} de ${max}`;
  }

  /** Adiciona os e-mails do texto; o que não entrar fica no campo com a explicação. */
  function addFrom(text: string, fromButton = false) {
    const tokens = text.split(SEPARATORS).map((t) => t.trim()).filter(Boolean);
    if (tokens.length === 0) {
      // "Adicionar" fica sempre habilitado: com o campo vazio, explica em vez de não fazer nada (U-07)
      if (fromButton) {
        setDraft("");
        setInputError("Digite o e-mail que você quer adicionar.");
        inputRef.current?.focus();
      }
      return;
    }
    const single = tokens.length === 1;
    const next = [...value];
    const added: string[] = [];
    const invalidTokens: string[] = [];
    const duplicates: string[] = [];
    const repeatsPrimary: string[] = [];
    const overflow: string[] = [];

    for (const token of tokens) {
      const email = normalizeEmail(token);
      if (!isValidEmail(email)) invalidTokens.push(token);
      else if (primary && email === primary) repeatsPrimary.push(email);
      else if (next.includes(email)) duplicates.push(email);
      else if (next.length >= max) overflow.push(token);
      else {
        next.push(email);
        added.push(email);
      }
    }

    const messages: string[] = [];
    if (invalidTokens.length > 0) {
      messages.push(
        single ? `“${invalidTokens[0]}” não é um e-mail válido.` : `Não reconhecidos: ${invalidTokens.join(", ")}`,
      );
    }
    if (repeatsPrimary.length > 0) {
      messages.push(single ? "Esse já é o e-mail principal." : `${repeatsPrimary[0]} já é o e-mail principal.`);
    }
    if (duplicates.length > 0) {
      messages.push(single ? "Esse e-mail já está na lista." : `Já estavam na lista: ${duplicates.join(", ")}.`);
    }
    if (overflow.length > 0) messages.push(`Limite de ${max} e-mails adicionais atingido.`);

    // um só e-mail recusado continua no campo para corrigir; colando vários, ficam só os não reconhecidos
    const leftover = single ? (added.length > 0 ? [] : tokens) : [...invalidTokens, ...overflow];
    setDraft(leftover.join(", "));
    setInputError(messages.length > 0 ? messages.join(" ") : null);

    if (added.length > 0) {
      onChange(next);
      setAnnouncement(
        added.length === 1
          ? `E-mail adicionado: ${added[0]}. ${counterText(next.length)}.`
          : `${added.length} e-mails adicionados. ${counterText(next.length)}.`,
      );
      pendingFocus.current = { kind: "input" };
    }
  }

  function remove(index: number) {
    const email = value[index];
    const next = value.filter((_, i) => i !== index);
    onChange(next);
    setAnnouncement(`E-mail removido: ${email}.`);
    // próximo "Remover"; senão o anterior; lista vazia → o campo
    pendingFocus.current =
      next.length === 0
        ? { kind: "input" }
        : { kind: "remove", index: index < next.length ? index : next.length - 1 };
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // Enter não envia o formulário: adiciona. Backspace no campo vazio não remove nada.
    if (e.key === "Enter" || e.key === "," || e.key === ";") {
      e.preventDefault();
      addFrom(draft);
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text");
    if (!SEPARATORS.test(pasted.trim())) return; // um só: deixa colar normalmente
    e.preventDefault();
    addFrom(`${draft} ${pasted}`);
  }

  const itemTextClass = blocked ? "text-fg-disabled" : "text-fg";

  return (
    <div className="grid gap-2">
      {value.length === 0 ? (
        <p className="text-sm text-fg-muted">Nenhum e-mail adicional.</p>
      ) : (
        <ul aria-label="E-mails adicionais" aria-busy={busy || undefined} className="grid gap-1.5">
          {value.map((email, index) => {
            const itemError =
              errors?.[email] ?? (primary && email === primary ? "Esse já é o e-mail principal." : undefined);
            const itemErrorId = `${baseId}-item-${index}`;
            return (
              <li key={email} className="grid gap-1">
                <div
                  className={`flex h-11 items-center gap-2 rounded-control border bg-surface pl-3 pr-0.5 sm:h-10 ${
                    itemError ? "border-danger-solid" : "border-line"
                  } ${blocked ? "" : "hover:bg-hover"}`}
                >
                  <span title={email} className={`min-w-0 flex-1 truncate text-sm ${itemTextClass}`}>
                    {email}
                  </span>
                  <Button
                    ref={(el) => {
                      removeRefs.current[index] = el;
                    }}
                    iconOnly
                    variant="ghost"
                    size="sm"
                    aria-label={`Remover ${email}`}
                    aria-describedby={itemError ? itemErrorId : undefined}
                    disabled={blocked}
                    onClick={() => remove(index)}
                  >
                    <Icon.x />
                  </Button>
                </div>
                {itemError && (
                  <p id={itemErrorId} className="text-xs font-medium text-danger-fg">
                    {itemError}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <Input
          ref={inputRef}
          id={id}
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="nome@empresa.com.br"
          value={draft}
          disabled={blocked || atLimit}
          invalid={inputError ? true : invalid}
          aria-describedby={joinIds(describedBy, inputError && errorId, atLimit && limitId)}
          onChange={(e) => {
            setDraft(e.target.value);
            if (inputError) setInputError(null);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          className="sm:flex-1"
        />
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={<Icon.plus />}
          disabled={blocked || atLimit}
          // no limite, o motivo está escrito logo abaixo ("Limite de 10…")
          aria-describedby={atLimit ? limitId : undefined}
          onClick={() => addFrom(draft, true)}
          className="sm:mt-1"
        >
          Adicionar
        </Button>
      </div>

      {inputError && (
        <p id={errorId} className="flex items-start gap-1 text-xs font-medium text-danger-fg">
          <span aria-hidden="true" className="mt-px inline-flex size-3.5 shrink-0 text-danger-solid [&>svg]:size-full">
            <Icon.alert />
          </span>
          {inputError}
        </p>
      )}

      <div className="flex items-start justify-between gap-3">
        <p id={limitId} className="text-xs text-fg-muted">
          {atLimit ? `Limite de ${max} e-mails adicionais atingido.` : null}
        </p>
        <p className="shrink-0 text-xs tabular-nums text-fg-muted">{counterText(value.length)}</p>
      </div>

      <p role="status" className="sr-only">
        {announcement}
      </p>
      {name && <input type="hidden" name={name} value={JSON.stringify(value)} />}
    </div>
  );
}
