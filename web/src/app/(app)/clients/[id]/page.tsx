import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader, StatusBadge, PlatformChip } from "@/components/ui";
import { Icon } from "@/components/Icons";
import { formatDateTime } from "@/lib/format-date";
import ClientInfoEditor from "./ClientInfoEditor";
import AccountsManager from "./AccountsManager";
import DeleteClientButton from "./DeleteClientButton";
import GenerateCalendarButton from "./GenerateCalendarButton";
import SyncMediaButton from "./SyncMediaButton";

export const dynamic = "force-dynamic";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      socialAccounts: { orderBy: { platform: "asc" } },
      posts: { take: 5, orderBy: { scheduledAt: "desc" } },
      _count: { select: { posts: true } },
    },
  });

  if (!client) notFound();

  const accounts = client.socialAccounts.map((a) => ({
    id: a.id,
    platform: a.platform,
    externalId: a.externalId,
    status: a.status,
    dailyPostLimit: a.dailyPostLimit,
    tokenExpiresAt: a.tokenExpiresAt ? a.tokenExpiresAt.toISOString() : null,
  }));

  return (
    <div className="p-8 max-w-6xl mx-auto animate-fade-up">
      <PageHeader
        title={client.name}
        back="/clients"
        action={
          <div className="flex items-center gap-2">
            <SyncMediaButton clientId={client.id} />
            <GenerateCalendarButton clientId={client.id} />
            <Link href={`/posts/new?clientId=${client.id}`} className="btn-primary">
              <Icon.plus className="w-4 h-4" />
              Novo post
            </Link>
            <DeleteClientButton clientId={client.id} clientName={client.name} />
          </div>
        }
      />

      <div className="space-y-6">
        <ClientInfoEditor
          client={{
            id: client.id,
            name: client.name,
            email: client.email,
            plan: client.plan,
            toneOfVoice: client.toneOfVoice,
            driveFolderId: client.driveFolderId,
          }}
        />

        <div className="grid grid-cols-3 gap-4">
          <div className="card p-4">
            <p className="text-xs text-[var(--color-text-faint)] uppercase tracking-wider mb-1">
              Contas
            </p>
            <p className="text-2xl font-semibold">{client.socialAccounts.length}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-[var(--color-text-faint)] uppercase tracking-wider mb-1">
              Total de posts
            </p>
            <p className="text-2xl font-semibold">{client._count.posts}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-[var(--color-text-faint)] uppercase tracking-wider mb-1">
              Contas ativas
            </p>
            <p className="text-2xl font-semibold">
              {client.socialAccounts.filter((a) => a.status === "active").length}
            </p>
          </div>
        </div>

        <AccountsManager clientId={client.id} accounts={accounts} />

        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
            <h2 className="font-semibold">Posts recentes</h2>
            <Link
              href={`/posts?clientId=${client.id}`}
              className="text-sm text-[var(--color-accent)] hover:underline"
            >
              Ver todos
            </Link>
          </div>
          {client.posts.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-[var(--color-text-muted)]">
              Nenhum post ainda.
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {client.posts.map((post) => (
                <div key={post.id} className="flex items-center gap-4 px-5 py-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{post.theme ?? "Sem tema"}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex gap-1">
                        {post.targets.map((t) => (
                          <PlatformChip key={t} platform={t} />
                        ))}
                      </div>
                      <span className="text-xs text-[var(--color-text-faint)]">
                        {formatDateTime(post.scheduledAt)}
                      </span>
                    </div>
                  </div>
                  <StatusBadge status={post.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
