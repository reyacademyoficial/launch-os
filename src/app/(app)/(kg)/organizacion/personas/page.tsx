import type { Metadata } from "next";

import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { listAllUsers } from "@/lib/users/list";

import { CreatePersonModal } from "./create-person-modal";
import {
  PersonasTable,
  type AssignableUser,
  type PersonRow,
} from "./personas-table";

export const metadata: Metadata = { title: "Personas" };

type ShowFilter = "active" | "inactive" | "all";

function parseShow(sp: Record<string, string | string[] | undefined>): ShowFilter {
  const raw = typeof sp.show === "string" ? sp.show : "active";
  if (raw === "inactive" || raw === "all") return raw;
  return "active";
}

export default async function PersonasPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Doble gate: el layout /organizacion ya se aseguró de superadmin, pero
  // repetirlo acá deja explícito el contrato y protege ante server actions
  // invocadas directo por URL (no rendered).
  await requireRole("superadmin");

  const sp = await searchParams;
  const show = parseShow(sp);

  const supabase = await createClient();
  // RLS de organization_people gatea por can_edit_organization — el listado
  // se limita solo por la etiqueta de estado, no hace falta filtrar por org.
  const [{ data }, allUsers] = await Promise.all([
    supabase
      .from("organization_people")
      .select(
        "id, full_name, national_id, email, phone, notes, active, created_at, monthly_salary, salary_currency, auth_user_id",
      )
      .order("active", { ascending: false })
      .order("full_name", { ascending: true }),
    listAllUsers(),
  ]);

  const rows = (data ?? []) as PersonRow[];
  const activeCount = rows.filter((p) => p.active).length;
  const inactiveCount = rows.length - activeCount;

  // Usuarios asignables al dropdown de "Usuario Kingrow" en la edición.
  // Excluimos cliente_role (portal externo, no operan) y soft-deleted.
  // `listAllUsers` ya excluye rol dev. Dev con persona vinculada hay que
  // hacerlo por Studio — es un caso edge que no justifica UI.
  const assignableUsers: AssignableUser[] = allUsers
    .filter((u) => u.role !== "cliente" && u.deletedAt == null)
    .map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
    }));

  const filtered =
    show === "all"
      ? rows
      : show === "active"
        ? rows.filter((p) => p.active)
        : rows.filter((p) => !p.active);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Personas</h1>
          <p className="mt-1 text-xs text-fg-subtle">
            {activeCount} activa{activeCount === 1 ? "" : "s"} · {inactiveCount}{" "}
            inactiva{inactiveCount === 1 ? "" : "s"}
          </p>
          <p className="mt-2 text-xs text-fg-muted max-w-2xl">
            Alta de personas reales de la organización. Alimenta la nómina, el
            control de tiempo y la asignación operativa. Vincular con un{" "}
            <code>team_member</code> se hace desde la pantalla del proyecto que
            corresponda — acá solo se administra la identidad.
          </p>
        </div>
        <div className="flex items-center">
          <CreatePersonModal />
        </div>
      </header>

      <FilterTabs current={show} activeCount={activeCount} inactiveCount={inactiveCount} />

      <PersonasTable
        rows={filtered}
        showingFilter={show}
        assignableUsers={assignableUsers}
      />
    </section>
  );
}

/**
 * Tabs simples URL-based. searchParams manda la vista actual; navegación
 * server-rendered evita cualquier estado cliente para algo tan chico.
 */
function FilterTabs({
  current,
  activeCount,
  inactiveCount,
}: {
  readonly current: ShowFilter;
  readonly activeCount: number;
  readonly inactiveCount: number;
}) {
  const tabs: readonly { key: ShowFilter; label: string; count: number }[] = [
    { key: "active", label: "Activas", count: activeCount },
    { key: "inactive", label: "Inactivas", count: inactiveCount },
    { key: "all", label: "Todas", count: activeCount + inactiveCount },
  ];
  return (
    <nav className="flex gap-1 border-b border-border text-xs">
      {tabs.map((t) => {
        const isCurrent = t.key === current;
        const href =
          t.key === "active"
            ? "/organizacion/personas"
            : `/organizacion/personas?show=${t.key}`;
        return (
          <a
            key={t.key}
            href={href}
            className={
              "border-b-2 px-3 py-2 font-medium transition-colors " +
              (isCurrent
                ? "border-accent text-fg"
                : "border-transparent text-fg-muted hover:text-fg")
            }
          >
            {t.label} <span className="ml-1 text-fg-subtle">({t.count})</span>
          </a>
        );
      })}
    </nav>
  );
}
