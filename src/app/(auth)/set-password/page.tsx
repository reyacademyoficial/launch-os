import type { Metadata } from "next";

import { SetPasswordForm } from "./form";

export const metadata: Metadata = { title: "Definir contraseña" };

export default function SetPasswordPage() {
  return (
    <main>
      <h1 className="mb-1 text-2xl font-bold text-fg">Definí tu contraseña</h1>
      <p className="mb-6 text-sm text-fg-muted">
        Confirmaste tu invitación. Elegí una contraseña de 8 caracteres o más.
      </p>
      <SetPasswordForm />
    </main>
  );
}
