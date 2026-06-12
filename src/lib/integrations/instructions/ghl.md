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
4. **Permisos (Scopes)** — marcá EXACTAMENTE estos. Cualquier otro está de más:
   - `View Contacts`
   - `View Calendars`
   - `View Calendar Events`
   - `View Conversations`
   - `View Conversation Messages`

   No marques permisos de edición. Launch OS **solo lee** — no modifica contactos ni envía mensajes desde acá.

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

- **Agendados**: los eventos del calendario del subaccount cuya fecha de comienzo esté dentro de la ventana del lanzamiento. Cada agendado se cruza con los leads del proyecto **por teléfono normalizado**. Si matchea uno existente y el lead no está cerrado/perdido, pasa a estado *agendado* y se promueve al kanban. Si no matchea ninguno, se crea un lead nuevo con origen `ghl` directamente en *agendado*.
- **Conversaciones de WhatsApp**: las conversaciones del canal WhatsApp con último mensaje dentro de la ventana del lanzamiento. Mismo cruce por teléfono. Si matchea, el lead se promueve al kanban sin cambiar el estado. Si no matchea, se crea uno nuevo con origen `whatsapp`.

El sync es **idempotente**: si lo corrés dos veces, no duplica ni vuelve a mover leads que ya procesó.

---

## Si algo falla

| Mensaje en el run | Qué revisar |
| --- | --- |
| `token_invalid` (401/403) | El token fue revocado en GHL, el subaccount cambió de dueño, o el scope no incluye los permisos del paso 2. Regenerá el token. |
| `rate_limited` (429) | Demasiadas llamadas seguidas. Esperá unos minutos y volvé a sincronizar. |
| `config_missing` | Falta el Location ID o el token en el lanzamiento. Volvé al paso 3. |
| `error` con detalle de schema | GHL cambió el shape de la respuesta. Avisanos para actualizar el adapter. |

Doc oficial de referencia: [highlevel.stoplight.io](https://highlevel.stoplight.io/) (sección "Calendars" y "Conversations").
