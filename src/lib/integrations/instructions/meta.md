# Cómo conectar Meta Ads

Para que Launch OS pueda traer los datos de tus anuncios de Meta automáticamente, necesitamos **3 datos** del Business Manager:

1. **Token de Usuario del Sistema** (System User) — un "permiso server-to-server" que no vence.
2. **Ad Account ID** — el ID de la cuenta publicitaria.
3. **IDs de las campañas** del lanzamiento.

Launch OS solo lee **métricas agregadas** de tus campañas (gasto, impresiones, clicks y cantidad de leads por día). No accede a los datos personales de los leads.

No es difícil, pero hay que seguir cada paso. **Tomá 5 minutos y hacelo una vez** — después se reutiliza para futuros lanzamientos.

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

## Paso 2 — Asignarle la cuenta publicitaria

Por defecto el System User recién creado no tiene acceso a ninguna cuenta. Hay que asignarle la(s) cuenta(s) publicitaria(s) que vas a usar para el lanzamiento.

1. Hacé click sobre el System User que acabás de crear.
2. Click en **Agregar activos** (Add Assets) o **Asignar activos**.
3. Pestaña **Cuentas publicitarias** (Ad Accounts).
4. Tildá la(s) cuenta(s) que vas a sincronizar.
5. En **Permisos** elegí solo lectura. La opción mínima es **Administrar campañas** (Manage Campaigns) en lectura — para Launch OS alcanza con **Acceso solo a estadísticas** si está disponible.
6. **Guardar cambios**.

---

## Paso 3 — Generar el token de acceso

1. Seguís en la página del System User.
2. Click en **Generar nuevo token** (Generate New Token).
3. Elegí la **app de Facebook** asociada al Business Manager. Si no tenés ninguna creada, andá a [developers.facebook.com/apps](https://developers.facebook.com/apps), creá una app de tipo "Business" (es gratis), y volvé acá.
4. En **Permisos** (Scopes), tildá **únicamente**:

   - `ads_read`

   Es el único permiso que Launch OS necesita. No tildes nada más — cuantos menos permisos, más seguro.

5. Click **Generar token**.
6. **MUY IMPORTANTE**: Copiá el token **completo** al momento. Meta NO te lo va a mostrar de nuevo después. Si lo perdés, generás uno nuevo desde acá mismo y listo.

> El token empieza con `EAAB...` o similar, y tiene unos 200 caracteres.

7. Volvé a Launch OS → detalle del lanzamiento → sección **Integraciones** → Meta → **Pegar token**.

> **App Review**: `ads_read` es un permiso **estándar** de Meta — no requiere App Review. Funciona directo tanto en modo Desarrollo como en modo Live de tu app de Facebook.

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
