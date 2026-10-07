"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { ConfirmDialog } from "@/components/Dialog";
import { Field, Input, Select } from "@/components/Field";
import { Icon } from "@/components/Icons";
import { Toast, type ToastState } from "@/components/Toast";
import { PageHeader, ToneBadge } from "@/components/ui";
import { formatDateTime } from "@/lib/format-date";
import {
  OPENAI_KEY_MISSING,
  PROVIDER_LABELS,
  TEXT_MODEL_OPTIONS,
  isValidModelId,
  isValidOpenAiKey,
  maskedKey,
  modelLabel,
  normalizeModelId,
  type AiProvider,
} from "@/lib/ai-model-options";

type Info = {
  available: boolean;
  setting: { provider: AiProvider; model: string | null } | null;
  updatedAt: string | null;
  updatedByName: string | null;
  system: { caption: string; calendar: string };
};

/** Situação da chave da OpenAI (a chave nunca chega aqui). */
type KeyStatus = {
  available: boolean;
  configured: boolean;
  source: "saved" | "env" | null;
  last4: string | null;
  savedUnreadable: boolean;
  canSave: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
};

type TestResult = { model: string; label: string; ok: boolean; ms: number; error?: string };
type Selection = { provider: AiProvider; model: string | null };

const DEFAULT = "default";
const OTHER = "other";
const PROVIDERS: AiProvider[] = ["google", "openai"];

const OFFLINE = "Sem conexão com o servidor. Verifique a internet e tente de novo.";
const SESSION_EXPIRED = "Sua sessão expirou. Entre de novo para continuar.";
const ADMIN_ONLY = "Só administradores podem alterar os modelos de IA.";
const INVALID_ID = "ID inválido: use letras minúsculas, números, ponto e hífen, sem espaços (ex.: gemini-3.8-flash ou gpt-5-mini).";
const EMPTY_ID = "Digite o ID do modelo (ex.: gemini-3.8-flash ou gpt-5-mini).";
const KEY_FORMAT = "Chave inválida: a chave da OpenAI começa com “sk-” e não tem espaços.";
const KEY_EMPTY = "Cole a chave da API da OpenAI.";

/** O que a IA de texto faz no sistema (o que muda ao trocar o modelo). */
const USES = [
  "Legendas (botão “Gerar com IA” e as legendas do cronograma)",
  "Cronograma com IA (ideias do mês e “nova ideia”)",
  "Assistente de IA dos posts",
  "Resumo do dia no Dashboard",
  "Revisão semanal e artes-base do plano básico",
];

const optionValue = (provider: AiProvider, model: string) => `${provider}:${model}`;
const PRESETS = new Set(TEXT_MODEL_OPTIONS.map((o) => optionValue(o.provider, o.model)));

/** Configuração salva → opção do select (+ provedor/ID digitado quando é "Outro"). */
function choiceOf(info: Info): { choice: string; provider: AiProvider; custom: string } {
  const s = info.setting;
  if (!s?.model) return { choice: DEFAULT, provider: "google", custom: "" };
  const value = optionValue(s.provider, s.model);
  return PRESETS.has(value)
    ? { choice: value, provider: s.provider, custom: "" }
    : { choice: OTHER, provider: s.provider, custom: s.model };
}

function systemLabel(system: Info["system"]): string {
  return `Padrão do sistema (Gemini — legendas: ${system.caption} · calendário: ${system.calendar})`;
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

function fieldOf(data: unknown): unknown {
  return (data as { field?: unknown } | null)?.field;
}

function toKeyStatus(d: KeyStatus): KeyStatus {
  return {
    available: d.available,
    configured: d.configured,
    source: d.source,
    last4: d.last4,
    savedUnreadable: d.savedUnreadable,
    canSave: d.canSave,
    updatedAt: d.updatedAt,
    updatedByName: d.updatedByName,
  };
}

export default function AiModelSettings({ initial, initialKey }: { initial: Info; initialKey: KeyStatus }) {
  const [info, setInfo] = useState<Info>(initial);
  const [keyStatus, setKeyStatus] = useState<KeyStatus>(initialKey);
  const saved = choiceOf(info);
  const [choice, setChoice] = useState(saved.choice);
  const [otherProvider, setOtherProvider] = useState<AiProvider>(saved.provider);
  const [custom, setCustom] = useState(saved.custom);
  const [customError, setCustomError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<{ results: TestResult[] } | { error: string } | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  const [keyInput, setKeyInput] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const s = info.setting;
  const currentLabel = s?.model ? `${PROVIDER_LABELS[s.provider]} — ${modelLabel(s.model)}` : systemLabel(info.system);
  const customId = normalizeModelId(custom);
  const unchanged =
    choice === saved.choice && (choice !== OTHER || (customId === saved.custom && otherProvider === saved.provider));
  const chosenProvider: AiProvider =
    choice === DEFAULT ? "google" : choice === OTHER ? otherProvider : (choice.split(":")[0] as AiProvider);
  const openaiInUseWithoutKey = s?.provider === "openai" && !!s.model && !keyStatus.configured;

  /** Modelo do formulário: seleção, null (padrão do sistema) ou undefined (ID inválido, erro já mostrado). */
  function selected(): Selection | null | undefined {
    if (choice === DEFAULT) return null;
    if (choice !== OTHER) {
      const [provider, ...rest] = choice.split(":");
      return { provider: provider as AiProvider, model: rest.join(":") };
    }
    if (!customId) {
      setCustomError(EMPTY_ID);
    } else if (!isValidModelId(customId)) {
      setCustomError(INVALID_ID);
    } else {
      return { provider: otherProvider, model: customId };
    }
    document.getElementById("modelo-texto-id")?.focus();
    return undefined;
  }

  function clearFeedback() {
    setCustomError(null);
    setFormError(null);
    setTested(null);
  }

  /** Erro 400 de um campo → mensagem no campo certo. */
  function showFieldError(data: unknown, text: string, onOther: (t: string) => void) {
    const field = fieldOf(data);
    if (field === "model" && choice === OTHER) {
      setCustomError(text);
      document.getElementById("modelo-texto-id")?.focus();
    } else if (field === "openaiKey") {
      onOther(text);
      setKeyError(OPENAI_KEY_MISSING);
    } else {
      onOther(text);
    }
  }

  async function test() {
    setFormError(null);
    const sel = selected();
    if (sel === undefined) return;
    setTesting(true);
    setTested(null);
    try {
      const res = await fetch("/api/settings/ai-model/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sel ?? { provider: "google", model: null }),
      });
      const data: unknown = await res.json().catch(() => null);
      const results = (data as { results?: unknown } | null)?.results;
      if (!res.ok || !Array.isArray(results)) {
        const text = apiError(res.status, data, "Não foi possível testar o modelo agora. Tente de novo em instantes.");
        showFieldError(data, text, (t) => setTested({ error: t }));
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
    const sel = selected();
    if (sel === undefined) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/ai-model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sel ?? { provider: "google", model: null }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const text = apiError(res.status, data, "Não foi possível salvar o modelo agora. Tente de novo.");
        showFieldError(data, text, setFormError);
        return;
      }
      const next = data as Info & { label?: unknown };
      applyInfo({
        available: next.available,
        setting: next.setting,
        updatedAt: next.updatedAt,
        updatedByName: next.updatedByName,
        system: next.system,
      });
      const label = typeof next.label === "string" ? next.label : sel?.model ? modelLabel(sel.model) : "Padrão do sistema";
      setToast({ kind: "success", text: `Modelo de texto atualizado: ${label} — vale a partir da próxima geração.` });
    } catch {
      setFormError(OFFLINE);
    } finally {
      setSaving(false);
    }
  }

  /** Nova configuração do modelo → estado + formulário sincronizado com o que ficou salvo. */
  function applyInfo(nextInfo: Info) {
    setInfo(nextInfo);
    const synced = choiceOf(nextInfo);
    setChoice(synced.choice);
    setOtherProvider(synced.provider);
    setCustom(synced.custom);
  }

  async function saveKey(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const key = keyInput.trim();
    if (!key) return failKey(KEY_EMPTY);
    if (!isValidOpenAiKey(key)) return failKey(KEY_FORMAT);
    setKeyError(null);
    setSavingKey(true);
    try {
      const res = await fetch("/api/settings/ai-model/openai-key", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) return failKey(apiError(res.status, data, "Não foi possível salvar a chave agora. Tente de novo."));
      const next = toKeyStatus(data as KeyStatus);
      setKeyStatus(next);
      setKeyInput("");
      setFormError(null);
      setToast({
        kind: "success",
        text: `Chave da OpenAI salva${next.last4 ? ` (${maskedKey(next.last4)})` : ""}. Agora dá para testar e usar o ChatGPT.`,
      });
    } catch {
      failKey(OFFLINE);
    } finally {
      setSavingKey(false);
    }
  }

  function failKey(text: string) {
    setKeyError(text);
    document.getElementById("openai-chave")?.focus();
  }

  async function removeKey() {
    setRemoving(true);
    setRemoveError(null);
    try {
      const res = await fetch("/api/settings/ai-model/openai-key", { method: "DELETE" });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setRemoveError(apiError(res.status, data, "Não foi possível remover a chave agora. Tente de novo."));
        return;
      }
      const d = data as KeyStatus & { modelReset?: unknown; textModel?: Info };
      setKeyStatus(toKeyStatus(d));
      if (d.textModel) applyInfo(d.textModel);
      setRemoveOpen(false);
      setToast({
        kind: "success",
        text: `Chave da OpenAI removida.${d.modelReset === true ? " O modelo de texto voltou para o Padrão do sistema (Gemini)." : ""}`,
      });
    } catch {
      setRemoveError(OFFLINE);
    } finally {
      setRemoving(false);
    }
  }

  const allOk = tested && "results" in tested && tested.results.every((r) => r.ok);
  const removeConsequences = [
    "A chave salva é apagada do sistema.",
    keyStatus.source === "saved" && s?.provider === "openai" && s.model
      ? "Se não houver chave na variável de ambiente, o modelo de texto volta para o Padrão do sistema (Gemini)."
      : "O ChatGPT só volta a funcionar com uma chave nova.",
  ];

  return (
    <>
      <PageHeader title="Modelos de IA" subtitle="Qual inteligência artificial escreve os textos do sistema" />

      <div className="grid gap-6">
        <section aria-labelledby="modelo-texto-titulo" className="card p-5 sm:p-6">
          <h2 id="modelo-texto-titulo" className="font-display text-lg font-semibold tracking-title text-fg">
            Modelo de texto
          </h2>
          <p className="mt-1 max-w-prose text-sm text-fg-muted">
            Um modelo só para todo o texto que a IA escreve: Gemini (Google) ou ChatGPT (OpenAI). A troca vale na
            próxima geração, sem precisar publicar o sistema de novo.
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
          {openaiInUseWithoutKey && (
            <Callout tone="warning" className="mt-4">
              O ChatGPT está escolhido, mas não há chave da OpenAI: os textos estão saindo pelo padrão do sistema
              (Gemini). Salve a chave na seção abaixo.
            </Callout>
          )}

          <form noValidate onSubmit={save} className="mt-5 grid max-w-2xl gap-4">
            <Field
              id="modelo-texto"
              label="Modelo de texto"
              help="“Padrão do sistema” mantém o comportamento de antes: um modelo Gemini para as legendas e outro para o calendário."
            >
              <Select
                value={choice}
                onChange={(e) => {
                  setChoice(e.target.value);
                  clearFeedback();
                }}
              >
                <option value={DEFAULT}>{systemLabel(info.system)}</option>
                {PROVIDERS.map((p) => (
                  <optgroup key={p} label={PROVIDER_LABELS[p]}>
                    {TEXT_MODEL_OPTIONS.filter((o) => o.provider === p).map((o) => (
                      <option key={o.model} value={optionValue(o.provider, o.model)}>
                        {o.label} ({o.model})
                      </option>
                    ))}
                  </optgroup>
                ))}
                <option value={OTHER}>Outro (digitar o ID)</option>
              </Select>
            </Field>

            {choice === OTHER && (
              <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
                <Field id="modelo-texto-provedor" label="Provedor">
                  <Select
                    value={otherProvider}
                    onChange={(e) => {
                      setOtherProvider(e.target.value as AiProvider);
                      clearFeedback();
                    }}
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p} value={p}>
                        {PROVIDER_LABELS[p]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  id="modelo-texto-id"
                  label="ID do modelo"
                  required
                  help={
                    otherProvider === "openai"
                      ? "Como aparece na documentação da OpenAI, sem espaços. Ex.: gpt-5-mini."
                      : "Como aparece na documentação do Google AI, sem espaços. Ex.: gemini-3.8-flash."
                  }
                  error={customError}
                >
                  <Input
                    value={custom}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder={otherProvider === "openai" ? "gpt-5-mini" : "gemini-3.8-flash"}
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
              </div>
            )}

            {chosenProvider === "openai" && !keyStatus.configured && (
              <Callout tone="info">Para usar o ChatGPT, salve antes a chave da API da OpenAI (seção abaixo).</Callout>
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
              imagem do sistema. A verificação de texto das artes continua no Gemini.
            </p>
          </div>
        </section>

        <section aria-labelledby="openai-chave-titulo" className="card p-5 sm:p-6">
          <h2 id="openai-chave-titulo" className="font-display text-lg font-semibold tracking-title text-fg">
            Chave da API da OpenAI (ChatGPT)
          </h2>
          <p className="mt-1 max-w-prose text-sm text-fg-muted">
            Necessária para usar o ChatGPT. Fica guardada criptografada no banco e nunca é mostrada de novo: aqui
            aparecem só os 4 últimos caracteres.
          </p>

          <dl className="mt-4 grid gap-3 rounded-card border border-line bg-sunken p-4 text-sm sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-xs font-semibold uppercase tracking-overline text-fg-muted">Situação</dt>
              <dd className="mt-1">
                {keyStatus.source === "saved" ? (
                  <ToneBadge tone="success">
                    Configurada {keyStatus.last4 ? maskedKey(keyStatus.last4) : ""}
                  </ToneBadge>
                ) : keyStatus.source === "env" ? (
                  <ToneBadge tone="info">Usando a variável de ambiente</ToneBadge>
                ) : (
                  <ToneBadge tone="neutral">Não configurada</ToneBadge>
                )}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs font-semibold uppercase tracking-overline text-fg-muted">Última alteração</dt>
              <dd className="mt-1 text-fg">
                {keyStatus.source === "saved" && keyStatus.updatedAt
                  ? `${keyStatus.updatedByName ?? "Usuário removido"} · ${formatDateTime(keyStatus.updatedAt)}`
                  : "Nenhuma chave salva aqui"}
              </dd>
            </div>
          </dl>

          {keyStatus.savedUnreadable && (
            <Callout tone="warning" className="mt-4">
              A chave salva não pode mais ser lida pelo servidor (a chave de cifra mudou). Salve a chave de novo.
            </Callout>
          )}
          {!keyStatus.canSave && (
            <Callout tone="warning" className="mt-4">
              Não dá para guardar a chave com segurança: falta configurar a chave de cifra do servidor (TOKEN_ENC_KEY).
              Avise o responsável pelo servidor.
            </Callout>
          )}

          <form noValidate onSubmit={saveKey} className="mt-5 grid max-w-2xl gap-4">
            <Field
              id="openai-chave"
              label={keyStatus.source === "saved" ? "Nova chave da API da OpenAI" : "Chave da API da OpenAI"}
              help="Crie em platform.openai.com › API keys e cole aqui (começa com sk-)."
              error={keyError}
            >
              <Input
                type="password"
                value={keyInput}
                autoComplete="new-password"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="sk-…"
                className="font-mono"
                onChange={(e) => {
                  setKeyInput(e.target.value);
                  setKeyError(null);
                }}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                variant="primary"
                loading={savingKey}
                loadingText="Salvando…"
                disabled={!keyStatus.canSave || !keyStatus.available || removing}
              >
                Salvar chave
              </Button>
              {keyStatus.source === "saved" && (
                <Button
                  leadingIcon={<Icon.trash />}
                  disabled={savingKey}
                  onClick={() => {
                    setRemoveError(null);
                    setRemoveOpen(true);
                  }}
                >
                  Remover chave
                </Button>
              )}
            </div>
          </form>
        </section>
      </div>

      <ConfirmDialog
        open={removeOpen}
        title="Remover a chave da OpenAI?"
        consequences={removeConsequences}
        confirmLabel="Remover chave"
        tone="danger"
        busy={removing}
        busyLabel="Removendo…"
        error={removeError}
        onConfirm={() => void removeKey()}
        onCancel={() => setRemoveOpen(false)}
      />

      <Toast toast={toast} onClose={() => setToast(null)} />
    </>
  );
}
