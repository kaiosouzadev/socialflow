"use client";

import { Suspense, use, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icons";
import type { InstagramProfilePreview } from "@/lib/ig-profile";

/*
 * "Ver como feed" do link mensal: o perfil do Instagram do cliente como ele vai
 * ficar (layout do perfil no Instagram, cores do design system no tema claro e
 * no escuro). O cabeçalho vem da conta conectada (ou do cadastro, sem
 * contadores/bio); a grade mostra SÓ os posts planejados deste cronograma, sem
 * selo, e cada um abre o modal do post. As postagens já publicadas no Instagram
 * ficam fora para não confundir o cliente (P4-F2).
 * Destaques, "Seguir"/"Enviar mensagem" e "Seguido(a) por" ficam fora: não há
 * dado verdadeiro para eles.
 */

export type PlannedFeedTile = {
  key: string;
  /** "Planejado para dd/mm: <tema>" */
  label: string;
  format: string;
  /** arte (Thumb) ou o placeholder do formato */
  media: React.ReactNode;
};

const NUM = new Intl.NumberFormat("pt-BR");
const BIO_LINES = 3;

/* ícone sobre a foto: creme nos dois temas (o branco do Instagram) com a sombra do token scrim */
const OVERLAY_ICON =
  "pointer-events-none absolute right-2 top-2 size-5 text-on-solid drop-shadow-[0_0_2px_var(--sf-scrim)] dark:text-fg";

/* ------------------------------------------------------------------ ícones */

function CarouselIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <rect x="2" y="2" width="16" height="16" rx="3.5" />
      <path d="M21.5 7.5V17a4.5 4.5 0 0 1-4.5 4.5H7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ReelsIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path
        fillRule="evenodd"
        d="M6.5 2h11A4.5 4.5 0 0 1 22 6.5v11a4.5 4.5 0 0 1-4.5 4.5h-11A4.5 4.5 0 0 1 2 17.5v-11A4.5 4.5 0 0 1 6.5 2Zm3.5 6.6v6.8a.7.7 0 0 0 1.06.6l5.6-3.4a.7.7 0 0 0 0-1.2l-5.6-3.4a.7.7 0 0 0-1.06.6Z"
      />
    </svg>
  );
}

function GridTabIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className={className}>
      {[3, 10, 17].flatMap((y) => [3, 10, 17].map((x) => <rect key={`${x}-${y}`} x={x} y={y} width="5" height="5" rx="1" />))}
    </svg>
  );
}

function ReelsTabIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <path d="M10 8.6v6.8l5.4-3.4L10 8.6Z" />
    </svg>
  );
}

function TaggedTabIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10 3h4l1.6 2H19a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3.4L10 3Z" />
      <circle cx="12" cy="11.5" r="3" />
      <path d="M6.8 21a5.2 5.2 0 0 1 10.4 0" />
    </svg>
  );
}

/* ------------------------------------------------------------- cabeçalho */

/** Foto do perfil → logo do cadastro → iniciais (Avatar). Decorativa: o nome está no h2. */
function ProfilePic({
  src,
  logoUrl,
  name,
  className,
}: {
  src?: string;
  logoUrl: string | null;
  name: string;
  className: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const igSrc = src && src !== failed ? src : null;
  const logo = logoUrl && logoUrl !== failed ? logoUrl : null;
  return (
    <div aria-hidden="true" className={`shrink-0 overflow-hidden rounded-full bg-neutral-bg ${className}`}>
      {igSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={igSrc}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(igSrc)}
          className="size-full object-cover"
        />
      ) : (
        <span className="block size-full [&>span]:size-full [&>span]:text-2xl md:[&>span]:text-5xl">
          <Avatar name={name} src={logo} />
        </span>
      )}
    </div>
  );
}

function Bio({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  const lines = text.split(/\r?\n/);
  const long = lines.length > BIO_LINES;
  const shown = open || !long ? text : lines.slice(0, BIO_LINES).join("\n").replace(/[\s.…]+$/, "");

  return (
    <p
      ref={ref}
      tabIndex={-1}
      className="order-4 mt-4 whitespace-pre-line wrap-break-word text-sm leading-[1.3] text-fg outline-none md:mt-5"
    >
      {shown}
      {long && !open && (
        <>
          {"… "}
          <button
            type="button"
            aria-expanded={false}
            onClick={() => {
              setOpen(true);
              // o botão some: o foco vai para a bio inteira
              requestAnimationFrame(() => ref.current?.focus());
            }}
            // alvo de 44 px que cresce só para CIMA (sobre a bio, que não é clicável): não cobre o link de baixo
            className="-mr-4 -mt-6.5 inline-flex min-h-11 min-w-11 items-end text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
          >
            mais<span className="sr-only"> (ver a bio completa)</span>
          </button>
        </>
      )}
    </p>
  );
}

function Counters({ profile, plannedCount }: { profile: InstagramProfilePreview; plannedCount: number }) {
  const items: { key: string; value: number; label: string; extra?: string; title?: string }[] = [];
  if (profile.mediaCount !== undefined) {
    const total = profile.mediaCount + plannedCount;
    items.push({
      key: "posts",
      value: total,
      label: total === 1 ? "post" : "posts",
      // o nº inclui os planejados deste cronograma: o cliente vê como o perfil vai ficar
      extra:
        plannedCount > 0
          ? `: ${NUM.format(profile.mediaCount)} já publicados e ${NUM.format(plannedCount)} planejados neste cronograma`
          : undefined,
      title:
        plannedCount > 0
          ? `${NUM.format(profile.mediaCount)} já publicados + ${NUM.format(plannedCount)} planejados neste cronograma`
          : undefined,
    });
  }
  if (profile.followers !== undefined)
    items.push({ key: "seguidores", value: profile.followers, label: profile.followers === 1 ? "seguidor" : "seguidores" });
  if (profile.following !== undefined) items.push({ key: "seguindo", value: profile.following, label: "seguindo" });
  if (items.length === 0) return null;

  return (
    <ul className="flex min-w-0 flex-1 justify-around text-sm text-fg md:mt-4 md:flex-none md:justify-start md:gap-4">
      {items.map((it) => (
        <li key={it.key} title={it.title} className="flex flex-col items-center md:flex-row md:gap-1">
          <span className="text-base font-semibold tabular-nums md:text-sm">{NUM.format(it.value)}</span>
          <span>
            {it.label}
            {it.extra && <span className="sr-only">{it.extra}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ProfileHeader({
  profile,
  clientName,
  clientLogoUrl,
  plannedCount,
}: {
  profile: Promise<InstagramProfilePreview>;
  clientName: string;
  clientLogoUrl: string | null;
  plannedCount: number;
}) {
  const p = use(profile);
  const name = p.name || clientName;
  const title = p.username ?? name;
  const instagram = p.source === "instagram";
  const site = p.website?.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  const pic = (className: string) => (
    <ProfilePic src={p.avatarUrl} logoUrl={clientLogoUrl} name={name} className={className} />
  );

  return (
    <header className="mx-auto flex max-w-170 items-center gap-7 px-4">
      {pic("hidden size-37.5 md:block")}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="order-1 flex min-w-0 items-center gap-3 md:gap-4">
          <h2 className="min-w-0 text-xl font-semibold leading-tight text-fg wrap-anywhere">{title}</h2>
          <span aria-hidden="true" className="inline-flex size-6 shrink-0 text-fg [&>svg]:size-full">
            <Icon.moreHorizontal />
          </span>
        </div>
        {p.username && name && (
          <p className="order-3 mt-3 text-sm font-semibold text-fg md:order-2 md:mt-2 md:font-normal">{name}</p>
        )}
        {/* celular: foto menor + contadores ao lado (layout do app); desktop: só os contadores */}
        <div className="order-2 mt-4 flex items-center gap-6 md:order-3 md:mt-0">
          {pic("size-20 md:hidden")}
          {instagram && <Counters profile={p} plannedCount={plannedCount} />}
        </div>
        {instagram && p.biography && <Bio text={p.biography} />}
        {instagram && p.website && site && (
          // alvo de 44 px que cresce só para BAIXO: o texto fica colado na bio, como no Instagram
          <p className="order-5 mt-1">
            <a
              href={p.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 max-w-full items-start gap-1 text-sm font-semibold text-link hover:text-link-hover hover:underline focus-visible:outline-2 focus-visible:outline-focus"
            >
              <span aria-hidden="true" className="mt-0.5 inline-flex size-4 shrink-0 [&>svg]:size-full">
                <Icon.link />
              </span>
              <span className="truncate">{site}</span>
              <span className="sr-only"> (abre em nova aba)</span>
            </a>
          </p>
        )}
      </div>
    </header>
  );
}

function HeaderSkeleton() {
  return (
    <div className="mx-auto flex max-w-170 items-center gap-7 px-4">
      <p role="status" className="sr-only">
        Carregando o perfil…
      </p>
      <div aria-hidden="true" className="size-20 shrink-0 animate-pulse rounded-full bg-neutral-bg md:size-37.5" />
      <div aria-hidden="true" className="grid flex-1 gap-3">
        <div className="h-5 w-40 max-w-full animate-pulse rounded-chip bg-neutral-bg" />
        <div className="h-4 w-56 max-w-full animate-pulse rounded-chip bg-neutral-bg" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ grade */

export default function InstagramFeedPreview({
  profile,
  clientName,
  clientLogoUrl,
  planned,
  plannedCount,
  onOpen,
  className = "",
}: {
  profile: Promise<InstagramProfilePreview>;
  clientName: string;
  clientLogoUrl: string | null;
  /** planejados deste cronograma que vão para o feed, do mais tardio para o mais cedo */
  planned: PlannedFeedTile[];
  /** planejados que ainda não foram publicados (somam no nº de posts) */
  plannedCount: number;
  onOpen: (key: string) => void;
  className?: string;
}) {
  return (
    <section aria-label="Prévia do perfil no Instagram" className={`@container mx-auto w-full max-w-360 sm:px-4 ${className}`}>
      <Suspense fallback={<HeaderSkeleton />}>
        <ProfileHeader profile={profile} clientName={clientName} clientLogoUrl={clientLogoUrl} plannedCount={plannedCount} />
      </Suspense>

      {/* abas como no Instagram: só a grade existe aqui; Reels e Marcados são só visuais */}
      <div className="mx-auto mt-8 flex max-w-148 md:mt-11">
        <h3 className="relative flex flex-1 justify-center py-3 text-fg">
          <GridTabIcon className="size-6" />
          <span className="sr-only">Publicações</span>
          <span aria-hidden="true" className="absolute inset-x-0 bottom-0 mx-auto h-px w-full bg-fg md:w-16" />
        </h3>
        <div aria-hidden="true" className="flex flex-1 justify-center py-3 text-fg-muted">
          <ReelsTabIcon className="size-6" />
        </div>
        <div aria-hidden="true" className="flex flex-1 justify-center py-3 text-fg-muted">
          <TaggedTabIcon className="size-6" />
        </div>
      </div>

      <ul
        aria-label="Publicações planejadas neste cronograma"
        className="grid grid-cols-3 gap-0.5 overflow-hidden sm:rounded-sm @min-[1000px]:grid-cols-5"
      >
        {planned.map((t) => (
          <li key={t.key}>
            <button
              type="button"
              onClick={() => onOpen(t.key)}
              aria-label={t.label}
              className="group relative block aspect-3/4 w-full overflow-hidden bg-sunken focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
            >
              <span className="block size-full transition-opacity duration-(--sf-dur-fast) group-hover:opacity-85 *:size-full">
                {t.media}
              </span>
              {t.format === "carrossel" && <CarouselIcon className={OVERLAY_ICON} />}
              {t.format === "reels" && <ReelsIcon className={OVERLAY_ICON} />}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
