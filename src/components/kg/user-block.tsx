import Link from "next/link";

import { signOut } from "@/lib/auth/actions";
import type { SessionProfile } from "@/lib/supabase/auth";

import { IconLogout } from "./icons";

/**
 * KG · User block al pie del sidebar. Avatar con inicial, nombre + rol y
 * botón directo de logout. La configuración vive como link — el user-menu
 * popover de LaunchOS ya cubre el mismo flujo desde otras superficies, acá
 * queremos algo persistente al pie del sidebar como en el artefacto.
 */
export function KgUserBlock({
  profile,
  configHref = "/configuracion",
}: {
  readonly profile: SessionProfile;
  readonly configHref?: string;
}) {
  const label = profile.fullName ?? profile.email ?? "Usuario";
  const initial = (profile.fullName ?? profile.email ?? "U").trim().charAt(0).toUpperCase();

  return (
    <div
      className="flex items-center gap-2.5 rounded-[10px] border p-2"
      style={{
        background: "var(--kg-surface-2-solid)",
        borderColor: "var(--kg-border-default)",
      }}
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
        style={{
          background: "linear-gradient(135deg, var(--kg-accent-500), var(--kg-accent-700))",
        }}
        aria-hidden
      >
        {initial}
      </div>
      <Link
        href={configHref}
        className="kg-focus min-w-0 flex-1"
        aria-label="Configuración"
      >
        <div className="kg-t5 truncate" style={{ color: "var(--kg-text-1)" }}>
          {label}
        </div>
        <div className="kg-t7 mt-0.5" style={{ color: "var(--kg-text-3)" }}>
          {profile.role}
        </div>
      </Link>
      <form action={signOut}>
        <button
          type="submit"
          aria-label="Cerrar sesión"
          className="kg-focus flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
          style={{ color: "var(--kg-text-3)" }}
        >
          <IconLogout size={16} />
        </button>
      </form>
    </div>
  );
}
