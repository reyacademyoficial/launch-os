import "server-only";

import type { Role } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/service";

export interface LaunchAssignee {
  /** `launch_assignments.id` — primary key of the assignment row. */
  assignmentId: string;
  userId: string;
  fullName: string | null;
  email: string;
  role: Role;
  canEdit: boolean;
}

export interface AssignableMember {
  userId: string;
  fullName: string | null;
  email: string;
  role: Role;
}

interface AssignmentRow {
  id: string;
  user_id: string;
  can_edit: boolean;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  role: string;
}

interface MemberRow {
  user_id: string;
}

/**
 * Loads the data the admin needs to manage a launch's assignment list:
 *   - `assignees`: users currently in `launch_assignments` for this launch,
 *     enriched with name + email + role.
 *   - `assignable`: project members eligible to be assigned that are NOT
 *     already on the list. Filtered to operador and cliente, since admin and
 *     analista see all launches in the project by membership and don't need
 *     an explicit assignment row.
 *
 * Service-role on every read because profiles RLS only lets a user see their
 * own profile — the admin running this needs to see other people's names and
 * emails to pick them. The caller MUST be admin+/superadmin (guard at the
 * page or Server Action layer).
 */
export async function loadLaunchAssignmentData(
  projectId: string,
  launchId: string,
): Promise<{
  assignees: LaunchAssignee[];
  assignable: AssignableMember[];
}> {
  const service = createServiceClient();

  const [assignmentsResult, membersResult, authUsersResult] = await Promise.all([
    service
      .from("launch_assignments")
      .select("id, user_id, can_edit")
      .eq("launch_id", launchId),
    service.from("project_members").select("user_id").eq("project_id", projectId),
    service.auth.admin.listUsers({ perPage: 1000 }),
  ]);

  const assignments = (assignmentsResult.data ?? []) as AssignmentRow[];
  const members = (membersResult.data ?? []) as MemberRow[];

  const memberIds = new Set(members.map((m) => m.user_id));
  const assignedIds = new Set(assignments.map((a) => a.user_id));

  // Fetch profiles for everyone we might display (assignees + members).
  const allIds = new Set<string>([...memberIds, ...assignedIds]);
  if (allIds.size === 0) return { assignees: [], assignable: [] };

  const { data: profilesRaw } = await service
    .from("profiles")
    .select("id, full_name, role")
    .in("id", Array.from(allIds))
    .is("deleted_at", null);
  const profiles = (profilesRaw ?? []) as ProfileRow[];
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  const authUsers = authUsersResult.data?.users ?? [];
  const emailById = new Map<string, string>();
  for (const u of authUsers) {
    if (u.email) emailById.set(u.id, u.email);
  }

  const assignees: LaunchAssignee[] = [];
  for (const a of assignments) {
    const profile = profileById.get(a.user_id);
    if (!profile) continue;
    assignees.push({
      assignmentId: a.id,
      userId: a.user_id,
      fullName: profile.full_name,
      email: emailById.get(a.user_id) ?? "",
      role: profile.role as Role,
      canEdit: a.can_edit,
    });
  }
  assignees.sort((a, b) =>
    (a.fullName ?? a.email).localeCompare(b.fullName ?? b.email),
  );

  // Assignable = project members that are operador/cliente AND not already
  // assigned. Admin/analista see all launches by membership, no row needed.
  const assignable: AssignableMember[] = [];
  for (const m of members) {
    if (assignedIds.has(m.user_id)) continue;
    const profile = profileById.get(m.user_id);
    if (!profile) continue;
    if (profile.role !== "operador" && profile.role !== "cliente") continue;
    assignable.push({
      userId: m.user_id,
      fullName: profile.full_name,
      email: emailById.get(m.user_id) ?? "",
      role: profile.role as Role,
    });
  }
  assignable.sort((a, b) =>
    (a.fullName ?? a.email).localeCompare(b.fullName ?? b.email),
  );

  return { assignees, assignable };
}
