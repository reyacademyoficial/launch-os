import type { Metadata } from "next";

export const metadata: Metadata = { title: "Configuración" };

export default function ConfigurationPage() {
  return (
    <section>
      <h1 className="text-2xl font-bold">Configuración</h1>
      <p className="mt-2 text-sm text-fg-muted">
        Cambio de contraseña propia y edición de <code>full_name</code>. Disponible para
        todos los roles. Placeholder — se cablea en Fase 4 con{" "}
        <code>supabase.auth.updateUser</code>.
      </p>
    </section>
  );
}
