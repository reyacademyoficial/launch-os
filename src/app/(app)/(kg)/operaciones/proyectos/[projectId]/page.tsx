import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconOps } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { StatusPill } from "@/components/kg/status-pill";
import { createClient } from "@/lib/supabase/server";

import type {
  OwnerOption,
  ProjectInitial,
} from "../internal-project-form-drawer";
import {
  ChecklistsSection,
  type ChecklistData,
  type ChecklistItemData,
} from "./checklists/checklists-section";
import { EditProjectButton } from "./edit-project-button";

export const metadata: Metadata = { title: "Proyecto interno · Operaciones" };

type Status = "backlog" | "active" | "paused" | "done" | "archived";
type Priority = "low" | "med" | "high" | "urgent";

interface ProjectDbRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: Status;
  readonly priority: Priority;
  readonly owner_id: string | null;
  readonly starts_on: string | null;
  readonly due_on: string | null;
  readonly closed_at: string | null;
  readonly notes: string | null;
}

interface PersonDbRow {
  readonly id: string;
  readonly full_name: string;
  readonly active: boolean;
}

const STATUS_LABEL: Record<Status, string> = {
  backlog: "Backlog",
  active: "Activo",
  paused: "En pausa",
  done: "Hecho",
  archived: "Archivado",
};

const STATUS_TONE: Record<Status, string> = {
  backlog: "var(--kg-neutral-500)",
  active: "var(--kg-positive-500)",
  paused: "var(--kg-warning-500)",
  done: "var(--kg-accent-500)",
  archived: "var(--kg-neutral-500)",
};

const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Baja",
  med: "Media",
  high: "Alta",
  urgent: "Urgente",
};

const PRIORITY_TONE: Record<Priority, string> = {
  low: "var(--kg-neutral-500)",
  med: "var(--kg-neutral-500)",
  high: "var(--kg-warning-500)",
  urgent: "var(--kg-negative-500)",
};

// ═══════════════════════════════════════════════════════════════════════════
// Ficha del proyecto interno.
//
// Trae:
//   - El proyecto (notFound si no existe).
//   - Personas activas para el dropdown de owner en el edit drawer.
//
// Las sub-secciones (tasks, blockers, checklists, time entries del
// proyecto) llegan en commits siguientes. Hoy: datos + edit + placeholder.
// ═══════════════════════════════════════════════════════════════════════════

export default async function InternalProjectFichaPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const supabase = await createClient();

  const [projectRes, peopleRes, checklistsRes] = await Promise.all([
    supabase
      .from("internal_projects")
      .select(
        "id, name, description, status, priority, owner_id, starts_on, due_on, closed_at, notes",
      )
      .eq("id", projectId)
      .maybeSingle(),
    supabase
      .from("organization_people")
      .select("id, full_name, active")
      .order("full_name", { ascending: true }),
    // Solo las checklists colgadas DIRECTO del proyecto (XOR). Las que
    // cuelgan de tareas viven en la ficha de la tarea (pendiente).
    supabase
      .from("checklists")
      .select("id, title")
      .eq("internal_project_id", projectId)
      .order("created_at", { ascending: true }),
  ]);

  const project = projectRes.data as ProjectDbRow | null;
  if (!project) notFound();

  const allPeople = (peopleRes.data ?? []) as unknown as PersonDbRow[];
  const ownerName = project.owner_id
    ? allPeople.find((p) => p.id === project.owner_id)?.full_name ?? null
    : null;

  // Segundo batch: items de las checklists del proyecto. En paralelo
  // porque depende de los checklist_ids.
  const checklistRows = (checklistsRes.data ?? []) as unknown as {
    readonly id: string;
    readonly title: string;
  }[];
  const checklistIds = checklistRows.map((c) => c.id);
  const itemsRes =
    checklistIds.length === 0
      ? { data: [] as unknown[] }
      : await supabase
          .from("checklist_items")
          .select("id, checklist_id, content, done, position")
          .in("checklist_id", checklistIds)
          .order("position", { ascending: true });
  const itemRows = (itemsRes.data ?? []) as unknown as {
    readonly id: string;
    readonly checklist_id: string;
    readonly content: string;
    readonly done: boolean;
    readonly position: number;
  }[];
  const itemsByChecklist = new Map<string, ChecklistItemData[]>();
  for (const it of itemRows) {
    const arr = itemsByChecklist.get(it.checklist_id) ?? [];
    arr.push({
      id: it.id,
      content: it.content,
      done: it.done,
      position: it.position,
    });
    itemsByChecklist.set(it.checklist_id, arr);
  }
  const checklists: ChecklistData[] = checklistRows.map((c) => ({
    id: c.id,
    title: c.title,
    items: itemsByChecklist.get(c.id) ?? [],
  }));

  const owners: OwnerOption[] = allPeople
    .filter((p) => p.active)
    .map((p) => ({ id: p.id, fullName: p.full_name }));

  const initial: ProjectInitial = {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    priority: project.priority,
    ownerId: project.owner_id,
    startsOn: project.starts_on,
    dueOn: project.due_on,
    notes: project.notes,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconOps size={16} />}
        title={project.name}
        stats={[
          { l: "Estado", v: STATUS_LABEL[project.status] },
          { l: "Prioridad", v: PRIORITY_LABEL[project.priority] },
          { l: "Owner", v: ownerName ?? "—" },
          { l: "Vence", v: project.due_on ? formatDate(project.due_on) : "—" },
        ]}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gap: 16,
        }}
      >
        <Panel title="Datos del proyecto">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {project.description && (
              <FieldRow
                label="Descripción"
                value={project.description}
                multiline
              />
            )}
            <FieldRow
              label="Estado"
              value={
                <StatusPill
                  text={STATUS_LABEL[project.status]}
                  tone={STATUS_TONE[project.status]}
                />
              }
            />
            <FieldRow
              label="Prioridad"
              value={
                <StatusPill
                  text={PRIORITY_LABEL[project.priority]}
                  tone={PRIORITY_TONE[project.priority]}
                />
              }
            />
            <FieldRow label="Owner" value={ownerName ?? "Sin dueño"} />
            <FieldRow
              label="Inicio"
              value={project.starts_on ? formatDate(project.starts_on) : "—"}
            />
            <FieldRow
              label="Vencimiento"
              value={project.due_on ? formatDate(project.due_on) : "—"}
            />
            {project.closed_at && (
              <FieldRow label="Cerrado" value={formatIso(project.closed_at)} />
            )}
            {project.notes && (
              <FieldRow label="Notas" value={project.notes} multiline />
            )}
            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 6,
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Link
                href="/operaciones/proyectos"
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
              <EditProjectButton owners={owners} initial={initial} />
            </div>
          </div>
        </Panel>

        <Panel title="Tareas del proyecto">
          <EmptyState
            icon={<IconOps size={22} />}
            title="Sub-sección en construcción"
            hint="En el próximo commit acá van las tareas del proyecto (top 5 con status/priority) + link a /operaciones/tareas filtrado por este proyecto."
          />
        </Panel>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
        }}
      >
        <Panel title="Bloqueadores">
          <EmptyState
            icon={<IconOps size={22} />}
            title="Sub-sección en construcción"
            hint="Bloqueos abiertos vinculados a este proyecto (excluye los que cuelgan de sus tareas — esos aparecen dentro de cada tarea)."
          />
        </Panel>
        <Panel title="Checklists">
          <ChecklistsSection
            projectId={project.id}
            checklists={checklists}
          />
        </Panel>
        <Panel title="Tiempo dedicado">
          <EmptyState
            icon={<IconOps size={22} />}
            title="Sub-sección en construcción"
            hint="Suma de minutos por persona en time_entries atados a este proyecto (directo o vía sus tareas)."
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

function formatDate(ymd: string): string {
  try {
    return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return ymd.slice(0, 10);
  }
}

function formatIso(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}
