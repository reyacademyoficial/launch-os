import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ProductDelete } from "@/components/dashboard/products/product-delete";
import { ProductModal } from "@/components/dashboard/products/product-modal";
import { listProductsForProject } from "@/lib/products/list";
import { requireSessionProfile, userCanEditProject } from "@/lib/supabase/auth";

import {
  createProduct,
  deleteProduct,
  updateProduct,
} from "./actions";

export const metadata: Metadata = { title: "Productos" };

export default async function ProductsPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  // Admin-only. Mismo criterio que /comisiones: el catálogo es decisión
  // estructural del proyecto. RLS bloquea writes igual, pero redirigimos
  // para no mostrar una página vacía a operadores/analistas.
  const profile = await requireSessionProfile();
  const canEdit = await userCanEditProject(projectId);
  if (!canEdit) redirect(`/proyectos/${projectId}`);
  void profile;

  const products = await listProductsForProject(projectId);

  const createAction = createProduct.bind(null, projectId);

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Productos</h1>
        <p className="text-sm text-fg-muted">
          Catálogo de lo que se vende en el proyecto. Cada venta se asigna a un
          producto. El monto se sigue cargando venta a venta — el producto sólo
          etiqueta y permite filtrar cobros.
        </p>
      </header>

      <section className="space-y-3">
        <header className="flex items-baseline justify-between gap-4">
          <h2 className="text-base font-semibold text-fg">Catálogo</h2>
          <ProductModal
            triggerLabel="+ Nuevo producto"
            triggerClassName="!px-3 !py-1.5 !text-xs"
            title="Nuevo producto"
            submitLabel="Crear"
            action={createAction}
          />
        </header>
        {products.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-surface/40 p-4 text-sm text-fg-muted">
            Sin productos. Cargá el primero para poder registrar ventas.
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Nombre</th>
                  <th scope="col" className="px-4 py-3 font-medium">Descripción</th>
                  <th scope="col" className="px-4 py-3 font-medium">Estado</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const updateAction = updateProduct.bind(null, projectId, p.id);
                  const deleteAction = deleteProduct.bind(null, projectId, p.id);
                  return (
                    <tr key={p.id} className="border-t border-border">
                      <td className="px-4 py-3 font-medium text-fg">{p.name}</td>
                      <td className="px-4 py-3 text-fg-muted">
                        {p.description ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        {p.active ? (
                          <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                            Activo
                          </span>
                        ) : (
                          <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-fg-subtle">
                            Inactivo
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-start justify-end gap-2">
                          <ProductModal
                            triggerLabel="Editar"
                            triggerVariant="secondary"
                            triggerClassName="!px-2 !py-1 !text-xs"
                            title={`Editar ${p.name}`}
                            submitLabel="Guardar"
                            action={updateAction}
                            initial={p}
                          />
                          <ProductDelete name={p.name} action={deleteAction} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
