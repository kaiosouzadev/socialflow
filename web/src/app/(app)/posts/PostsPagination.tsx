"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { buttonClasses } from "@/components/Button";
import { Icon } from "@/components/Icons";

/** Mesma medida do Button secondary sm, no estado desabilitado (por tokens, sem opacity). */
const DISABLED =
  "inline-flex min-h-10 cursor-not-allowed select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-control border border-line bg-disabled px-3 text-sm font-semibold text-fg-disabled sm:min-h-8";

export default function PostsPagination({
  page,
  totalPages,
  total,
  pageSize,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
}) {
  const searchParams = useSearchParams();

  function hrefForPage(p: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (p <= 1) params.delete("page");
    else params.set("page", String(p));
    return `/posts${params.size ? `?${params}` : ""}`;
  }

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const hasPrev = page > 1;
  const hasNext = page < totalPages;
  const enabled = buttonClasses({ variant: "secondary", size: "sm" });

  const prev = (
    <>
      <Icon.chevronLeft className="size-4 shrink-0" />
      Anterior
    </>
  );
  const next = (
    <>
      Próxima
      <Icon.chevronRight className="size-4 shrink-0" />
    </>
  );

  return (
    <nav aria-label="Paginação" className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-fg-muted tabular-nums">
        Mostrando <span className="font-medium text-fg">{from}</span>–<span className="font-medium text-fg">{to}</span> de{" "}
        <span className="font-medium text-fg">{total}</span>
      </p>

      <div className="flex items-center gap-2">
        {hasPrev ? (
          <Link href={hrefForPage(page - 1)} className={enabled} aria-label="Página anterior">
            {prev}
          </Link>
        ) : (
          // link desabilitado (sem href): "indisponível" para leitor de tela; contraste isento (WCAG 1.4.3)
          <a role="link" aria-disabled="true" aria-label="Página anterior" className={DISABLED}>
            {prev}
          </a>
        )}
        <span className="px-1 text-sm text-fg-muted tabular-nums">
          Página <span className="font-medium text-fg">{page}</span> de {totalPages}
        </span>
        {hasNext ? (
          <Link href={hrefForPage(page + 1)} className={enabled} aria-label="Próxima página">
            {next}
          </Link>
        ) : (
          <a role="link" aria-disabled="true" aria-label="Próxima página" className={DISABLED}>
            {next}
          </a>
        )}
      </div>
    </nav>
  );
}
