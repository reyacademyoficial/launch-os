import type { Metadata } from "next";

import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { listAllUsers } from "@/lib/users/list";

import {
  CreatePersonModal,
} from "@/app/(app)/(kg)/organizacion/personas/create-person-modal";
import {
  PersonasTable,
  type AssignableUser,
  type PersonRow,
} from "@/app/(app)/(kg)/organizacion/personas/personas-table";

export const metadata: Metadata = { title: "Personas · Configuración" };

type ShowFilter = "active" | "inactive" | "all";

function parseShow(sp: Record<string, string | string[] | undefined>): ShowFilter {
  const raw = typeof sp.show === "string" ? sp.show : "active";
  if (raw === "inactive" || raw === "all") return raw;
  return "active";
}

export default async function ConfigPersonasPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("superadmin");

  const sp = await searchParams;
  const show = parseShow(sp);

  const supabase = await createClient();
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

  const assignableUsers: AssignableUser[] = allUsers
    .filter((u) => u.role !== "cliente" && u.deletedAt == null)
    .map((u) => ({ id: u.id, email: u.email, fullName: u.fullName }));

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
            ? "/configuracion/personas"
            : `/configuracion/personas?show=${t.key}`;
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
