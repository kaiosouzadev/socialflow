"use client";

import { useState } from "react";
import { Callout } from "@/components/Callout";
import { Icon } from "@/components/Icons";

type Item = {
  key: string;
  label: string;
  done: boolean;
  hint: string;
  /** âncora da seção (wrappers com estes ids em clients/[id]/page.tsx) */
  section: "contas" | "cadastro" | "briefing" | "credenciais";
  /** campo do Cadastro: se falta, o link usa o gancho #editar-<campo> do ClientInfoEditor (abre a edição e foca) */
  editField?: "toneOfVoice" | "driveFolderId" | "logoUrl";
};

/**
 * O que ainda falta preencher no cliente (U-17). Cada item é um link para a seção que o
 * resolve; campo do Cadastro que falta abre a edição já no campo (gancho #editar-<campo> do
 * ClientInfoEditor); Briefing e Credenciais rolam até a seção, com o botão "Preencher"/"Adicionar"
 * logo no topo. A explicação fica numa linha só (item em foco/sob o mouse; por padrão o 1º que
 * falta) e no aria-describedby de cada link.
 * Cliente "só produção" não cobra conta social: a agência não publica por ele.
 */
export default function ClientChecklist({
  hasBriefing,
  hasCredentials,
  hasToneOfVoice,
  activeAccounts,
  hasDriveFolder,
  hasLogo,
  tier,
  agencyPublishes = true,
}: {
  hasBriefing: boolean;
  hasCredentials: boolean;
  hasToneOfVoice: boolean;
  activeAccounts: number;
  hasDriveFolder: boolean;
  hasLogo: boolean;
  tier: string;
  /** false = só produção: o item "Conta social conectada" não se aplica */
  agencyPublishes?: boolean;
}) {
  const items: Item[] = [
    ...(agencyPublishes
      ? [
          {
            key: "contas",
            label: "Conta social conectada",
            done: activeAccounts > 0,
            hint: "sem conta ativa nada é publicado",
            section: "contas" as const,
          },
        ]
      : []),
    {
      key: "tom",
      label: "Tom de voz",
      done: hasToneOfVoice,
      hint: "a IA escreve as legendas a partir dele",
      section: "cadastro",
      editField: "toneOfVoice",
    },
    {
      key: "briefing",
      label: "Briefing",
      done: hasBriefing,
      hint: "contexto do negócio para os temas do calendário",
      section: "briefing",
    },
    {
      key: "credenciais",
      label: "Credenciais",
      done: hasCredentials,
      hint: "acessos do cliente, guardados criptografados",
      section: "credenciais",
    },
    {
      key: "drive",
      label: "Pasta no Drive",
      done: hasDriveFolder,
      hint: "origem das artes sincronizadas",
      section: "cadastro",
      editField: "driveFolderId",
    },
    // logo aparece no link de aprovação; no plano básico também vai na arte gerada
    {
      key: "logo",
      label: "Logo",
      done: hasLogo,
      hint: tier === "basica" ? "usada na arte gerada por IA" : "aparece no link de aprovação",
      section: "cadastro",
      editField: "logoUrl",
    },
  ];

  const missing = items.filter((i) => !i.done);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  if (missing.length === 0) {
    return <Callout tone="success">Cadastro completo.</Callout>;
  }

  const title =
    missing.length === 1 ? "Falta 1 item no cadastro" : `Faltam ${missing.length} itens no cadastro`;
  const active = items.find((i) => i.key === activeKey) ?? missing[0];

  return (
    <section aria-labelledby="checklist-titulo" className="card p-5">
      <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span aria-hidden="true" className="inline-flex size-4 shrink-0 text-warning-solid [&>svg]:size-full">
          <Icon.alert />
        </span>
        <h2 id="checklist-titulo" className="text-sm font-semibold text-fg">
          {title}
        </h2>
        <span className="text-xs text-fg-muted">
          {items.length - missing.length} de {items.length} prontos
        </span>
      </div>

      <ul className="flex flex-wrap gap-x-2">
        {items.map((i) => (
          <li key={i.key}>
            <a
              href={!i.done && i.editField ? `#editar-${i.editField}` : `#${i.section}`}
              aria-describedby={`checklist-dica-${i.key}`}
              onMouseEnter={() => setActiveKey(i.key)}
              onFocus={() => setActiveKey(i.key)}
              className="group inline-flex min-h-11 items-center rounded-control sm:min-h-10"
            >
              <span
                className={`inline-flex items-center gap-1.5 rounded-control border px-2.5 py-1 text-xs font-medium underline-offset-2 group-hover:underline ${
                  i.done
                    ? "border-success-line bg-success-bg text-success-fg"
                    : "border-warning-line bg-warning-bg text-warning-fg"
                }`}
              >
                <span aria-hidden="true" className="inline-flex size-3.5 [&>svg]:size-full">
                  {i.done ? <Icon.check /> : <Icon.alert />}
                </span>
                {i.label}
                <span className="sr-only">{i.done ? " (pronto)" : " (falta)"}</span>
              </span>
            </a>
            <span id={`checklist-dica-${i.key}`} hidden>
              {i.hint}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-1 text-xs text-fg-muted">
        <span className="font-medium text-fg">{active.label}:</span> {active.hint}.
      </p>
    </section>
  );
}
