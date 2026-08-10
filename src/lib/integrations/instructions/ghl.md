Para conectar Go High Level a un lanzamiento necesitás dos datos: el **Location ID** (el identificador del subaccount del cliente) y un **Private Integration Token** (la credencial que autoriza a Launch OS a leer datos de ese subaccount).

El token que vamos a generar **no vence**. Es el equivalente a un "permiso permanente": queda guardado en el lanzamiento y el sync lo usa cada vez que corre.

---

## 1. Conseguir el Location ID

El Location ID identifica al subaccount del cliente dentro de GHL. Es el mismo número para todos los lanzamientos de ese cliente.

1. Iniciá sesión en GHL como administrador del subaccount.
2. Si tenés acceso a varios subaccounts, **entrá al del cliente correcto** desde el selector superior izquierdo (Switch Sub-Account).
3. En el menú lateral entrá a **Settings** (icono de engranaje, abajo a la izquierda).
4. Mirá la URL del navegador. Vas a ver algo así:

   `https://app.gohighlevel.com/v2/location/abc123XYZ456/settings/...`

   El `abc123XYZ456` (el segmento que va después de `/location/`) **es tu Location ID**. Copialo.

   > Otro lugar donde aparece: dentro de **Settings → Business Profile**, hay un campo "Location ID" que es exactamente lo mismo.

Guardalo a mano para el paso 3.

---

## 2. Generar el Private Integration Token

Este token es lo que Launch OS va a usar para llamar a la API de GHL en nombre del subaccount. **Lo generás una sola vez**.

1. Dentro del mismo subaccount, andá a **Settings → Private Integrations** (en el menú lateral, a veces aparece como "Private Integration" en singular).

   > Si no ves la opción, pedile al admin del subaccount que la habilite. Algunos planes de GHL la tienen oculta por defecto.

2. Click **Create New Integration**.
3. Ponele un nombre que vas a reconocer después, por ejemplo: **`Launch OS — sync`**.
4. **Permisos (Scopes)** — marcá EXACTAMENTE estos tres. Cualquier otro está de más:
   - `View Contacts`
   - `View Conversations`
   - `View Users`

   No marques permisos de edición ni de calendars/opportunities. Launch OS **solo lee** contactos, conversaciones y usuarios — no modifica nada en GHL ni envía mensajes desde acá.

   > Si ya tenías la integración creada con los permisos viejos (Calendars, Calendar Events, Opportunities), podés dejarlos — no molestan. Pero para una integración nueva alcanzan estos tres.

5. Click **Create**.
6. GHL te va a mostrar el token en pantalla — empieza con `pit-` seguido de una cadena larga.

   > **Copialo ahora**. GHL no te lo muestra dos veces. Si lo perdés, hay que crear uno nuevo y borrar el viejo.

---

## 3. Cargarlo en Launch OS

1. Entrá al detalle del lanzamiento donde querés conectar GHL.
2. En la sección **Integraciones**, click **Conectar** sobre el card de Go High Level.
3. Pegá:
   - **Subaccount ID**: el Location ID del paso 1.
   - **Private integration token**: el `pit-...` del paso 2.
4. Guardá y disparí **Sincronizar**.

---

## Qué se va a sincronizar

El sync hace **dos cosas**, ambas en una sola corrida del botón **Sincronizar**:

1. **Cuenta de leads captados por día** (KPI card "Leads GHL" + curva en la gráfica).
   Pide a GHL, por cada día de la ventana `[fecha inicio, fecha fin]` del lanzamiento, cuántos contactos nuevos hay (`dateAdded` de ese día). **No baja los datos del contacto** — solo el número. Se guarda por día para poder ver la evolución en el gráfico junto a Meta y SendFlow.

2. **Asignación de vendedor a leads existentes** (solo dentro de compra+cierre).
   Trae los contactos que fueron actualizados o tuvieron actividad WhatsApp dentro de compra+cierre, matchea contra los leads del proyecto por `external_id` o teléfono, y setea `team_member_id` según el mapeo GHL user → vendedor del modal "Mapear vendedores". Respeta la regla "manual gana": si el lead ya tiene vendedor asignado a mano, no lo pisa.

Lo que **NO** hace este sync (a propósito):
- **No crea leads nuevos en Launch OS** — los leads los alimentan Meta (formularios de campaña) y la carga manual de orgánicos. Un contacto de GHL sin match contra un lead existente se ignora.
- **No cambia el status** de los leads (frío/tibio/agendado/cerrado). El status viene del Kanban y de la carga de ventas, no de GHL.
- **No sincroniza appointments, calendars ni opportunities.**

El sync es **idempotente** (correrlo dos veces no duplica) e **incremental** para la parte de asignación de vendedor (arranca desde el último sync exitoso). La cuenta de leads pide siempre la ventana completa del lanzamiento — es barato: 1 request por día.

---

## Si algo falla

| Mensaje en el run | Qué revisar |
| --- | --- |
| `token_invalid` (401/403) | El token fue revocado en GHL, el subaccount cambió de dueño, o el scope no incluye los permisos del paso 2. Regenerá el token. |
| `rate_limited` (429) | Demasiadas llamadas seguidas. Esperá unos minutos y volvé a sincronizar. |
| `config_missing` | Falta el Location ID o el token en el lanzamiento. Volvé al paso 3. |
| `error` con detalle de schema | GHL cambió el shape de la respuesta. Avisanos para actualizar el adapter. |

Doc oficial de referencia: [highlevel.stoplight.io](https://highlevel.stoplight.io/) (secciones "Contacts", "Conversations" y "Users").
