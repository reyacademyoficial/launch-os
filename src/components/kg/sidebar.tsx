import type { SessionProfile } from "@/lib/supabase/auth";

import { KgBrand } from "./brand";
import {
  canSeeOrganization,
  canSeeSystem,
  LAYERS,
  ORGANIZATION_MODULES,
  SYSTEM_MODULES,
  UTILITY_MODULES,
  visibleModulesForRole,
} from "./layers";
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
 * El menú se deriva del rol en el SERVIDOR: si un rol no debería ver algo,
 * el ítem no se emite. Cliente NO llega acá — el cross-guard de (app)/layout
 * lo salta a /portal antes de renderizar este shell.
 */
export function KgSidebar({ profile }: { readonly profile: SessionProfile }) {
  const showSystem = canSeeSystem(profile.role);
  const showOrganization = canSeeOrganization(profile.role);
  // cliente y operador ven un subconjunto de módulos; el resto ve todo.
  const isRestricted =
    profile.role === "cliente" || profile.role === "operador";

  return (
    <aside
      className="kg-glass flex h-full w-[236px] shrink-0 flex-col overflow-y-auto border-r"
      style={{
        background: "var(--kg-bg-base)",
        borderColor: "var(--kg-border-subtle)",
      }}
    >
      <div className="px-4 py-5">
        <KgBrand />
      </div>

      <nav className="flex-1 space-y-4 px-3 pb-4">
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
      </nav>

      <div className="border-t px-3 py-3" style={{ borderColor: "var(--kg-border-subtle)" }}>
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
