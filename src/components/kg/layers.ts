import type { ComponentType } from "react";

import type { Role } from "@/lib/supabase/auth";

import {
  IconAca,
  IconAdmin,
  IconCalc,
  IconCli,
  IconExec,
  IconFin,
  IconLaunch,
  IconMkt,
  IconOps,
  IconOrg,
} from "./icons";

type IconProps = Readonly<{ size?: number; className?: string }>;

export interface KgModule {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly icon: ComponentType<IconProps>;
}

export interface KgLayer {
  readonly id: "estrategica" | "comercial" | "operativa";
  readonly label: string;
  readonly modules: readonly KgModule[];
}

/**
 * v1 Kingrow — capas + módulos habilitados.
 *
 * Diferencia con el artefacto original:
 *   - IA descartada.
 *   - "Lanzamientos" acá es la puerta al project picker de LaunchOS, no un
 *     dashboard más — el módulo lleva a /lanzamientos donde se elige proyecto,
 *     y de ahí se entra al ProjectShell.
 *   - "Comercial" (módulo, no capa) agregado en 6d-C: hostea la
 *     administración cross-proyecto de productos, equipo de ventas,
 *     comisiones y ranking, que antes vivía en `/proyectos/[id]/*`.
 */
export const LAYERS: readonly KgLayer[] = [
  {
    id: "estrategica",
    label: "Estratégica",
    modules: [
      { id: "exec", label: "Ejecutivo", href: "/", icon: IconExec },
      { id: "financiero", label: "Financiero", href: "/financiero", icon: IconFin },
    ],
  },
  {
    id: "comercial",
    label: "Comercial",
    modules: [
      { id: "marketing", label: "Marketing", href: "/marketing", icon: IconMkt },
      { id: "comercial", label: "Comercial", href: "/comercial", icon: IconOrg },
      { id: "lanzamientos", label: "Lanzamientos", href: "/lanzamientos", icon: IconLaunch },
      { id: "clientes", label: "Clientes", href: "/clientes", icon: IconCli },
    ],
  },
  {
    id: "operativa",
    label: "Operativa",
    modules: [
      { id: "operaciones", label: "Operaciones", href: "/operaciones", icon: IconOps },
      { id: "academia", label: "Academia", href: "/academia", icon: IconAca },
    ],
  },
];

/**
 * Sección "Utilidades" — no es una capa, va debajo de las capas. Herramientas
 * transversales sin scope de módulo. Calculadora hoy es la única — la
 * permisología fina (canUseCalculator) sigue viviendo en la page.
 */
export const UTILITY_MODULES: readonly KgModule[] = [
  { id: "calculadora", label: "Calculadora", href: "/calculadora", icon: IconCalc },
];

/**
 * Sección "Organización" — configuración a nivel org (Kingrow). Personas
 * alimenta la nómina; Reglas de split determina cómo se reparten los cobros.
 * Ambas están gateadas por `can_edit_organization` en RLS; la sidebar se
 * derriba a nivel UI para que ni siquiera aparezca a quien no puede editar.
 *
 * El prefijo `/organizacion` nombra exactamente el scope del gate SQL, así
 * el vocabulario del código, la URL y la RLS coinciden.
 */
export const ORGANIZATION_MODULES: readonly KgModule[] = [
  { id: "org-personas", label: "Personas", href: "/organizacion/personas", icon: IconOrg },
  { id: "org-reglas-split", label: "Reglas de split", href: "/organizacion/reglas-split", icon: IconOrg },
];

/**
 * Sección "Sistema" — separada de las capas, sólo visible para roles con
 * capacidad de administrar la plataforma. El artefacto no la define, la
 * agregamos porque LaunchOS ya tiene /admin/proyectos y /admin/usuarios y
 * necesitan entrada visible.
 */
export const SYSTEM_MODULES: readonly KgModule[] = [
  { id: "admin-proyectos", label: "Proyectos", href: "/admin/proyectos", icon: IconAdmin },
  { id: "admin-usuarios", label: "Usuarios", href: "/admin/usuarios", icon: IconAdmin },
];

/**
 * Páginas que existen pero no aparecen en la sidebar (destinos accesibles
 * desde otras superficies: user-block link a Configuración, ruta directa a
 * Auditoría). El topbar las usa para resolver el título del módulo activo.
 */
const HIDDEN_MODULES: readonly KgModule[] = [
  { id: "configuracion", label: "Configuración", href: "/configuracion", icon: IconAdmin },
  { id: "auditoria", label: "Auditoría", href: "/dev/auditoria", icon: IconAdmin },
];

export function canSeeSystem(role: Role): boolean {
  return role === "superadmin" || role === "dev";
}

export function canSeeOrganization(role: Role): boolean {
  return role === "superadmin" || role === "dev";
}

/**
 * Grupos "planos" — no son capas del artefacto, pero cada uno rinde una
 * etiqueta propia en el topbar. Antes existía un solo balde "Sistema" para
 * todo lo no-layer; con la sección Organización el balde se rompió: cada
 * grupo declara su propia etiqueta.
 */
interface FlatGroup {
  readonly label: string;
  readonly modules: readonly KgModule[];
}

const FLAT_GROUPS: readonly FlatGroup[] = [
  { label: "Organización", modules: ORGANIZATION_MODULES },
  { label: "Sistema", modules: SYSTEM_MODULES },
  { label: "Utilidades", modules: UTILITY_MODULES },
  // HIDDEN_MODULES conservan la etiqueta "Sistema" — no se renderizan en la
  // sidebar, sirven sólo para que el topbar tenga título cuando el usuario
  // aterriza en /configuracion o /dev/auditoria.
  { label: "Sistema", modules: HIDDEN_MODULES },
];

/**
 * Resolvedor: dado un pathname, devuelve el módulo activo, su capa y la
 * etiqueta de capa. Usado por el topbar para renderizar "Capa X · Módulo".
 * Matchea por prefijo — el módulo más específico gana. El caso "/" queda para
 * "Ejecutivo" explícito, sino "/" matchearía cualquier prefijo.
 */
export function resolveActive(pathname: string):
  | { readonly layer: KgLayer; readonly layerLabel: string; readonly module: KgModule }
  | { readonly layer: null; readonly layerLabel: string; readonly module: KgModule }
  | null {
  for (const group of FLAT_GROUPS) {
    for (const m of group.modules) {
      if (pathname === m.href || pathname.startsWith(`${m.href}/`)) {
        return { layer: null, layerLabel: group.label, module: m };
      }
    }
  }
  let best: { layer: KgLayer; module: KgModule; score: number } | null = null;
  for (const layer of LAYERS) {
    for (const m of layer.modules) {
      const isExact = pathname === m.href;
      const isPrefix = m.href !== "/" && pathname.startsWith(`${m.href}/`);
      const isRoot = m.href === "/" && pathname === "/";
      if (isExact || isPrefix || isRoot) {
        const score = m.href.length;
        if (!best || score > best.score) {
          best = { layer, module: m, score };
        }
      }
    }
  }
  return best ? { layer: best.layer, layerLabel: best.layer.label, module: best.module } : null;
}
