import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { KgModuleNav } from "@/components/kg/module-nav";
import type { TabItem } from "@/components/kg/tabs-bar";

/**
 * Layout del módulo Academia.
 *
 * Visible para superadmin / admin / coordinador. Operadores y clientes son
 * redirigidos a su módulo raíz vía requireRole.
 *
 * ACADEMIA VIVE SOBRE PROYECTOS PROPIOS (guard 0070). Si la organización
 * no tiene ningún project con `ownership='propia'`, mostramos un banner
 * arriba del contenido para que se sepa por qué las tablas van a estar
 * vacías. Las páginas siguen navegables — el banner es información, no bloqueo.
 */
export default async function AcademiaLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  await requireRole("superadmin", "admin", "coordinador");

  const supabase = await createClient();
  const { count: propiasCount } = await supabase
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("ownership", "propia");
  const hasPropias = (propiasCount ?? 0) > 0;

  const tabs: readonly TabItem[] = [
    { href: "/academia", label: "Dashboard" },
    { href: "/academia/cohortes", label: "Generaciones" },
    { href: "/academia/estudiantes", label: "Estudiantes" },
    { href: "/academia/cursos", label: "Cursos" },
    { href: "/academia/certificados", label: "Certificados" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <KgModuleNav items={tabs} />
      {!hasPropias && <NoPropiaProjectsBanner />}
      {children}
    </div>
  );
}

function NoPropiaProjectsBanner() {
  return (
    <div
      role="alert"
      style={{
        padding: "12px 16px",
        borderRadius: "var(--kg-r-8)",
        background: "rgba(255,184,0,0.08)",
        border: "1px solid rgba(255,184,0,0.4)",
        color: "var(--kg-text-1)",
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      <strong style={{ color: "#FFB800" }}>
        Sin proyectos propios en la organización.
      </strong>{" "}
      Academia solo puede colgar de proyectos con{" "}
      <code
        style={{
          padding: "1px 6px",
          borderRadius: 4,
          background: "var(--kg-surface-2-solid)",
          fontFamily: "ui-monospace, monospace",
          fontSize: 12,
        }}
      >
        ownership='propia'
      </code>
      . Hasta que exista al menos uno (Rey Academy, Growins, etc.), las
      tablas del módulo van a rechazar cualquier insert con el guard{" "}
      <code
        style={{
          padding: "1px 6px",
          borderRadius: 4,
          background: "var(--kg-surface-2-solid)",
          fontFamily: "ui-monospace, monospace",
          fontSize: 12,
        }}
      >
        guard_propia_project
      </code>{" "}
      del schema 0070. Para setearlos: en Studio ejecutar{" "}
      <code
        style={{
          padding: "1px 6px",
          borderRadius: 4,
          background: "var(--kg-surface-2-solid)",
          fontFamily: "ui-monospace, monospace",
          fontSize: 12,
        }}
      >
        update projects set ownership = 'propia' where name in (…);
      </code>
    </div>
  );
}
