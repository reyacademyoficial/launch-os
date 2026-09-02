import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ContextBar } from "@/components/kg/context-bar";
import { KgDataTable, type Column } from "@/components/kg/data-table";
import { IconLaunch } from "@/components/kg/icons";
import { KgPaginator } from "@/components/kg/paginator";
import { Panel } from "@/components/kg/panel";
import { canViewAuditLog } from "@/lib/auth/permissions";
import { listAuditLog } from "@/lib/audit/list";
import { fCount } from "@/lib/finance/format";
import { requireSessionProfile } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Audit log" };

const PAGE_SIZE = 50;

/**
 * Fila tal como la devuelve `listAuditLog`. Se declara acá (en vez de
 * importarla) solo para tipar las columnas de la tabla — el shape lo manda
 * la query, no esta page.
 */
interface AuditRow {
  readonly id: string;
  readonly ts: string;
  readonly user_name: string | null;
  readonly user_id: string | null;
  readonly action: string;
  readonly detail: unknown;
}

export default async function AuditLogPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ projectId: string }>;
  readonly searchParams: Promise<{ page?: string }>;
}) {
  const { projectId } = await params;
  // Operador y cliente NO ven audit log. La RLS de 0009 ya devuelve vacío para
  // ellos, pero gateamos también acá para evitar mostrar la página vacía y
  // dejarla esquinada del UI.
  const profile = await requireSessionProfile();
  if (!canViewAuditLog(profile, projectId)) {
    redirect(`/proyectos/${projectId}`);
  }
  const { page: pageStr } = await searchParams;
  const page = Math.max(0, Number.parseInt(pageStr ?? "0", 10) || 0);

  const { rows, total } = await listAuditLog(projectId, page, PAGE_SIZE);
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  // `listAuditLog` pagina 0-indexed; `KgPaginator` habla 1-indexed. La
  // conversión vive acá y NO en la URL: cambiar el ?page= rompería los links
  // que la gente ya tenga guardados.
  const columns: ReadonlyArray<Column<AuditRow>> = [
    {
      key: "ts",
      label: "Fecha",
      width: "180px",
      render: (r) => (
        <span className="kg-num" style={{ color: "var(--kg-text-3)" }}>
          {new Date(r.ts).toLocaleString("es-AR")}
        </span>
      ),
    },
    {
      key: "user",
      label: "Usuario",
      width: "200px",
      render: (r) => r.user_name ?? r.user_id ?? "—",
    },
    {
      key: "action",
      label: "Acción",
      width: "220px",
      render: (r) => <strong style={{ fontWeight: 600 }}>{r.action}</strong>,
    },
    {
      key: "detail",
      label: "Detalle",
      render: (r) => <DetailCell detail={r.detail} />,
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <ContextBar
        icon={<IconLaunch size={16} />}
        title="Audit log"
        stats={[
          { l: "Registros", v: fCount(total) },
          { l: "En esta página", v: fCount(rows.length) },
          // La paginación vive al pie de la tabla; repetirla arriba evita
          // scrollear hasta el fondo para saber dónde estás parado.
          { l: "Página", v: `${page + 1} / ${lastPage + 1}` },
        ]}
      />

      {/*
        "Solo lectura" pasó de ser un <p> suelto a la acción del Panel: es
        metadata de la tabla (explica por qué no hay botones), no un párrafo
        de la página.
      */}
      <Panel
        title="Actividad"
        pad={false}
        fillHeight
        actions={
          <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
            Solo lectura
          </span>
        }
      >
        <KgDataTable
          columns={columns}
          rows={rows as ReadonlyArray<AuditRow>}
          rowKey={(r) => r.id}
          totalCount={total}
          fillHeight
          emptyTitle="Sin actividad registrada"
          emptyHint="Acá van a aparecer los cambios que el equipo haga sobre el proyecto."
          footerActions={
            <KgPaginator
              page={page + 1}
              pageSize={PAGE_SIZE}
              totalCount={total}
              hrefFor={(n) => `/proyectos/${projectId}/audit?page=${n - 1}`}
              compact
            />
          }
        />
      </Panel>
    </div>
  );
}

/**
 * El detalle es JSON arbitrario del audit_log. Objeto vacío y null se
 * colapsan a un guion para no ensuciar la columna con `{}`.
 */
function DetailCell({ detail }: { readonly detail: unknown }) {
  if (detail === null || detail === undefined)
    return <span style={{ color: "var(--kg-text-3)" }}>—</span>;
  if (typeof detail === "object") {
    const json = JSON.stringify(detail);
    if (json === "{}" || json === "[]")
      return <span style={{ color: "var(--kg-text-3)" }}>—</span>;
    return (
      <code
        style={{
          wordBreak: "break-all",
          fontSize: 11.5,
          color: "var(--kg-text-3)",
        }}
      >
        {json}
      </code>
    );
  }
  return <span style={{ color: "var(--kg-text-2)" }}>{String(detail)}</span>;
}
