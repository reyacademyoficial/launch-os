import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireSessionProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const metadata: Metadata = { title: "Auditoría", robots: { index: false } };

// Cache off — siempre fresca.
export const dynamic = "force-dynamic";

const AUDIT_TABLES = [
  "all",
  "profiles",
  "projects",
  "project_members",
  "launches",
  "launch_assignments",
  "team_members",
  "leads",
  "sales",
  "payments",
  "payment_modalities",
  "commission_rules",
  "commission_rule_tiers",
  "commission_rule_modalities",
  "team_member_payouts",
] as const;

const OP_VALUES = ["all", "INSERT", "UPDATE", "DELETE"] as const;

interface AuditRow {
  id: number;
  occurred_at: string;
  actor_id: string | null;
  actor_role: string | null;
  schema_name: string;
  table_name: string;
  op: "INSERT" | "UPDATE" | "DELETE";
  row_pk: string | null;
  before: unknown;
  after: unknown;
}

interface AuthEventRow {
  id: number;
  occurred_at: string;
  user_id: string;
  kind: "session_start" | "session_end";
  ip: string | null;
  user_agent: string | null;
}

export default async function AuditPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    table?: string;
    op?: string;
    actor?: string;
    tab?: string;
  }>;
}) {
  // Defensa dura: sólo rol 'dev'. Para cualquier otro, devolvemos 404 (no
  // queremos revelar que la ruta existe).
  const me = await requireSessionProfile();
  if (me.role !== "dev") notFound();

  const sp = await searchParams;
  const tableFilter =
    sp.table && (AUDIT_TABLES as readonly string[]).includes(sp.table)
      ? sp.table
      : "all";
  const opFilter =
    sp.op && (OP_VALUES as readonly string[]).includes(sp.op) ? sp.op : "all";
  const actorEmailFilter = (sp.actor ?? "").trim().toLowerCase();
  const tab = sp.tab === "auth" ? "auth" : "audit";

  const supabase = await createClient();
  const service = createServiceClient();

  // Resolver emails desde auth.users para mostrar quién hizo qué.
  const authList = await service.auth.admin.listUsers({ perPage: 1000 });
  const emailByUserId = new Map<string, string>();
  for (const u of authList.data?.users ?? []) {
    if (u.email) emailByUserId.set(u.id, u.email);
  }

  // Actor → uuid si filtran por email.
  let actorIdFilter: string | null = null;
  if (actorEmailFilter) {
    for (const [uid, email] of emailByUserId) {
      if (email.toLowerCase().includes(actorEmailFilter)) {
        actorIdFilter = uid;
        break;
      }
    }
  }

  let auditRows: AuditRow[] = [];
  let authRows: AuthEventRow[] = [];

  if (tab === "audit") {
    let q = supabase
      .from("audit_log")
      .select("id, occurred_at, actor_id, actor_role, schema_name, table_name, op, row_pk, before, after")
      .order("occurred_at", { ascending: false })
      .limit(200);
    if (tableFilter !== "all") q = q.eq("table_name", tableFilter);
    if (opFilter !== "all") q = q.eq("op", opFilter);
    if (actorIdFilter) q = q.eq("actor_id", actorIdFilter);
    const { data } = await q;
    auditRows = (data ?? []) as AuditRow[];
  } else {
    let q = supabase
      .from("auth_events")
      .select("id, occurred_at, user_id, kind, ip, user_agent")
      .order("occurred_at", { ascending: false })
      .limit(200);
    if (actorIdFilter) q = q.eq("user_id", actorIdFilter);
    const { data } = await q;
    authRows = (data ?? []) as AuthEventRow[];
  }

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Auditoría</h1>
        <p className="text-sm text-fg-muted">
          Registro de escrituras (audit_log) y eventos de sesión (auth_events).
          Retención 90 días. Sólo visible para vos.
        </p>
      </header>

      <div className="flex gap-2 border-b border-border">
        <TabLink current={tab} target="audit" qp={sp}>
          Cambios
        </TabLink>
        <TabLink current={tab} target="auth" qp={sp}>
          Sesiones
        </TabLink>
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface/40 p-3"
      >
        <input type="hidden" name="tab" value={tab} />
        {tab === "audit" && (
          <>
            <label className="flex flex-col text-xs text-fg-subtle">
              Tabla
              <select
                name="table"
                defaultValue={tableFilter}
                className="mt-1 rounded border border-border bg-bg-elevated px-2 py-1 text-sm"
              >
                {AUDIT_TABLES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs text-fg-subtle">
              Operación
              <select
                name="op"
                defaultValue={opFilter}
                className="mt-1 rounded border border-border bg-bg-elevated px-2 py-1 text-sm"
              >
                {OP_VALUES.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <label className="flex flex-col text-xs text-fg-subtle">
          Actor (email contiene)
          <input
            name="actor"
            defaultValue={actorEmailFilter}
            placeholder="ej. juan@"
            className="mt-1 rounded border border-border bg-bg-elevated px-2 py-1 text-sm"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white"
        >
          Filtrar
        </button>
      </form>

      {tab === "audit" ? (
        <AuditTable rows={auditRows} emailByUserId={emailByUserId} />
      ) : (
        <AuthEventsTable rows={authRows} emailByUserId={emailByUserId} />
      )}
    </section>
  );
}

function TabLink({
  current,
  target,
  qp,
  children,
}: {
  readonly current: "audit" | "auth";
  readonly target: "audit" | "auth";
  readonly qp: Record<string, string | undefined>;
  readonly children: React.ReactNode;
}) {
  const active = current === target;
  const params = new URLSearchParams();
  params.set("tab", target);
  if (target === "audit") {
    if (qp.table) params.set("table", qp.table);
    if (qp.op) params.set("op", qp.op);
  }
  if (qp.actor) params.set("actor", qp.actor);
  const href = `/dev/auditoria?${params.toString()}`;
  return (
    <a
      href={href}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
        active
          ? "border-accent text-fg"
          : "border-transparent text-fg-muted hover:text-fg"
      }`}
    >
      {children}
    </a>
  );
}

function AuditTable({
  rows,
  emailByUserId,
}: {
  readonly rows: ReadonlyArray<AuditRow>;
  readonly emailByUserId: ReadonlyMap<string, string>;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border bg-surface/40 p-4 text-sm text-fg-muted">
        Sin registros.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Cuándo</th>
            <th scope="col" className="px-3 py-2 font-medium">Actor</th>
            <th scope="col" className="px-3 py-2 font-medium">Rol</th>
            <th scope="col" className="px-3 py-2 font-medium">Tabla</th>
            <th scope="col" className="px-3 py-2 font-medium">Op</th>
            <th scope="col" className="px-3 py-2 font-medium">Row id</th>
            <th scope="col" className="px-3 py-2 font-medium">Diff</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border align-top">
              <td className="px-3 py-2 text-xs text-fg-muted tabular-nums">
                {new Date(r.occurred_at).toLocaleString("es-AR")}
              </td>
              <td className="px-3 py-2 text-xs">
                {r.actor_id
                  ? emailByUserId.get(r.actor_id) ?? r.actor_id.slice(0, 8)
                  : <span className="text-fg-subtle">system</span>}
              </td>
              <td className="px-3 py-2 text-xs text-fg-muted">{r.actor_role ?? "—"}</td>
              <td className="px-3 py-2 text-xs">{r.table_name}</td>
              <td className="px-3 py-2 text-xs">
                <OpBadge op={r.op} />
              </td>
              <td className="px-3 py-2 text-xs font-mono text-fg-muted">
                {r.row_pk ? r.row_pk.slice(0, 8) : "—"}
              </td>
              <td className="px-3 py-2 text-xs">
                <details>
                  <summary className="cursor-pointer text-accent">ver</summary>
                  <pre className="mt-2 max-w-xl overflow-x-auto whitespace-pre-wrap break-words rounded bg-bg-elevated p-2 text-[10px] leading-tight">
                    {formatDiff(r.before, r.after)}
                  </pre>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuthEventsTable({
  rows,
  emailByUserId,
}: {
  readonly rows: ReadonlyArray<AuthEventRow>;
  readonly emailByUserId: ReadonlyMap<string, string>;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border bg-surface/40 p-4 text-sm text-fg-muted">
        Sin eventos.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Cuándo</th>
            <th scope="col" className="px-3 py-2 font-medium">Usuario</th>
            <th scope="col" className="px-3 py-2 font-medium">Evento</th>
            <th scope="col" className="px-3 py-2 font-medium">IP</th>
            <th scope="col" className="px-3 py-2 font-medium">User-Agent</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border align-top">
              <td className="px-3 py-2 text-xs text-fg-muted tabular-nums">
                {new Date(r.occurred_at).toLocaleString("es-AR")}
              </td>
              <td className="px-3 py-2 text-xs">
                {emailByUserId.get(r.user_id) ?? r.user_id.slice(0, 8)}
              </td>
              <td className="px-3 py-2 text-xs">{r.kind}</td>
              <td className="px-3 py-2 text-xs font-mono text-fg-muted">
                {r.ip ?? "—"}
              </td>
              <td className="px-3 py-2 text-xs text-fg-muted">
                {r.user_agent ? truncate(r.user_agent, 80) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OpBadge({ op }: { readonly op: "INSERT" | "UPDATE" | "DELETE" }) {
  const color =
    op === "INSERT"
      ? "bg-success/10 text-success"
      : op === "DELETE"
      ? "bg-error/10 text-error"
      : "bg-accent/10 text-accent";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${color}`}>
      {op}
    </span>
  );
}

function formatDiff(before: unknown, after: unknown): string {
  return JSON.stringify({ before, after }, null, 2);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
