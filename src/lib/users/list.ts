import "server-only";

import type { Role } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export interface UserListItem {
  id: string;
  email: string;
  fullName: string | null;
  role: Role;
  createdAt: string;
  deletedAt: string | null;
  projects: ReadonlyArray<{ id: string; name: string }>;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  role: string;
  created_at: string;
  deleted_at: string | null;
  is_dev_privileged: boolean;
}

interface MemberRow {
  user_id: string;
  // Supabase relational select returns the joined row as a single object for
  // many-to-one FK relationships. We cast the chain result at the boundary.
  projects: { id: string; name: string } | null;
}

/**
 * Lists every user in the system, joined with their profile metadata and
 * project assignments. Service-role for `auth.admin.listUsers` (which is
 * the only way to read emails from auth.users), and the RLS-authenticated
 * client for `profiles` / `project_members` — both visible in full to the
 * superadmin caller via policy.
 *
 * Sorted by email for stable rendering.
 */
export async function listAllUsers(): Promise<UserListItem[]> {
  const service = createServiceClient();
  const supabase = await createClient();

  const [authResult, profilesResult, membersResult, allProjectsResult] = await Promise.all([
    service.auth.admin.listUsers({ perPage: 1000 }),
    // Incluimos soft-deleted (deleted_at != null): la UI los muestra en gris
    // con un botón "Reactivar". Filtrar acá los ocultaría del panel y no habría
    // forma de recuperarlos sin ir a Studio.
    supabase.from("profiles").select("id, full_name, role, created_at, deleted_at, is_dev_privileged"),
    supabase.from("project_members").select("user_id, projects(id, name)"),
    supabase.from("projects").select("id, name"),
  ]);

  const authUsers = authResult.data?.users ?? [];
  const allProjects = (allProjectsResult.data ?? []) as Array<{ id: string; name: string }>;

  const profileById = new Map<string, ProfileRow>();
  for (const p of (profilesResult.data ?? []) as ProfileRow[]) {
    profileById.set(p.id, p);
  }

  const projectsByUserId = new Map<string, Array<{ id: string; name: string }>>();
  for (const m of (membersResult.data ?? []) as MemberRow[]) {
    if (!m.projects) continue;
    const list = projectsByUserId.get(m.user_id) ?? [];
    list.push(m.projects);
    projectsByUserId.set(m.user_id, list);
  }

  const items: UserListItem[] = [];
  for (const u of authUsers) {
    const profile = profileById.get(u.id);
    if (!profile || !u.email) continue;
    items.push({
      id: u.id,
      email: u.email,
      fullName: profile.full_name,
      role: profile.role as Role,
      createdAt: profile.created_at,
      deletedAt: profile.deleted_at,
      projects: profile.is_dev_privileged ? allProjects : (projectsByUserId.get(u.id) ?? []),
    });
  }

  // Activos primero, inactivos al final; dentro de cada grupo, alfabético.
  items.sort((a, b) => {
    const aInactive = a.deletedAt !== null ? 1 : 0;
    const bInactive = b.deletedAt !== null ? 1 : 0;
    if (aInactive !== bInactive) return aInactive - bInactive;
    return a.email.localeCompare(b.email);
  });
  return items;
}
