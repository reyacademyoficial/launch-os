import type { Metadata } from "next";

import { requireSessionProfile } from "@/lib/supabase/auth";

import { PasswordForm, ProfileForm } from "./forms";

export const metadata: Metadata = { title: "Configuración" };

export default async function ConfigurationPage() {
  const profile = await requireSessionProfile();

  return (
    <section className="max-w-xl space-y-10">
      <header>
        <h1 className="text-2xl font-bold">Configuración</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Actualizá tus datos personales y cambiá tu contraseña.
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
