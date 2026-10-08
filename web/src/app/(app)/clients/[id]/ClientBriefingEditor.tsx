"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { Field, Input, Textarea } from "@/components/Field";
import { Icon } from "@/components/Icons";

export type Briefing = {
  products?: string;
  themes?: string;
  hashtags?: string;
  partnerships?: string;
  observations?: string;
  restrictions?: string;
  mandatoryArtText?: string;
  designNotes?: string;
  plan?: string;
  responsibleTech?: string;
  // questionário completo do onboarding (S14)
  audience?: string;
  competitors?: string;
  differential?: string;
  references?: string;
  anniversary?: string;
  linkedinUrl?: string;
  linkedinRepost?: string;
  positioning?: string;
};

export type BriefingClient = {
  id: string;
  tradeName: string | null;
  website: string | null;
  city: string | null;
  phone: string | null;
  whatsapp: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  briefing: Briefing | null;
};

type ContactKey = "tradeName" | "website" | "city" | "phone" | "whatsapp" | "facebookUrl" | "instagramUrl";

const CONTACT_FIELDS: { key: ContactKey; label: string; inputMode?: "tel" | "url" }[] = [
  { key: "tradeName", label: "Nome fantasia" },
  { key: "website", label: "Site", inputMode: "url" },
  { key: "city", label: "Cidade / UF" },
  { key: "phone", label: "Telefone fixo", inputMode: "tel" },
  { key: "whatsapp", label: "WhatsApp", inputMode: "tel" },
  { key: "facebookUrl", label: "Facebook (URL)", inputMode: "url" },
  { key: "instagramUrl", label: "Instagram (URL)", inputMode: "url" },
];

type BriefingField = { key: keyof Briefing; label: string; area?: boolean; help?: string };

/** Rótulos iguais aos do importador (lib/doc-import-commit) para a equipe reconhecer os campos. */
const BRIEFING_GROUPS: { title: string; fields: BriefingField[] }[] = [
  {
    title: "Negócio e público",
    fields: [
      { key: "products", label: "Produtos / serviços", area: true },
      { key: "audience", label: "Público-alvo", area: true },
      { key: "positioning", label: "Posicionamento da marca", area: true },
      { key: "differential", label: "Principal diferencial", area: true },
      { key: "competitors", label: "Principais concorrentes", area: true },
      { key: "partnerships", label: "Parcerias / convênios", area: true },
      { key: "anniversary", label: "Aniversário da empresa", help: "Ex.: 12/03 ou março de 2010." },
    ],
  },
  {
    title: "Conteúdo",
    fields: [
      { key: "themes", label: "Principais temas a abordar", area: true },
      { key: "references", label: "Páginas de referência", area: true },
      {
        key: "hashtags",
        label: "Hashtags",
        area: true,
        help: "Entra automaticamente no fim de todas as legendas geradas pela IA.",
      },
      { key: "restrictions", label: "Restrições (datas, religião, etc.)" },
      { key: "mandatoryArtText", label: "Texto obrigatório nas artes", area: true },
      { key: "designNotes", label: "Notas de design", area: true },
    ],
  },
  {
    title: "LinkedIn",
    fields: [
      { key: "linkedinUrl", label: "Company Page do LinkedIn" },
      { key: "linkedinRepost", label: "Repostar no LinkedIn", help: "Ex.: sim, os posts de feed; ou não." },
    ],
  },
  {
    title: "Outros",
    fields: [
      { key: "responsibleTech", label: "Responsável técnico / registro" },
      { key: "plan", label: "Plano (nível / frequência)" },
      { key: "observations", label: "Observações", area: true },
    ],
  },
];

const GROUP = "m-0 grid min-w-0 gap-4 border-0 p-0";
const LEGEND = "mb-3 p-0 font-display text-base font-semibold text-fg";

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value?.trim()) return null;
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-overline text-fg-muted">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap wrap-break-word text-sm text-fg">{value}</dd>
    </div>
  );
}

export default function ClientBriefingEditor({ client }: { client: BriefingClient }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const editButtonRef = useRef<HTMLButtonElement>(null);

  const initialContacts = (): Record<ContactKey, string> => ({
    tradeName: client.tradeName ?? "",
    website: client.website ?? "",
    city: client.city ?? "",
    phone: client.phone ?? "",
    whatsapp: client.whatsapp ?? "",
    facebookUrl: client.facebookUrl ?? "",
    instagramUrl: client.instagramUrl ?? "",
  });
  const [contacts, setContacts] = useState<Record<ContactKey, string>>(initialContacts);
  const [b, setB] = useState<Briefing>(client.briefing ?? {});

  const briefing = client.briefing ?? {};
  const hasAny =
    CONTACT_FIELDS.some((f) => client[f.key]?.trim()) ||
    Object.values(briefing).some((v) => typeof v === "string" && v.trim().length > 0);

  function startEditing() {
    setContacts(initialContacts());
    setB(client.briefing ?? {});
    setError("");
    setEditing(true);
    requestAnimationFrame(() => document.getElementById("briefing-tradeName")?.focus());
  }

  function stopEditing() {
    setEditing(false);
    setError("");
    requestAnimationFrame(() => editButtonRef.current?.focus());
  }

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...contacts, briefing: b }),
      });
      if (!res.ok) {
        // 400 com texto: campo recusado (ex.: site/Instagram/Facebook que não é endereço https; N-14)
        const data: unknown = res.status === 400 ? await res.json().catch(() => null) : null;
        const reason = (data as { error?: unknown } | null)?.error;
        setError(typeof reason === "string" ? reason : "Não foi possível salvar o briefing. Tente de novo.");
        return;
      }
      stopEditing();
      router.refresh();
    } catch {
      setError("Sem conexão com o servidor. Verifique a internet e tente de novo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="briefing-titulo" className="card p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id="briefing-titulo" className="font-display text-lg font-semibold tracking-title text-fg">
          {editing ? "Editar briefing" : "Briefing do cliente"}
        </h2>
        {!editing && (
          <Button ref={editButtonRef} size="sm" leadingIcon={<Icon.edit />} onClick={startEditing}>
            {hasAny ? "Editar" : "Preencher"}
          </Button>
        )}
      </div>

      {!editing ? (
        !hasAny ? (
          <p className="text-sm text-fg-muted">
            Briefing vazio. Preencha os dados do cliente (substitui o documento de briefing).
          </p>
        ) : (
          <dl className="grid gap-4 sm:grid-cols-2">
            {CONTACT_FIELDS.map((f) => (
              <Row key={f.key} label={f.label} value={client[f.key]} />
            ))}
            {BRIEFING_GROUPS.flatMap((g) => g.fields).map((f) => (
              <Row key={f.key} label={f.label} value={briefing[f.key]} />
            ))}
          </dl>
        )
      ) : (
        <form noValidate onSubmit={save} aria-busy={saving || undefined} className="grid gap-8">
          <fieldset className={GROUP}>
            <legend className={LEGEND}>Dados do cliente</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {CONTACT_FIELDS.map((f) => (
                <Field key={f.key} id={`briefing-${f.key}`} label={f.label}>
                  <Input
                    value={contacts[f.key]}
                    onChange={(e) => setContacts((c) => ({ ...c, [f.key]: e.target.value }))}
                    disabled={saving}
                    inputMode={f.inputMode}
                    autoComplete="off"
                  />
                </Field>
              ))}
            </div>
          </fieldset>

          {BRIEFING_GROUPS.map((g) => (
            <fieldset key={g.title} className={GROUP}>
              <legend className={LEGEND}>{g.title}</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                {g.fields.map((f) => (
                  <Field
                    key={f.key}
                    id={`briefing-${f.key}`}
                    label={f.label}
                    help={f.help}
                    className={f.area ? "sm:col-span-2" : undefined}
                  >
                    {f.area ? (
                      <Textarea
                        rows={3}
                        value={b[f.key] ?? ""}
                        onChange={(e) => setB((cur) => ({ ...cur, [f.key]: e.target.value }))}
                        disabled={saving}
                      />
                    ) : (
                      <Input
                        value={b[f.key] ?? ""}
                        onChange={(e) => setB((cur) => ({ ...cur, [f.key]: e.target.value }))}
                        disabled={saving}
                        autoComplete="off"
                      />
                    )}
                  </Field>
                ))}
              </div>
            </fieldset>
          ))}

          {error && (
            <Callout tone="danger" live="assertive">
              {error}
            </Callout>
          )}

          <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:justify-end">
            <Button variant="secondary" disabled={saving} onClick={stopEditing}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={saving} loadingText="Salvando…">
              Salvar briefing
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
