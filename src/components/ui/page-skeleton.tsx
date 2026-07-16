import { Skeleton } from "./skeleton";

/**
 * Variantes de skeleton para `loading.tsx` de cada página del app router.
 *
 * Todas asumen que el shell (sidebar + topbar) ya está renderizado por el
 * layout padre — el skeleton ocupa solo el área de contenido. Estructura
 * cerca del layout real de la página que reemplazan, para evitar layout
 * shift al swap real ↔ skeleton.
 */

function PageHeaderSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-full max-w-lg" />
    </div>
  );
}

/**
 * Header + barra de filtros + tabla. Cubre ventas, cobros, comisiones,
 * productos, métodos-pago, bancos, equipo, audit log, admin/usuarios,
 * admin/proyectos, cliente/leads, etc.
 */
export function TablePageSkeleton({ rows = 8 }: { readonly rows?: number }) {
  return (
    <section className="space-y-6">
      <PageHeaderSkeleton />
      <div className="flex flex-wrap gap-2 rounded-md border border-border bg-surface/40 px-3 py-2">
        <Skeleton className="h-8 min-w-[14rem] flex-1" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-40" />
      </div>
      <div className="overflow-hidden rounded-md border border-border">
        <div className="border-b border-border bg-surface px-3 py-3">
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-3 py-3">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Header + KPI cards + tabla. Cubre overview del proyecto, leaderboard,
 * launch detail, launch KPI, launch calendario, launch IA, analítica.
 */
export function DashboardPageSkeleton({
  cards = 6,
  tableRows = 5,
}: {
  readonly cards?: number;
  readonly tableRows?: number;
}) {
  return (
    <section className="space-y-6">
      <PageHeaderSkeleton />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: cards }).map((_, i) => (
          <div
            key={i}
            className="space-y-3 rounded-md border border-border bg-surface p-4"
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-24" />
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-md border border-border">
        {Array.from({ length: tableRows }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-border px-3 py-3 last:border-b-0"
          >
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Header + card con inputs. Cubre login, set-password, configuración,
 * calculadora, admin/proyectos/new, admin/proyectos/[id]/edit,
 * launch/integraciones, cliente/calculadora, cliente/configuración.
 */
export function FormPageSkeleton({
  fields = 5,
}: {
  readonly fields?: number;
}) {
  return (
    <section className="space-y-6">
      <PageHeaderSkeleton />
      <div className="space-y-4 rounded-md border border-border bg-bg-elevated p-6 shadow-card">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-full max-w-md" />
          </div>
        ))}
        <div className="flex items-center gap-3 pt-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
    </section>
  );
}

/**
 * Header + grid de cards. Cubre listado de lanzamientos, project picker,
 * portal del cliente, portal listado de launches.
 */
export function ListPageSkeleton({ items = 6 }: { readonly items?: number }) {
  return (
    <section className="space-y-6">
      <PageHeaderSkeleton />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: items }).map((_, i) => (
          <div
            key={i}
            className="space-y-3 rounded-md border border-border bg-surface p-4"
          >
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-3/5" />
              <Skeleton className="h-4 w-14" />
            </div>
            <Skeleton className="h-3 w-1/2" />
            <div className="space-y-2 pt-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
