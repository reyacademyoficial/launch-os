import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ContextBar } from "@/components/kg/context-bar";
import { IconOrg } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { StatusPill } from "@/components/kg/status-pill";
import { fCount } from "@/lib/finance/format";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import {
  MembersPanel,
  type AvailablePerson,
  type MemberRowData,
} from "./members-panel";

export const metadata: Metadata = { title: "Equipo · Equipos" };

interface TeamDbRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly active: boolean;
}

interface MembershipDbRow {
  readonly id: string;
  readonly organization_person_id: string;
  readonly role_in_team: string | null;
  readonly joined_at: string;
  readonly left_at: string | null;
  readonly active: boolean;
}

interface PersonDbRow {
  readonly id: string;
  readonly full_name: string;
  readonly active: boolean;
}

export default async function TeamFichaPage({
  params,
}: {
  readonly params: Promise<{ teamId: string }>;
}) {
  await requireRole("superadmin");

  const { teamId } = await params;

  const supabase = await createClient();

  const [teamRes, membershipRes, peopleRes] = await Promise.all([
    supabase
      .from("teams")
      .select("id, name, description, active")
      .eq("id", teamId)
      .maybeSingle(),
    supabase
      .from("team_membership")
      .select(
        "id, organization_person_id, role_in_team, joined_at, left_at, active",
      )
      .eq("team_id", teamId)
      .order("active", { ascending: false })
      .order("joined_at", { ascending: false }),
    supabase
      .from("organization_people")
      .select("id, full_name, active")
      .order("full_name", { ascending: true }),
  ]);

  const team = teamRes.data as TeamDbRow | null;
  if (!team) notFound();

  const memberships =
    (membershipRes.data ?? []) as unknown as MembershipDbRow[];
  const allPeople = (peopleRes.data ?? []) as unknown as PersonDbRow[];

  const personById = new Map<string, PersonDbRow>();
  for (const p of allPeople) personById.set(p.id, p);

  const members: MemberRowData[] = memberships.map((m) => {
    const person = personById.get(m.organization_person_id);
    return {
      membershipId: m.id,
      personId: m.organization_person_id,
      personName: person?.full_name ?? "—",
      personActive: person?.active ?? false,
      roleInTeam: m.role_in_team,
      joinedAt: m.joined_at,
      leftAt: m.left_at,
      active: m.active,
    };
  });

  const activeMemberPersonIds = new Set(
    memberships.filter((m) => m.active).map((m) => m.organization_person_id),
  );

  // Personas disponibles para sumar: activas Y que no sean miembros
  // activos ya. Las inactivas del equipo pueden reaparecer via addMember
  // (que reactiva la fila existente).
  const availablePeople: AvailablePerson[] = allPeople
    .filter((p) => p.active && !activeMemberPersonIds.has(p.id))
    .map((p) => ({ id: p.id, fullName: p.full_name }));

  const activeCount = members.filter((m) => m.active).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconOrg size={16} />}
        title={team.name}
        stats={[
          { l: "Miembros activos", v: fCount(activeCount) },
          { l: "Historial", v: fCount(members.length - activeCount) },
          {
            l: "Estado",
            v: team.active ? "Activo" : "Archivado",
          },
        ]}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)",
          gap: 16,
        }}
      >
        <Panel title="Datos del equipo">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {team.description && (
              <FieldRow
                label="Descripción"
                value={team.description}
                multiline
              />
            )}
            <FieldRow
              label="Estado"
              value={
                <StatusPill
                  text={team.active ? "Activo" : "Archivado"}
                  tone={
                    team.active
                      ? "var(--kg-positive-500)"
                      : "var(--kg-neutral-500)"
                  }
                />
              }
            />
            <FieldRow
              label="Miembros activos"
              value={String(activeCount)}
            />
            <div style={{ marginTop: 4 }}>
              <Link
                href="/organizacion/equipos"
                className="kg-focus"
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  background: "transparent",
                  border: "1px solid var(--kg-border-subtle)",
                  color: "var(--kg-text-2)",
                  fontSize: 11,
                  fontWeight: 700,
                  textDecoration: "none",
                }}
              >
                ← Volver al listado
              </Link>
            </div>
          </div>
        </Panel>

        <Panel title="Miembros">
          <MembersPanel
            teamId={team.id}
            members={members}
            availablePeople={availablePeople}
          />
        </Panel>
      </div>
    </div>
  );
}

function FieldRow({
  label,
  value,
  multiline,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly multiline?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        className="kg-t7"
        style={{ color: "var(--kg-text-3)", fontWeight: 600 }}
      >
        {label}
      </div>
      <div
        style={{
          color: "var(--kg-text-1)",
          fontSize: 13,
          lineHeight: multiline ? 1.55 : 1.4,
          whiteSpace: multiline ? "pre-wrap" : "normal",
        }}
      >
        {value}
      </div>
    </div>
  );
}
