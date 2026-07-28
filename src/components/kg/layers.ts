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
 *   - Comercial-módulo (Comercial ≠ capa Comercial) fuera de v1.
 *   - IA descartada.
 *   - "Lanzamientos" acá es la puerta al project picker de LaunchOS, no un
 *     dashboard más — el módulo lleva a /lanzamientos donde se elige proyecto,
 *     y de ahí se entra al ProjectShell.
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

/**
 * Resolvedor: dado un pathname, devuelve el módulo activo y su capa. Usado por
 * el topbar para renderizar "Capa X · Módulo". Matchea por prefijo — el módulo
 * más específico gana. El caso "/" queda para "Ejecutivo" explícito, sino "/"
 * matchearía cualquier prefijo.
 */
export function resolveActive(pathname: string):
  | { readonly layer: KgLayer; readonly module: KgModule }
  | { readonly layer: null; readonly module: KgModule }
  | null {
  const flatSystemLike = [...SYSTEM_MODULES, ...UTILITY_MODULES, ...HIDDEN_MODULES];
  for (const m of flatSystemLike) {
    if (pathname === m.href || pathname.startsWith(`${m.href}/`)) {
      return { layer: null, module: m };
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
  return best ? { layer: best.layer, module: best.module } : null;
}
