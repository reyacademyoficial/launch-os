import type { Metadata } from "next";

import { requireSessionProfile } from "@/lib/supabase/auth";

import { PasswordForm, ProfileForm } from "./forms";

export const metadata: Metadata = { title: "Mi cuenta · Configuración" };

export default async function ConfiguracionPage() {
  const profile = await requireSessionProfile();

  return (
    <section className="max-w-xl space-y-10">
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
