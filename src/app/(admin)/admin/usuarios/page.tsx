import type { Metadata } from "next";

import { UserTable } from "@/components/dashboard/admin/user-table";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { listAllUsers } from "@/lib/users/list";

import { CreateUserModal } from "./form";

export const metadata: Metadata = { title: "Usuarios" };

interface ProjectRow {
  id: string;
  name: string;
}

export default async function UsersAdminPage() {
  // (admin) layout already gated to superadmin. We re-read the profile here
  // to know the current user's id (so the table can suppress edit/deactivate
  // on the caller's own row — admins shouldn't lock themselves out from the UI).
  const me = await requireRole("superadmin");

  const supabase = await createClient();
  const [{ data: projectsRaw }, users] = await Promise.all([
    supabase.from("projects").select("id, name").order("name", { ascending: true }),
    listAllUsers(),
  ]);
  const projects = (projectsRaw ?? []) as ProjectRow[];

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Usuarios</h1>
          <p className="mt-1 text-xs text-fg-subtle">{users.length} total</p>
        </div>
        <div className="flex items-center">
          <CreateUserModal projects={projects} />
        </div>
      </header>

      <UserTable users={users} projects={projects} currentUserId={me.id} />
    </section>
  );
}
