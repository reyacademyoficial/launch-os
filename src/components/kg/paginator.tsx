import Link from "next/link";

import { fCount } from "@/lib/finance/format";

/**
 * KG · Paginator. Navegación previa/siguiente + indicador de "página K de N".
 * Server-side puro — el caller arma los hrefs (con los otros searchParams
 * preservados) y decide si hay página siguiente basándose en `totalCount`.
 *
 * Sin bullets numéricas: es un backoffice, la nav por número no aporta.
 */
export function KgPaginator({
  page,
  pageSize,
  totalCount,
  hrefFor,
  compact = false,
}: {
  /** Página actual, 1-indexed. */
  readonly page: number;
  readonly pageSize: number;
  readonly totalCount: number;
  /** hrefFor(2) devuelve el href a la página 2 preservando otros params. */
  readonly hrefFor: (page: number) => string;
  /**
   * `true` cuando se embebe dentro de otro footer (ej. KgDataTable.footerActions)
   * — quita el padding propio para no duplicar el del contenedor.
   */
  readonly compact?: boolean;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const canPrev = page > 1;
  const canNext = page < totalPages;

  if (totalPages <= 1) return null;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        gap: 12,
        padding: compact ? 0 : "10px 14px",
        fontSize: 12,
        color: "var(--kg-text-3)",
      }}
    >
      <PageLink href={canPrev ? hrefFor(page - 1) : null} label="← Anterior" />
      <span style={{ fontVariantNumeric: "tabular-nums" }}>
        Página {fCount(page)} de {fCount(totalPages)}
      </span>
      <PageLink href={canNext ? hrefFor(page + 1) : null} label="Siguiente →" />
    </div>
  );
}

function PageLink({
  href,
  label,
}: {
  readonly href: string | null;
  readonly label: string;
}) {
  if (!href) {
    return (
      <span
        aria-disabled="true"
        style={{
          padding: "4px 10px",
          color: "var(--kg-text-3)",
          opacity: 0.4,
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="kg-focus"
      style={{
        padding: "4px 10px",
        borderRadius: 999,
        color: "var(--kg-text-2)",
        border: "1px solid var(--kg-border-subtle)",
        textDecoration: "none",
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {label}
    </Link>
  );
}
