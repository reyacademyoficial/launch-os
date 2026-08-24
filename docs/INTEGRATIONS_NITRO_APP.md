# Integración con apps externas (redirect)

**Fase G del plan Academia** — ver [`kingrow-academia-plan.md`](./kingrow-academia-plan.md).

Un curso puede vincularse a una app externa (típicamente la app de agenda de turnos de Nitro). Desde el detalle del curso se muestra un botón que **abre la URL de la app en una pestaña nueva**. No hay SSO ni token; el alumno se autentica en la app externa por sus propios medios.

## Diseño

- Tabla `external_apps` (migración `0153`, simplificada en `0156`) con columnas: `id, project_id, name, base_url, active`.
- FK `courses.external_app_id` — un curso apunta a una app opcional (`ON DELETE SET NULL`).
- CRUD en `/academia/apps-externas` (visible a admin/coordinador/superadmin).
- Botón "Abrir &lt;app&gt;" en el detalle del curso cuando `course.external_app_id` está seteado y la app está `active`. Es un `<a href={base_url} target="_blank">` puro.

## Cómo dar de alta una app

1. Ir a **Academia → Apps externas**.
2. **Nueva app**: elegir proyecto propio, nombre y URL (`https://…`).
3. En el formulario del curso, seleccionar la app en el campo **App externa asociada**.

## Notas

- El link app↔curso solo aparece si el proyecto del curso es `ownership='propia'` (guard en la migración 0153).
- Si la app se elimina, los cursos que la usaban quedan con `external_app_id = NULL` — el botón desaparece.
