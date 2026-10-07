"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { Field, Input, Select } from "@/components/Field";
import { Icon } from "@/components/Icons";
import { Toast, type ToastState } from "@/components/Toast";
import { PageHeader, ToneBadge } from "@/components/ui";
import { formatDateTime } from "@/lib/format-date";
import { TEXT_MODEL_OPTIONS, isValidModelId, modelLabel, normalizeModelId } from "@/lib/ai-model-options";

type Info = {
  available: boolean;
  setting: { provider: "google" | "openai"; model: string | null } | null;
  updatedAt: string | null;
  updatedByName: string | null;
  system: { caption: string; calendar: string };
};

type TestResult = { model: string; label: string; ok: boolean; ms: number; error?: string };

const DEFAULT = "default";
const OTHER = "other";

const OFFLINE = "Sem conexão com o servidor. Verifique a internet e tente de novo.";
const SESSION_EXPIRED = "Sua sessão expirou. Entre de novo para continuar.";
const ADMIN_ONLY = "Só administradores podem alterar os modelos de IA.";
const INVALID_ID = "ID inválido: use letras minúsculas, números, ponto e hífen, sem espaços (ex.: gemini-3.8-flash).";
const EMPTY_ID = "Digite o ID do modelo (ex.: gemini-3.8-flash).";

/** O que a IA de texto faz no sistema (o que muda ao trocar o modelo). */
const USES = [
  "Legendas (botão “Gerar com IA” e as legendas do cronograma)",
  "Cronograma com IA (ideias do mês e “nova ideia”)",
  "Assistente de IA dos posts",
  "Resumo do dia no Dashboard",
  "Revisão semanal e artes-base do plano básico",
  "Verificação do texto das artes geradas",
];

const PRESETS = new Set(TEXT_MODEL_OPTIONS.map((o) => o.model));

/** Configuração salva → opção do select (+ ID digitado quando é "Outro"). */
function choiceOf(info: Info): { choice: string; custom: string } {
  const model = info.setting?.provider === "google" ? info.setting.model : null;
  if (!model) return { choice: DEFAULT, custom: "" };
  return PRESETS.has(model) ? { choice: model, custom: "" } : { choice: OTHER, custom: model };
}

function systemLabel(system: Info["system"]): string {
  return `Padrão do sistema (legendas: ${system.caption} · calendário: ${system.calendar})`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
}

function apiError(status: number, data: unknown, fallback: string): string {
  if (status === 401) return SESSION_EXPIRED;
  if (status === 403) return ADMIN_ONLY;
  const error = (data as { error?: unknown } | null)?.error;
  // N-14: só frase pronta da API; objeto (zod) ou vazio → texto da própria tela
  return typeof error === "string" && error.trim() ? error : fallback;
}

export default function AiModelSettings({ initial }: { initial: Info }) {
  const [info, setInfo] = useState<Info>(initial);
  const saved = choiceOf(info);
  const [choice, setChoice] = useState(saved.choice);
  const [custom, setCustom] = useState(saved.custom);
  const [customError, setCustomError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<{ results: TestResult[] } | { error: string } | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  const currentLabel = saved.choice === DEFAULT ? systemLabel(info.system) : modelLabel(info.setting?.model ?? "");
  const customId = normalizeModelId(custom);
  const unchanged = choice === saved.choice && (choice !== OTHER || customId === saved.custom);

  /** Modelo do formulário: string, null (padrão do sistema) ou undefined (ID inválido, erro já mostrado). */
  function selectedModel(): string | null | undefined {
    if (choice === DEFAULT) return null;
    if (choice !== OTHER) return choice;
    if (!customId) {
      setCustomError(EMPTY_ID);
    } else if (!isValidModelId(customId)) {
      setCustomError(INVALID_ID);
    } else {
      return customId;
    }
    document.getElementById("modelo-texto-id")?.focus();
    return undefined;
  }

  function onChoice(value: string) {
    setChoice(value);
    setCustomError(null);
    setFormError(null);
    setTested(null);
  }

  async function test() {
    setFormError(null);
    const model = selectedModel();
    if (model === undefined) return;
    setTesting(true);
    setTested(null);
    try {
      const res = await fetch("/api/settings/ai-model/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "google", model }),
      });
      const data: unknown = await res.json().catch(() => null);
      const results = (data as { results?: unknown } | null)?.results;
      if (!res.ok || !Array.isArray(results)) {
        const text = apiError(res.status, data, "Não foi possível testar o modelo agora. Tente de novo em instantes.");
        if (res.status === 400 && (data as { field?: unknown } | null)?.field === "model" && choice === OTHER) {
          setCustomError(text);
        } else {
          setTested({ error: text });
        }
        return;
      }
      setTested({ results: results as TestResult[] });
    } catch {
      setTested({ error: OFFLINE });
    } finally {
      setTesting(false);
    }
  }

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const model = selectedModel();
    if (model === undefined) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/ai-model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "google", model }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const text = apiError(res.status, data, "Não foi possível salvar o modelo agora. Tente de novo.");
        if (res.status === 400 && (data as { field?: unknown } | null)?.field === "model" && choice === OTHER) {
          setCustomError(text);
          document.getElementById("modelo-texto-id")?.focus();
        } else {
          setFormError(text);
        }
        return;
      }
      const next = data as Info & { label?: unknown };
      const nextInfo: Info = {
        available: next.available,
        setting: next.setting,
        updatedAt: next.updatedAt,
        updatedByName: next.updatedByName,
        system: next.system,
      };
      setInfo(nextInfo);
      // o formulário passa a mostrar o que ficou salvo (ex.: "Outro" com um ID da lista vira a opção pronta)
      const synced = choiceOf(nextInfo);
      setChoice(synced.choice);
      setCustom(synced.custom);
      const label = typeof next.label === "string" ? next.label : model ? modelLabel(model) : "Padrão do sistema";
      setToast({ kind: "success", text: `Modelo de texto atualizado: ${label} — vale a partir da próxima geração.` });
    } catch {
      setFormError(OFFLINE);
    } finally {
      setSaving(false);
    }
  }

  const allOk = tested && "results" in tested && tested.results.every((r) => r.ok);

  return (
    <>
      <PageHeader title="Modelos de IA" subtitle="Qual inteligência artificial escreve os textos do sistema" />

      <div className="grid gap-6">
        <section aria-labelledby="modelo-texto-titulo" className="card p-5 sm:p-6">
          <h2 id="modelo-texto-titulo" className="font-display text-lg font-semibold tracking-title text-fg">
            Modelo de texto
          </h2>
          <p className="mt-1 max-w-prose text-sm text-fg-muted">
            Um modelo só para todo o texto que a IA escreve. A troca vale na próxima geração, sem precisar publicar o
            sistema de novo.
          </p>

          <dl className="mt-4 grid gap-3 rounded-card border border-line bg-sunken p-4 text-sm sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-xs font-semibold uppercase tracking-overline text-fg-muted">Em uso agora</dt>
              <dd className="mt-1 wrap-break-word font-medium text-fg">{currentLabel}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs font-semibold uppercase tracking-overline text-fg-muted">Última alteração</dt>
              <dd className="mt-1 text-fg">
                {info.updatedAt
                  ? `${info.updatedByName ?? "Usuário removido"} · ${formatDateTime(info.updatedAt)}`
                  : "Nunca alterado (vale o padrão do sistema)"}
              </dd>
            </div>
          </dl>

          {!info.available && (
            <Callout tone="warning" className="mt-4">
              A configuração de modelos ainda não está disponível neste servidor (falta atualizar o banco). Por enquanto
              vale o padrão do sistema; o teste funciona, mas não dá para salvar.
            </Callout>
          )}

          <form noValidate onSubmit={save} className="mt-5 grid max-w-2xl gap-4">
            <Field
              id="modelo-texto"
              label="Modelo de texto"
              help="“Padrão do sistema” mantém o comportamento de antes: um modelo para as legendas e outro para o calendário."
            >
              <Select value={choice} onChange={(e) => onChoice(e.target.value)}>
                <option value={DEFAULT}>{systemLabel(info.system)}</option>
                {TEXT_MODEL_OPTIONS.map((o) => (
                  <option key={o.model} value={o.model}>
                    {o.label} ({o.model})
                  </option>
                ))}
                <option value={OTHER}>Outro (digitar o ID)</option>
              </Select>
            </Field>

            {choice === OTHER && (
              <Field
                id="modelo-texto-id"
                label="ID do modelo"
                required
                help="Como aparece na documentação do Google AI, sem espaços. Ex.: gemini-3.8-flash."
                error={customError}
              >
                <Input
                  value={custom}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="gemini-3.8-flash"
                  className="font-mono"
                  // validação só em "Testar"/"Salvar": validar no blur faria a mensagem empurrar os botões
                  // para baixo no meio do clique (o clique se perde)
                  onChange={(e) => {
                    setCustom(e.target.value);
                    setCustomError(null);
                    setTested(null);
                  }}
                />
              </Field>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                leadingIcon={<Icon.zap />}
                loading={testing}
                loadingText="Testando…"
                disabled={saving}
                onClick={() => void test()}
              >
                Testar modelo
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={saving}
                loadingText="Salvando…"
                disabled={!info.available || unchanged || testing}
              >
                Salvar
              </Button>
            </div>

            <div aria-live="polite" className="empty:hidden">
              {tested &&
                ("error" in tested ? (
                  <Callout tone="danger" title="O teste não foi feito">
                    {tested.error}
                  </Callout>
                ) : (
                  <Callout tone={allOk ? "success" : "danger"} title={allOk ? "O modelo respondeu" : "O modelo não respondeu"}>
                    <ul className="grid gap-1">
                      {tested.results.map((r) => (
                        <li key={r.model} className="wrap-break-word">
                          <span className="font-medium">{r.label}</span>:{" "}
                          {r.ok ? `OK em ${seconds(r.ms)}` : r.error ?? "não respondeu."}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-fg-muted">O teste não salva nada. Para usar o modelo, clique em Salvar.</p>
                  </Callout>
                ))}
            </div>

            {formError && (
              <Callout tone="danger" live="assertive">
                {formError}
              </Callout>
            )}
          </form>

          <div className="mt-6 border-t border-line pt-5">
            <h3 className="text-sm font-semibold text-fg">O que muda ao trocar o modelo</h3>
            <ul className="mt-2 grid list-disc gap-1 pl-5 text-sm text-fg-muted">
              {USES.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-fg">
              <span className="font-medium">Não muda:</span> a geração de imagens das artes, que continua no modelo de
              imagem do sistema.
            </p>
          </div>
        </section>

        <section aria-labelledby="chatgpt-titulo" className="card p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="chatgpt-titulo" className="font-display text-lg font-semibold tracking-title text-fg">
              ChatGPT
            </h2>
            <ToneBadge tone="neutral">Em breve</ToneBadge>
          </div>
          <p className="mt-1 max-w-prose text-sm text-fg-muted">
            A tela já está pronta para o ChatGPT (OpenAI). Quando a integração for liberada, os modelos dele aparecem
            aqui para comparar com o Gemini. Por enquanto não está disponível.
          </p>
          <div className="mt-4 max-w-2xl">
            <Field id="modelo-chatgpt" label="Modelo do ChatGPT" help="Indisponível até a integração com a OpenAI.">
              <Select disabled defaultValue="">
                <option value="">Em breve</option>
              </Select>
            </Field>
          </div>
        </section>
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </>
  );
}
