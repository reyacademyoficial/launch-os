import type { Metadata } from "next";

import { PasswordForm, ProfileForm } from "@/app/(app)/configuracion/forms";
import { requireRole } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Configuración · Portal" };

/**
 * Configuración del cliente — reutiliza `ProfileForm` y `PasswordForm` del
 * (app)/configuracion. Los forms usan server actions que no dependen del
 * shell y solo tocan `auth.updateUser` + un UPDATE en `profiles.full_name`
 * que el grant column-level al `cliente_role` ya cubre.
 */
export default async function ClientConfigurationPage() {
  const profile = await requireRole("cliente");

  return (
    <section className="max-w-xl space-y-10">
      <header>
        <h1 className="text-2xl font-bold">Configuración</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Actualizá tu nombre y tu contraseña.
        </p>
      </header>

      <div className="space-y-3">
        <h2 className="text-base font-semibold text-fg">Mi información</h2>
        <ProfileForm initialFullName={profile.fullName} email={profile.email} />
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-semibold text-fg">Cambiar contraseña</h2>
        <PasswordForm />
      </div>
    </section>
  );
}
