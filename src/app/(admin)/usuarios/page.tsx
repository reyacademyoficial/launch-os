import type { Metadata } from "next";

export const metadata: Metadata = { title: "Usuarios" };

export default function UsersAdminPage() {
  return (
    <section>
      <h1 className="text-2xl font-bold">Usuarios</h1>
      <p className="mt-2 text-sm text-fg-muted">
        Invitación de usuarios vía Server Action con service-role
        (<code>auth.admin.inviteUserByEmail</code> + insert en{" "}
        <code>project_members</code>). Placeholder — Fase 3 / Fase 8.
      </p>
    </section>
  );
}
