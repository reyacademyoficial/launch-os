# Cómo conectar Meta Ads

Para que Launch OS pueda traer los datos de tus anuncios de Meta automáticamente, necesitamos **3 datos** del Business Manager:

1. **Token de Usuario del Sistema** (System User) — un "permiso server-to-server" que no vence.
2. **Ad Account ID** — el ID de la cuenta publicitaria.
3. **IDs de las campañas** del lanzamiento.

No es difícil, pero hay que seguir cada paso. **Tomá 10 minutos y hacelo una vez** — después se reutiliza para futuros lanzamientos.

> **Nota:** Meta cambia la UI del Business Manager seguido. Si una pantalla no coincide exactamente con la descripción, buscá la opción equivalente — la lógica es siempre la misma. Link a la doc oficial al final.

---

## Paso 1 — Crear el Usuario del Sistema (System User)

El System User es un "usuario virtual" que no es una persona real. Es lo que recomienda Meta para integraciones server-to-server porque su token **no vence** (a diferencia del token personal que vence cada 60 días).

1. Entrá a **business.facebook.com** con tu cuenta de admin del Business Manager.
2. Arriba a la derecha, click en tu foto → **Configuración del negocio** (Business Settings).
3. En el menú de la izquierda: **Usuarios** → **Usuarios del sistema** (System Users).
4. Click en **Agregar** (botón azul).
5. Poné un nombre descriptivo. Por ejemplo: `Launch OS sync`.
6. Rol del usuario del sistema: **Empleado** (Employee). NO admin.
7. Click **Crear usuario del sistema**.

---

## Paso 2 — Asignarle los activos (cuenta publicitaria + Page)

Por defecto el System User recién creado no tiene acceso a ninguna cuenta. Hay que asignarle la(s) cuenta(s) **y la(s) Facebook Page(s)** que vas a usar para el lanzamiento.

### 2.A — Cuenta publicitaria

1. Hacé click sobre el System User que acabás de crear.
2. Click en **Agregar activos** (Add Assets) o **Asignar activos**.
3. Pestaña **Cuentas publicitarias** (Ad Accounts).
4. Tildá la(s) cuenta(s) que vas a sincronizar.
5. En **Permisos** elegí solo lectura. La opción mínima es **Administrar campañas** (Manage Campaigns) en lectura — para Launch OS alcanza con **Acceso solo a estadísticas** si está disponible.
6. **Guardar cambios**.

### 2.B — Facebook Page

Los Instant Forms (Formularios para clientes potenciales) viven en la Facebook Page, no en la cuenta publicitaria. Sin asignar la Page acá, Launch OS no puede traer el detalle individual de cada lead (nombre, teléfono, email).

1. En la misma pantalla, **Agregar activos** → pestaña **Páginas** (Pages).
2. Tildá la Page que aloja los formularios de leads de tu campaña.
3. Permiso: **Acceso a anuncios** (Ads access) como mínimo. Si solo está disponible **Acceso completo**, dalo — el System User es una cuenta de servicio interna, no un externo.
4. **Guardar cambios**.

> Si no tenés clara cuál es la Page: andá al Administrador de anuncios → cualquier ad de la campaña → identidad del anuncio → ahí dice qué Page la publica.

---

## Paso 3 — Generar el token de acceso

1. Seguís en la página del System User.
2. Click en **Generar nuevo token** (Generate New Token).
3. Elegí la **app de Facebook** asociada al Business Manager. Si no tenés ninguna creada, andá a [developers.facebook.com/apps](https://developers.facebook.com/apps), creá una app de tipo "Business" (es gratis), y volvé acá.
4. En **Permisos** (Scopes), tildá los siguientes:

   **Obligatorios para el sync de números (CPL, leads, gasto):**
   - `ads_read`

   **Obligatorios para traer el detalle individual de cada lead** (nombre, teléfono, email a la tabla `leads` de Launch OS):
   - `leads_retrieval`
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_ads`
   - `ads_management`

   Aunque hoy uses solo el sync de números, **tildá los 6 igual** desde el principio. Activar permisos nuevos después implica regenerar el token y, para los permisos de leads, suele requerir App Review de Meta (ver nota abajo). Es mucho más rápido tildarlos todos ahora que volver dentro de 2 meses.

5. Click **Generar token**.
6. **MUY IMPORTANTE**: Copiá el token **completo** al momento. Meta NO te lo va a mostrar de nuevo después. Si lo perdés, generás uno nuevo desde acá mismo y listo.

> El token empieza con `EAAB...` o similar, y tiene unos 200 caracteres.

7. Volvé a Launch OS → detalle del lanzamiento → sección **Integraciones** → Meta → **Pegar token**.

### Nota sobre App Review (solo para los permisos de leads)

`leads_retrieval`, `pages_manage_ads`, `pages_read_engagement` y `pages_show_list` son permisos **avanzados**. Si tu app de Facebook está en modo **Desarrollo**, los permisos están disponibles solo para admins/desarrolladores de la app — funciona para sincronizar TU propio Business Manager sin trámite extra.

Si tu app pasa a modo **Live** o si querés que cualquier usuario (no solo admins) pueda conectar su BM, vas a tener que pasar **App Review** de Meta:
- Página: business.facebook.com → tu app → **App Review** → **Permissions and Features**.
- Tenés que enviar: un screencast del flujo de usuario, descripción del caso de uso, y la política de privacidad de tu sitio. Meta responde en 3-7 días hábiles típicamente.
- Mientras tanto, la app sigue funcionando en modo Desarrollo para los admins.

`ads_read` y `ads_management` son **estándar** (no requieren App Review).

---

## Paso 4 — Conseguir el Ad Account ID

1. En business.facebook.com → **Configuración del negocio** → **Cuentas publicitarias**.
2. Click sobre la cuenta que asignaste al System User.
3. Arriba vas a ver el ID. **Tiene el formato `act_XXXXXXXXX`** (con `act_` adelante y números atrás).
4. Copialo entero (con el `act_`) y pegalo en Launch OS → campo **Ad Account ID**.

> Si no ves el prefijo `act_`, agregalo manualmente al pegar — siempre arranca con `act_`.

---

## Paso 5 — Conseguir los IDs de las campañas

Esto es **importante**: Launch OS pide IDs de campañas porque dos lanzamientos pueden compartir la misma cuenta publicitaria, y necesitamos saber **qué campañas atribuís a este lanzamiento puntual** (sino mezclamos los gastos sin querer).

1. Abrí el **Administrador de anuncios** (Ads Manager) — el clásico, no el Business Suite.
2. Asegurate de estar en la cuenta correcta (selector arriba a la izquierda).
3. Vista de **Campañas**.
4. En la barra de columnas, click derecho → **Personalizar columnas** → buscá **ID** y tildalo.
5. Aplicar. Ahora cada campaña te muestra su ID — un número largo tipo `120203456789012345`.
6. Copiá los IDs de las campañas que correspondan a este lanzamiento.
7. En Launch OS → campo **Campaign IDs** → pegalos **separados por coma o por espacio**. Ej: `120203456 120204567` o `120203456,120204567`.

> Si la columna ID no aparece para elegir, otra forma: hacé click en una campaña, mirá la URL del navegador — adentro está el `?campaign_id=XXXXX` o similar.

---

## Cuándo Reconectar

- Si Launch OS te muestra el badge **"Reconectar Meta"**, significa que el token dejó de funcionar (puede pasar si revocaste permisos en Business Manager o cambiaste el password del admin).
- En ese caso: volvé al Paso 3 → **Generar nuevo token** desde el mismo System User → pegalo en Launch OS.
- Los datos ya sincronizados no se pierden — solo se interrumpe el sync nuevo hasta reconectar.

---

## Documentación oficial de Meta

Si alguna pantalla acá no coincide con lo que ves, verificá contra los docs oficiales (cambian seguido):

- **System Users**: [developers.facebook.com/docs/marketing-api/system-users/overview](https://developers.facebook.com/docs/marketing-api/system-users/overview)
- **Generar tokens**: [developers.facebook.com/docs/marketing-api/businessmanager/systemuser/install-apps-and-generate-tokens](https://developers.facebook.com/docs/marketing-api/businessmanager/systemuser/install-apps-and-generate-tokens)
- **Permisos / scopes**: [developers.facebook.com/docs/permissions](https://developers.facebook.com/docs/permissions)
