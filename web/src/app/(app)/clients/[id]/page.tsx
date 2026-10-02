import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Avatar } from "@/components/Avatar";
import { buttonClasses } from "@/components/Button";
import { Icon } from "@/components/Icons";
import { EmptyState, PageHeader, PlatformChip, StatusBadge, ToneBadge } from "@/components/ui";
import { formatDateTime } from "@/lib/format-date";
import { uuidString } from "@/lib/validators";
import { listBasicMonths } from "@/lib/basic-plan";
import ClientChecklist from "./ClientChecklist";
import ClientInfoEditor from "./ClientInfoEditor";
import ClientBriefingEditor, { type Briefing } from "./ClientBriefingEditor";
import CredentialsManager from "./CredentialsManager";
import AccountsManager from "./AccountsManager";
import DeleteClientButton from "./DeleteClientButton";
import GenerateCalendarButton from "./GenerateCalendarButton";
import SyncMediaButton from "./SyncMediaButton";
import BasicPlanManager from "./BasicPlanManager";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/** Nome do cliente para o título da aba (memorizado no mesmo render da página). */
const loadClientName = cache(async (id: string) =>
  uuidString.safeParse(id).success
    ? prisma.client.findUnique({ where: { id }, select: { name: true } })
    : null,
);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const client = await loadClientName(id);
  return { title: client?.name ?? "Cliente não encontrado" };
}

function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many;
}

export default async function ClientDetailPage({ params }: Props) {
  const { id } = await params;
  // id que não é uuid faria o Prisma lançar: vira 404
  if (!uuidString.safeParse(id).success) notFound();

  const [client, metaConnections, users, openPending, queuedPostsCount] = await Promise.all([
    prisma.client.findUnique({
      where: { id },
      include: {
        socialAccounts: { orderBy: { platform: "asc" } },
        posts: { take: 5, orderBy: { scheduledAt: "desc" } },
        responsible: { select: { id: true, name: true } },
        _count: { select: { posts: true } },
      },
    }),
    prisma.metaConnection.findMany({
      where: { status: "active" },
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
    }),
    // GET /api/users é só para admin: a lista de redatoras vem do servidor
    prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.pendingItem.count({ where: { clientId: id, resolvedAt: null } }),
    prisma.post.count({ where: { clientId: id, status: { in: ["scheduled", "failed"] } } }),
  ]);

  if (!client) notFound();

  const basicMonths = client.tier === "basica" ? await listBasicMonths(client.id) : [];
  const activeAccounts = client.socialAccounts.filter((a) => a.status === "active").length;

  const accounts = client.socialAccounts.map((a) => ({
    id: a.id,
    platform: a.platform,
    externalId: a.externalId,
    status: a.status,
    dailyPostLimit: a.dailyPostLimit,
    tokenExpiresAt: a.tokenExpiresAt ? a.tokenExpiresAt.toISOString() : null,
  }));

  const stats = [
    { label: "Contas", value: client.socialAccounts.length },
    { label: "Contas ativas", value: activeAccounts },
    { label: "Total de posts", value: client._count.posts },
  ];

  return (
    <div className="page">
      <PageHeader
        title={client.name}
        back="/clients"
        backLabel="Voltar para clientes"
        badges={
          <>
            <StatusBadge kind="client" status={client.status} size="md" />
            {!client.agencyPublishes && (
              <span title="A agência produz o conteúdo, mas não agenda nem publica.">
                <StatusBadge kind="agencyPublishes" status="nao" size="md" />
              </span>
            )}
            <StatusBadge kind="plan" status={client.plan} size="md" />
            {client.segment && <StatusBadge kind="segment" status={client.segment} size="md" />}
            {client.responsible && (
              <span
                title="Redatora responsável"
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface pl-0.5 pr-2.5 text-sm font-medium text-fg"
              >
                <Avatar name={client.responsible.name} size="xs" />
                <span className="sr-only">Redatora: </span>
                {client.responsible.name}
              </span>
            )}
            {openPending > 0 && (
              <Link
                href={`/pendencias?cliente=${client.id}`}
                className="inline-flex min-h-11 items-center rounded-full sm:min-h-10"
              >
                <ToneBadge tone="warning" size="md">
                  {openPending} {plural(openPending, "pendência aberta", "pendências abertas")}
                  <span aria-hidden="true">→</span>
                </ToneBadge>
              </Link>
            )}
          </>
        }
        action={
          <>
            <SyncMediaButton clientId={client.id} />
            <GenerateCalendarButton clientId={client.id} />
            <Link href={`/clients/${client.id}/importar`} className={buttonClasses({ variant: "secondary" })}>
              <span aria-hidden="true" className="inline-flex size-4.5 [&>svg]:size-full">
                <Icon.fileText />
              </span>
              Importar documento do mês
            </Link>
            <Link href={`/posts/new?clientId=${client.id}`} className={buttonClasses({ variant: "primary" })}>
              <span aria-hidden="true" className="inline-flex size-4.5 [&>svg]:size-full">
                <Icon.plus />
              </span>
              Novo post
            </Link>
          </>
        }
      />

      <div className="grid gap-6">
        <ClientChecklist
          hasBriefing={
            !!client.briefing &&
            Object.values(client.briefing as Record<string, unknown>).some(
              (v) => typeof v === "string" && v.trim().length > 0,
            )
          }
          hasCredentials={!!client.credentialsEnc}
          hasToneOfVoice={!!client.toneOfVoice?.trim()}
          activeAccounts={activeAccounts}
          hasDriveFolder={!!client.driveFolderId}
          hasLogo={!!client.logoUrl}
          tier={client.tier}
          agencyPublishes={client.agencyPublishes}
        />

        <ClientInfoEditor
          client={{
            id: client.id,
            name: client.name,
            email: client.email,
            extraEmails: client.extraEmails,
            plan: client.plan,
            tier: client.tier,
            agencyPublishes: client.agencyPublishes,
            status: client.status,
            segment: client.segment,
            responsibleUserId: client.responsibleUserId,
            toneOfVoice: client.toneOfVoice,
            driveFolderId: client.driveFolderId,
            logoUrl: client.logoUrl,
            brandColor: client.brandColor,
            showContacts: client.showContacts,
          }}
          users={users}
          queuedPostsCount={queuedPostsCount}
        />

        {client.tier === "basica" && <BasicPlanManager clientId={client.id} initial={basicMonths} />}

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2">
            <ClientBriefingEditor
              client={{
                id: client.id,
                tradeName: client.tradeName,
                website: client.website,
                city: client.city,
                phone: client.phone,
                whatsapp: client.whatsapp,
                facebookUrl: client.facebookUrl,
                instagramUrl: client.instagramUrl,
                briefing: (client.briefing as Briefing | null) ?? null,
              }}
            />
          </div>
          <div className="min-w-0">
            <CredentialsManager clientId={client.id} hasCredentials={!!client.credentialsEnc} />
          </div>
        </div>

        <dl className="grid gap-4 sm:grid-cols-3">
          {stats.map((s) => (
            <div key={s.label} className="card p-4">
              <dt className="text-xs font-semibold uppercase tracking-overline text-fg-muted">{s.label}</dt>
              <dd className="mt-1 font-display text-2xl font-semibold text-fg">{s.value}</dd>
            </div>
          ))}
        </dl>

        <AccountsManager clientId={client.id} accounts={accounts} metaConnections={metaConnections} />

        <section aria-labelledby="posts-recentes" className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
            <h2 id="posts-recentes" className="font-display text-lg font-semibold tracking-title text-fg">
              Posts recentes
            </h2>
            <Link
              href={`/posts?clientId=${client.id}`}
              className="inline-flex min-h-11 items-center text-sm font-medium text-link hover:text-link-hover hover:underline sm:min-h-10"
            >
              Ver todos os posts
            </Link>
          </div>
          {client.posts.length === 0 ? (
            <EmptyState
              size="inline"
              headingLevel={3}
              title="Nenhum post ainda"
              description="Crie um post ou gere o cronograma do mês com IA."
              action={
                <Link href={`/posts/new?clientId=${client.id}`} className={buttonClasses({ variant: "secondary" })}>
                  Criar post
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {client.posts.map((post) => (
                <li key={post.id}>
                  <Link
                    href={`/posts/${post.id}`}
                    className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-hover focus-visible:-outline-offset-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">{post.theme?.trim() || "Sem tema"}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="flex gap-1">
                          {post.targets.map((t) => (
                            <PlatformChip key={t} platform={t} />
                          ))}
                        </span>
                        <span className="text-xs text-fg-muted">{formatDateTime(post.scheduledAt)}</span>
                      </div>
                    </div>
                    <StatusBadge kind="post" status={post.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="zona-de-perigo" className="card border-danger-line p-5 sm:p-6">
          <h2 id="zona-de-perigo" className="text-base font-semibold text-fg">
            Zona de perigo
          </h2>
          <p className="mt-1 max-w-prose text-sm text-fg-muted">
            Excluir o cliente apaga o cadastro, os posts, os cronogramas e as credenciais. Não dá para desfazer.
          </p>
          <div className="mt-4">
            <DeleteClientButton
              clientId={client.id}
              clientName={client.name}
              postsCount={client._count.posts}
              accountsCount={client.socialAccounts.length}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
