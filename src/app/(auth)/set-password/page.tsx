import type { Metadata } from "next";

export const metadata: Metadata = { title: "Definir contraseña" };

export default function SetPasswordPage() {
  return (
    <main>
      <h1 className="mb-2 text-2xl font-bold text-fg">Definí tu contraseña</h1>
      <p className="text-sm text-fg-muted">
        Placeholder. La Fase 3 monta el flujo completo de invitación → confirmación →
        seteo de contraseña vía <code>supabase.auth.updateUser</code>.
      </p>
    </main>
  );
}
