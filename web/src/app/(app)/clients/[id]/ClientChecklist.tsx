import { Icon } from "@/components/Icons";

type Item = { label: string; done: boolean; hint: string };

/**
 * O que ainda falta preencher no cliente.
 *
 * Briefing e credenciais vazios não chamavam atenção nenhuma na tela — ficavam
 * só como blocos em branco no meio da página. Aqui a lacuna aparece de cara,
 * com o motivo de cada campo importar.
 */
export default function ClientChecklist({
  hasBriefing,
  hasCredentials,
  hasToneOfVoice,
  activeAccounts,
  hasDriveFolder,
  hasLogo,
  tier,
}: {
  hasBriefing: boolean;
  hasCredentials: boolean;
  hasToneOfVoice: boolean;
  activeAccounts: number;
  hasDriveFolder: boolean;
  hasLogo: boolean;
  tier: string;
}) {
  const items: Item[] = [
    {
      label: "Conta social conectada",
      done: activeAccounts > 0,
      hint: "sem conta ativa nada publica",
    },
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
    // logo só aparece no link de aprovação; no plano básico a arte usa a marca
    {
      label: "Logo",
      done: hasLogo,
      hint: tier === "basica" ? "usada na arte gerada por IA" : "aparece no link de aprovação",
    },
  ];

  const missing = items.filter((i) => !i.done);

  if (missing.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl px-4 py-3 bg-emerald-500/[0.06] border border-emerald-500/20">
        <Icon.check className="w-4 h-4 text-emerald-400 shrink-0" />
        <p className="text-sm text-emerald-200/90">Cadastro completo.</p>
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2.5 mb-3">
        <Icon.alert className="w-4 h-4 text-amber-400 shrink-0" />
        <h2 className="font-semibold text-sm">
          Faltam {missing.length} {missing.length === 1 ? "item" : "itens"} no cadastro
        </h2>
        <span className="text-xs text-[var(--color-text-faint)]">
          {items.length - missing.length}/{items.length} prontos
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {items.map((i) => (
          <span
            key={i.label}
            title={i.hint}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${
              i.done
                ? "text-emerald-300 bg-emerald-500/[0.08] border-emerald-500/20"
                : "text-amber-200 bg-amber-500/[0.08] border-amber-500/25"
            }`}
          >
            {i.done ? <Icon.check className="w-3 h-3" /> : <Icon.alert className="w-3 h-3" />}
            {i.label}
          </span>
        ))}
      </div>

      <p className="text-xs text-[var(--color-text-faint)] mt-3">
        {missing.map((m) => `${m.label} — ${m.hint}`).join(" · ")}
      </p>
    </div>
  );
}
