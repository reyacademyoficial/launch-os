import type { SessionProfile } from "@/lib/supabase/auth";

import { KgBrand } from "./brand";
import {
  canSeeDev,
  canSeeOrganization,
  canSeeSystem,
  DEV_MODULES,
  LAYERS,
  ORGANIZATION_MODULES,
  SYSTEM_MODULES,
  UTILITY_MODULES,
  visibleModulesForRole,
} from "./layers";
import { MiJornadaPanel } from "./mi-jornada-panel";
import { KgNavItem } from "./nav-item";
import { KgUserBlock } from "./user-block";

/**
 * KG · Sidebar por capas.
 *
 *   - Ancho 236px (matchea el artefacto).
 *   - Superficie glass sobre --kg-bg-base.
 *   - Grupos con label en kg-t7 uppercase (etiquetas de capa).
 *   - Sección Sistema al pie, solo para roles con capacidad de administrar
 *     la plataforma (superadmin/dev). No es una capa — no lleva header de
 *     capa arriba.
 *   - UserBlock al pie del todo (sticky sensación visual, sin sticky real).
 *
 * Layout de scroll: el `<aside>` NO scrollea. Solo scrollea el `<nav>` de
 * módulos (via `flex-1 min-h-0 overflow-y-auto`), así el brand arriba y el
 * bloque MiJornada + UserBlock abajo quedan fijos incluso cuando la lista
 * es larga (roles como dev, que ven capa Sistema + Dev + Utilidades, se
 * llevaban toda la altura y perdían el user block sin scrollear). `min-h-0`
 * es la clave — sin él, el flex-1 no puede achicarse por debajo del height
 * del contenido y el overflow interno nunca se activa.
 *
 * El menú se deriva del rol en el SERVIDOR: si un rol no debería ver algo,
 * el ítem no se emite. Cliente NO llega acá — el cross-guard de (app)/layout
 * lo salta a /portal antes de renderizar este shell.
 */
export function KgSidebar({ profile }: { readonly profile: SessionProfile }) {
  const showSystem = canSeeSystem(profile);
  const showOrganization = canSeeOrganization(profile);
  const showDev = canSeeDev(profile);
  // cliente y operador ven un subconjunto de módulos; el resto ve todo.
  const isRestricted =
    profile.role === "cliente" || profile.role === "operador";

  return (
    <aside
      className="kg-glass flex h-full w-[236px] shrink-0 flex-col border-r pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)]"
      style={{
        background: "var(--kg-bg-base)",
        borderColor: "var(--kg-border-subtle)",
      }}
    >
      <div className="shrink-0 px-4 py-5">
        <KgBrand />
      </div>

      <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        {LAYERS.map((layer) => {
          const modules = visibleModulesForRole(layer.modules, profile.role);
          if (modules.length === 0) return null;
          return (
            <LayerGroup key={layer.id} label={layer.label}>
              {modules.map((m) => (
                <KgNavItem
                  key={m.id}
                  href={m.href}
                  label={m.label}
                  icon={<m.icon size={18} />}
                />
              ))}
            </LayerGroup>
          );
        })}

        {!isRestricted && UTILITY_MODULES.length > 0 && (
          <LayerGroup label="Utilidades">
            {UTILITY_MODULES.map((m) => (
              <KgNavItem
                key={m.id}
                href={m.href}
                label={m.label}
                icon={<m.icon size={18} />}
              />
            ))}
          </LayerGroup>
        )}

        {!isRestricted && showOrganization && ORGANIZATION_MODULES.length > 0 && (
          <LayerGroup label="Organización">
            {ORGANIZATION_MODULES.map((m) => (
              <KgNavItem
                key={m.id}
                href={m.href}
                label={m.label}
                icon={<m.icon size={18} />}
              />
            ))}
          </LayerGroup>
        )}

        {!isRestricted && showSystem && SYSTEM_MODULES.length > 0 && (
          <LayerGroup label="Sistema">
            {SYSTEM_MODULES.map((m) => (
              <KgNavItem
                key={m.id}
                href={m.href}
                label={m.label}
                icon={<m.icon size={18} />}
              />
            ))}
          </LayerGroup>
        )}

        {showDev && DEV_MODULES.length > 0 && (
          <LayerGroup label="Dev">
            {DEV_MODULES.map((m) => (
              <KgNavItem
                key={m.id}
                href={m.href}
                label={m.label}
                icon={<m.icon size={18} />}
              />
            ))}
          </LayerGroup>
        )}
      </nav>

      {/*
        Widget "Mi Jornada" del Anexo A del plan. Server component que se
        auto-hidea (return null) para users sin persona vinculada — típico
        de dev / superadmin sin fila en organization_people. Va justo arriba
        del user block porque es una vista personal — el operador la lee
        junto con su bloque de usuario, no arriba de todo. `shrink-0` para
        que no compita con el nav scrolleable por altura.
      */}
      <div className="shrink-0 px-3 pb-3">
        <MiJornadaPanel />
      </div>

      <div
        className="shrink-0 border-t px-3 py-3"
        style={{ borderColor: "var(--kg-border-subtle)" }}
      >
        <KgUserBlock profile={profile} />
      </div>
    </aside>
  );
}

function LayerGroup({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className="kg-t7 px-2.5 pb-1 pt-2"
        style={{ color: "var(--kg-text-3)" }}
      >
        {label}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
