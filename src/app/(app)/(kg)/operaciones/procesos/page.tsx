import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconOps } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";

export const metadata: Metadata = { title: "Procesos · Operaciones" };

/**
 * Procesos / SOPs — placeholder de andamio.
 *
 * En el commit siguiente: tabla de `processes` con title, category, version,
 * activo. Ficha con render de `content_md` (Markdown). Filtros por
 * category + drawer para crear/editar/versionar.
 *
 * Sin tabla de revisions por decisión (YAGNI). `version` se incrementa a
 * mano cuando el operador considera que hubo un cambio importante. Slug
 * único case-insensitive por org para URLs amigables.
 */
export default function ProcesosPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconOps size={16} />}
        title="Procesos"
        stats={[
          { l: "Activos", v: fCount(0) },
          { l: "Archivados", v: fCount(0) },
        ]}
      />
      <Panel title="Procesos operativos">
        <EmptyState
          icon={<IconOps size={22} />}
          title="Sin procesos cargados"
          hint="Los procesos son SOPs documentados (Markdown) para operar Kingrow: onboarding de team member, playbook de campañas, checklist de cierre de mes. Se organizan por categoría libre y se versionan a mano cuando hay cambios importantes."
        />
      </Panel>
    </div>
  );
}
