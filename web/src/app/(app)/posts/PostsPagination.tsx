"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Icon } from "@/components/Icons";

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

  const navClass =
    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-sm font-medium transition-colors";
  const enabled = "text-[var(--color-text-muted)] hover:text-white hover:border-[var(--color-border-strong)]";
  const disabled = "text-[var(--color-text-faint)] opacity-50 pointer-events-none";

  return (
    <div className="flex items-center justify-between gap-3 mt-4 flex-wrap">
      <p className="text-sm text-[var(--color-text-muted)]">
        Mostrando <span className="text-[var(--color-text)] font-medium">{from}</span>–
        <span className="text-[var(--color-text)] font-medium">{to}</span> de{" "}
        <span className="text-[var(--color-text)] font-medium">{total}</span>
      </p>

      <div className="flex items-center gap-2">
        <Link
          href={hrefForPage(page - 1)}
          aria-disabled={!hasPrev}
          tabIndex={hasPrev ? undefined : -1}
          className={`${navClass} ${hasPrev ? enabled : disabled}`}
        >
          <Icon.chevronLeft className="w-4 h-4" />
          Anterior
        </Link>
        <span className="text-sm text-[var(--color-text-muted)] px-1">
          página <span className="text-[var(--color-text)] font-medium">{page}</span> de {totalPages}
        </span>
        <Link
          href={hrefForPage(page + 1)}
          aria-disabled={!hasNext}
          tabIndex={hasNext ? undefined : -1}
          className={`${navClass} ${hasNext ? enabled : disabled}`}
        >
          Próximo
          <Icon.chevronRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
