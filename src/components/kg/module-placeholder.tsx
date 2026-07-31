/**
 * KG · Placeholder de módulo para 6a. Todos los módulos empresa (Ejecutivo,
 * Financiero, Marketing, Clientes, Operaciones, Academia) usan esto hasta que
 * su UI de datos esté conectada en 6b+. Es intencionalmente sobrio: sirve
 * para navegar el shell y verificar routing/rol, no para prototipar módulos.
 */
export function ModulePlaceholder({
  title,
  subtitle,
  description,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly description: string;
}) {
  return (
    <div className="kg-in mx-auto max-w-2xl">
      <div
        className="kg-glass rounded-[20px] p-8"
        style={{ boxShadow: "var(--kg-shadow-amb)" }}
      >
        <div
          className="kg-t7 mb-2"
          style={{ color: "var(--kg-accent-text)" }}
        >
          En construcción
        </div>
        <h1 className="kg-t2" style={{ color: "var(--kg-text-1)" }}>
          {title}
        </h1>
        <p className="kg-t5 mt-1" style={{ color: "var(--kg-text-2)" }}>
          {subtitle}
        </p>
        <p
          className="mt-6 text-sm leading-relaxed"
          style={{ color: "var(--kg-text-2)" }}
        >
          {description}
        </p>
        <div className="mt-6 flex gap-2">
          <div className="kg-skel h-24 w-full" />
          <div className="kg-skel h-24 w-full" />
          <div className="kg-skel h-24 w-full" />
        </div>
      </div>
    </div>
  );
}
