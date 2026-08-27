import "server-only";

import { unstable_cache } from "next/cache";

import type { BankRow } from "@/lib/banks/types";
import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { createServiceClient } from "@/lib/supabase/service";

import type { ExpenseBucket } from "./expense-categories";
import type { ExpenseCategoryRow } from "./expense-categories-repo";

/**
 * Cache de datos de referencia de Financiero scoped por organización.
 *
 * Tablas que cambian poco y se repiten entre pages:
 *   - banks               (bancos operativos + canales de cliente externo)
 *   - expense_categories  (catálogo de categorías del P&L)
 *   - organization_people (nómina + gastos + comisiones bancarias)
 *
 * Ver src/lib/academia/reference.ts para el patrón de tags e invalidación.
 * Los `as any` sobre el client son deliberados (los types generados están
 * viejos y no reconocen algunas columnas — mismo workaround que Academia).
 */

export interface OrgPersonRef {
  readonly id: string;
  readonly full_name: string;
  readonly active: boolean;
}

// ─── Tags ──────────────────────────────────────────────────────────────

export function tagBanks(orgId: string): string {
  return `finance:${orgId}:banks`;
}
export function tagExpenseCategories(orgId: string): string {
  return `finance:${orgId}:expense-categories`;
}
export function tagOrgPeople(orgId: string): string {
  return `finance:${orgId}:org-people`;
}

export async function currentOrgTagsFinance(): Promise<{
  readonly banks: string;
  readonly expenseCategories: string;
  readonly orgPeople: string;
} | null> {
  const orgId = await resolveCurrentOrganizationId();
  if (!orgId) return null;
  return {
    banks: tagBanks(orgId),
    expenseCategories: tagExpenseCategories(orgId),
    orgPeople: tagOrgPeople(orgId),
  };
}

// ─── Loaders ──────────────────────────────────────────────────────────

const REVALIDATE = 300;

function loadBanks(orgId: string) {
  return unstable_cache(
    async (): Promise<BankRow[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = createServiceClient() as any;
      const { data, error } = await svc
        .from("banks")
        .select("*")
        .eq("organization_id", orgId)
        .order("active", { ascending: false })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as BankRow[];
    },
    ["finance", "banks", orgId],
    { tags: [tagBanks(orgId)], revalidate: REVALIDATE },
  )();
}

function loadExpenseCategories(orgId: string) {
  return unstable_cache(
    async (): Promise<ExpenseCategoryRow[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = createServiceClient() as any;
      const { data, error } = await svc
        .from("expense_categories")
        .select("id, slug, label, bucket, sort_order, is_active")
        .eq("organization_id", orgId)
        .order("sort_order", { ascending: true })
        .order("label", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as Array<{
        id: string;
        slug: string;
        label: string;
        bucket: ExpenseBucket;
        sort_order: number;
        is_active: boolean;
      }>).map((r) => ({
        id: r.id,
        slug: r.slug,
        label: r.label,
        bucket: r.bucket,
        sortOrder: r.sort_order,
        isActive: r.is_active,
      }));
    },
    ["finance", "expense-categories", orgId],
    { tags: [tagExpenseCategories(orgId)], revalidate: REVALIDATE },
  )();
}

function loadOrgPeople(orgId: string) {
  return unstable_cache(
    async (): Promise<OrgPersonRef[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = createServiceClient() as any;
      const { data, error } = await svc
        .from("organization_people")
        .select("id, full_name, active")
        .eq("organization_id", orgId)
        .order("full_name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as OrgPersonRef[];
    },
    ["finance", "org-people", orgId],
    { tags: [tagOrgPeople(orgId)], revalidate: REVALIDATE },
  )();
}

// ─── API pública ──────────────────────────────────────────────────────

async function orgIdOrThrow(): Promise<string> {
  const id = await resolveCurrentOrganizationId();
  if (!id) throw new Error("No hay organización visible para este usuario.");
  return id;
}

export async function getAllBanks(): Promise<BankRow[]> {
  const orgId = await orgIdOrThrow();
  return loadBanks(orgId);
}

export async function getExpenseCategoriesAll(): Promise<ExpenseCategoryRow[]> {
  const orgId = await orgIdOrThrow();
  return loadExpenseCategories(orgId);
}

export async function getOrgPeople(): Promise<OrgPersonRef[]> {
  const orgId = await orgIdOrThrow();
  return loadOrgPeople(orgId);
}
