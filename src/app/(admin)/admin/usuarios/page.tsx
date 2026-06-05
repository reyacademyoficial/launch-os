import type { Metadata } from "next";

import { createClient } from "@/lib/supabase/server";

import { CreateUserForm } from "./form";

export const metadata: Metadata = { title: "Usuarios" };

export default async function UsersAdminPage() {
  // The (admin) layout already gates with requireRole('superadmin'), so we
  // skip the page-level mirror. The Server Action itself re-checks the role
  // (real auth boundary).
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .order("name", { ascending: true });

  return (
    <section className="max-w-xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Crear usuario</h1>
        <p className="mt-1 text-sm text-fg-muted">
          El usuario queda activo de inmediato con la contraseña inicial que
          definas. Pasale email + contraseña por un canal seguro (chat con E2E,
          password manager). Después él puede cambiarla en <code>/configuracion</code>.
        </p>
      </header>

      <CreateUserForm projects={projects ?? []} />
    </section>
  );
}
