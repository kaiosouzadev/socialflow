import { Callout } from "@/components/Callout";
import { Icon } from "@/components/Icons";

type Item = { label: string; done: boolean; hint: string };

/**
 * O que ainda falta preencher no cliente.
 *
 * Briefing e credenciais vazios não chamavam atenção nenhuma na tela — ficavam
 * só como blocos em branco no meio da página. Aqui a lacuna aparece de cara,
 * com o motivo de cada campo importar. Cliente "só produção" não cobra conta
 * social: a agência não publica por ele.
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
            label: "Conta social conectada",
            done: activeAccounts > 0,
            hint: "sem conta ativa nada é publicado",
          },
        ]
      : []),
    {
      label: "Tom de voz",
      done: hasToneOfVoice,
      hint: "a IA escreve as legendas a partir dele",
    },
    {
      label: "Briefing",
      done: hasBriefing,
      hint: "contexto do negócio para os temas do calendário",
    },
    {
      label: "Credenciais",
      done: hasCredentials,
      hint: "acessos do cliente, guardados criptografados",
    },
    {
      label: "Pasta no Drive",
      done: hasDriveFolder,
      hint: "origem das artes sincronizadas",
    },
    // logo aparece no link de aprovação; no plano básico também vai na arte gerada
    {
      label: "Logo",
      done: hasLogo,
      hint: tier === "basica" ? "usada na arte gerada por IA" : "aparece no link de aprovação",
    },
  ];

  const missing = items.filter((i) => !i.done);

  if (missing.length === 0) {
    return <Callout tone="success">Cadastro completo.</Callout>;
  }

  const title =
    missing.length === 1 ? "Falta 1 item no cadastro" : `Faltam ${missing.length} itens no cadastro`;

  return (
    <section aria-labelledby="checklist-titulo" className="card p-5">
      <div className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1">
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

      <ul className="flex flex-wrap gap-2">
        {items.map((i) => (
          <li
            key={i.label}
            title={i.hint}
            className={`inline-flex items-center gap-1.5 rounded-control border px-2.5 py-1 text-xs font-medium ${
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
          </li>
        ))}
      </ul>

      <ul className="mt-3 grid gap-0.5 text-xs text-fg-muted">
        {missing.map((m) => (
          <li key={m.label}>
            <span className="font-medium text-fg">{m.label}</span> — {m.hint}
          </li>
        ))}
      </ul>
    </section>
  );
}
