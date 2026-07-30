import { redirect } from "next/navigation";

/**
 * Landing del módulo Comercial. No tiene dashboard propio todavía — cuando
 * exista (6d-C2 o después), esto puede pasar a mostrarlo. Por ahora
 * redirige a la primera pestaña (Productos).
 */
export default function ComercialIndexPage(): never {
  redirect("/comercial/productos");
}
