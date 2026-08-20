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
import {
  NotionCommentComposer,
  type MentionableUser,
} from "./notion-comment-composer";

export const metadata: Metadata = { title: "Proyecto interno · Operaciones" };

type Status =
  | "sin_empezar"
  | "en_proceso"
  | "bloqueado"
  | "alerta_maxima"
  | "listo";
type Priority = "alta" | "media" | "baja";

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
  readonly notion_page_id: string | null;
  readonly notion_workspace_id: string | null;
  readonly notion_synced_at: string | null;
}

interface NotionCommentRow {
  readonly id: string;
  readonly notion_comment_id: string;
  readonly notion_user_id: string | null;
  readonly content_plain: string;
  readonly created_time: string;
  readonly updated_time: string;
}

interface CommentAuthorInfo {
  readonly notionName: string | null;
  readonly notionAvatarUrl: string | null;
  readonly kgPersonId: string | null;
}

interface PersonDbRow {
  readonly id: string;
  readonly full_name: string;
  readonly active: boolean;
}

const STATUS_LABEL: Record<Status, string> = {
  sin_empezar: "Sin empezar",
  en_proceso: "En proceso",
  bloqueado: "Bloqueado",
  alerta_maxima: "Alerta máxima",
  listo: "Listo",
};

const STATUS_TONE: Record<Status, string> = {
  sin_empezar: "var(--kg-neutral-500)",
  en_proceso: "var(--kg-accent-500)",
  bloqueado: "var(--kg-warning-500)",
  alerta_maxima: "var(--kg-negative-500)",
  listo: "var(--kg-positive-500)",
};

const PRIORITY_LABEL: Record<Priority, string> = {
  alta: "Alta",
  media: "Media",
  baja: "Baja",
};

const PRIORITY_TONE: Record<Priority, string> = {
  alta: "var(--kg-warning-500)",
  media: "var(--kg-neutral-500)",
  baja: "var(--kg-neutral-500)",
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
        "id, name, description, status, priority, owner_id, starts_on, due_on, closed_at, notes, notion_page_id, notion_workspace_id, notion_synced_at",
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

  // ─── Comentarios Notion (solo si el project vino de Notion) ──────────────
  // Se cachean en internal_project_notion_comments cuando el sync corre.
  // La ficha los muestra readonly (4d). El write path llega en 4e.
  const isNotionSourced = project.notion_page_id !== null;
  const commentsRes = isNotionSourced
    ? await supabase
        .from("internal_project_notion_comments")
        .select(
          "id, notion_comment_id, notion_user_id, content_plain, created_time, updated_time",
        )
        .eq("internal_project_id", projectId)
        .order("created_time", { ascending: false })
    : null;
  const notionComments = (commentsRes?.data ?? []) as unknown as NotionCommentRow[];

  // Resolver notion_user_id → info del autor (nombre Notion + KG person).
  // Cache local (Map) — evita joins raros de postgrest. Solo tocamos la
  // tabla notion_users si tenemos IDs para consultar.
  const authorByNotionUserId = new Map<string, CommentAuthorInfo>();
  if (
    isNotionSourced &&
    project.notion_workspace_id !== null &&
    notionComments.length > 0
  ) {
    const authorIds = Array.from(
      new Set(
        notionComments
          .map((c) => c.notion_user_id)
          .filter((x): x is string => x !== null),
      ),
    );
    if (authorIds.length > 0) {
      const authorsRes = await supabase
        .from("notion_users")
        .select("notion_user_id, name, avatar_url, kg_person_id")
        .eq("workspace_id", project.notion_workspace_id)
        .in("notion_user_id", authorIds);
      const authors = (authorsRes.data ?? []) as unknown as Array<{
        notion_user_id: string;
        name: string | null;
        avatar_url: string | null;
        kg_person_id: string | null;
      }>;
      for (const a of authors) {
        authorByNotionUserId.set(a.notion_user_id, {
          notionName: a.name,
          notionAvatarUrl: a.avatar_url,
          kgPersonId: a.kg_person_id,
        });
      }
    }
  }

  const allPeople = (peopleRes.data ?? []) as unknown as PersonDbRow[];

  // Usuarios mapeados del workspace para el autocomplete de @mentions del
  // composer (4e). Sólo mapeados a organization_people — decisión de producto:
  // no permitir mencionar cuentas de Notion que no están en Kingrow.
  let mentionableUsers: readonly MentionableUser[] = [];
  if (isNotionSourced && project.notion_workspace_id !== null) {
    const mentionablesRes = await supabase
      .from("notion_users")
      .select("notion_user_id, name, avatar_url, kg_person_id")
      .eq("workspace_id", project.notion_workspace_id)
      .not("kg_person_id", "is", null);
    const rows = (mentionablesRes.data ?? []) as unknown as Array<{
      notion_user_id: string;
      name: string | null;
      avatar_url: string | null;
      kg_person_id: string | null;
    }>;
    mentionableUsers = rows
      .map((r) => {
        const kgName = r.kg_person_id
          ? allPeople.find((p) => p.id === r.kg_person_id)?.full_name ?? null
          : null;
        const displayName = kgName ?? r.name ?? "Usuario de Notion";
        return {
          notionUserId: r.notion_user_id,
          displayName,
          avatarUrl: r.avatar_url,
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "es"));
  }
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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

      {isNotionSourced && (
        <Panel title="Comentarios de Notion">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <NotionCommentComposer
              projectId={project.id}
              mentionableUsers={mentionableUsers}
            />
            <NotionCommentsSection
              comments={notionComments}
              authorByNotionUserId={authorByNotionUserId}
              allPeople={allPeople}
              syncedAt={project.notion_synced_at}
            />
          </div>
        </Panel>
      )}
    </div>
  );
}

function NotionCommentsSection({
  comments,
  authorByNotionUserId,
  allPeople,
  syncedAt,
}: {
  readonly comments: readonly NotionCommentRow[];
  readonly authorByNotionUserId: ReadonlyMap<string, CommentAuthorInfo>;
  readonly allPeople: readonly PersonDbRow[];
  readonly syncedAt: string | null;
}) {
  if (comments.length === 0) {
    return (
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.55,
          color: "var(--kg-text-3)",
        }}
      >
        No hay comentarios en la page de Notion.{" "}
        {syncedAt
          ? `Último sync: ${formatIso(syncedAt)}.`
          : "Este proyecto todavía no fue sincronizado."}{" "}
        Los comentarios se traen en cada corrida de "Sincronizar Notion" —
        escribir desde acá llega en 4e.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {comments.map((c) => {
        const author = c.notion_user_id
          ? authorByNotionUserId.get(c.notion_user_id) ?? null
          : null;
        const kgPersonName =
          author?.kgPersonId
            ? allPeople.find((p) => p.id === author.kgPersonId)?.full_name ?? null
            : null;
        const displayName =
          kgPersonName ?? author?.notionName ?? "Usuario de Notion";

        return (
          <article
            key={c.id}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              padding: "10px 12px",
              borderRadius: "var(--kg-r-10)",
              border: "1px solid var(--kg-border-subtle)",
              background: "var(--kg-surface-1)",
            }}
          >
            <Avatar
              url={author?.notionAvatarUrl ?? null}
              name={displayName}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
              <header
                style={{
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "var(--kg-text-1)",
                  }}
                >
                  {displayName}
                </span>
                {kgPersonName && (
                  <span
                    style={{
                      fontSize: 10,
                      padding: "1px 6px",
                      borderRadius: 999,
                      background: "var(--kg-positive-500-a10, rgba(80,200,120,0.12))",
                      color: "var(--kg-positive-500)",
                      fontWeight: 700,
                    }}
                    title="Autor mapeado a una persona de la organización"
                  >
                    Kingrow
                  </span>
                )}
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--kg-text-3)",
                  }}
                  title={c.created_time}
                >
                  · {formatIso(c.created_time)}
                </span>
              </header>
              <div
                style={{
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: "var(--kg-text-1)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {c.content_plain || <em style={{ color: "var(--kg-text-3)" }}>(comentario vacío)</em>}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function Avatar({
  url,
  name,
}: {
  readonly url: string | null;
  readonly name: string;
}) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name}
        width={28}
        height={28}
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          objectFit: "cover",
          border: "1px solid var(--kg-border-subtle)",
          flexShrink: 0,
        }}
      />
    );
  }
  return (
    <div
      aria-hidden
      style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--kg-surface-2)",
        border: "1px solid var(--kg-border-subtle)",
        color: "var(--kg-text-2)",
        fontSize: 12,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {initial}
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
