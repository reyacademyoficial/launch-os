# Cómo conectar SendFlow

SendFlow gestiona tus comunidades de WhatsApp. Launch OS lo usa **solo para leer métricas de comunidad** (no envía mensajes, no agrega ni saca gente): trae cuántas personas entraron, cuántas salieron y cuántos clics hubo durante el lanzamiento.

Con eso calculamos dos KPIs del lanzamiento:

- **% de retención** de la comunidad — `(entraron − salieron) / entraron`.
- **% de leads que entraron a la comunidad** — `entraron / leads totales del lanzamiento`.

Necesitamos **2 datos** de tu cuenta SendFlow:

1. **API Key** (Bearer token de SendAPI).
2. **Release ID** de cada comunidad de este lanzamiento. Si el lanzamiento tiene varias comunidades, las elegís todas.

---

## Paso 1 — Obtener la API Key

1. Entrá a tu cuenta en **sendflow.pro**.
2. Andá a la sección **SendAPI** (o **API / Integraciones** según el nombre que tenga la pantalla en tu cuenta).
3. Si todavía no tenés una, generá una API Key nueva.
4. **Copiala completa** — empieza con un string largo tipo `sf_...` o similar. Tratala como una contraseña: cualquiera con esa key puede leer las métricas de tus comunidades.
5. Volvé a Launch OS → detalle del lanzamiento → sección **Integraciones** → SendFlow → **Pegar API Key**.

> Si perdés la key, podés revocarla y generar otra. Los datos ya sincronizados no se pierden, solo se corta el sync hasta que pegues la nueva.

---

## Paso 2 — Conseguir los Release IDs de las comunidades

Un **release** en SendFlow es una comunidad de WhatsApp (un grupo o canal donde se acumulan los leads que se suscribieron). Un lanzamiento puede tener **una o más comunidades** — Launch OS suma las métricas de todas.

Forma rápida: una vez que pegaste la API Key, Launch OS llama al endpoint de SendAPI y **te lista las comunidades de tu cuenta para que elijas las que correspondan a este lanzamiento**. Solo tildá las que apliquen y guardá.

Forma manual (si lo necesitás):

1. En sendflow.pro, andá a la pantalla de **comunidades / campañas / releases** (el nombre cambia según la cuenta).
2. Entrá a la comunidad puntual.
3. El ID está en la URL del navegador o en el panel lateral — copialo entero.

> Si arrastrás IDs de otro lanzamiento sin querer, las métricas de comunidad van a quedar infladas. Tildá solo las comunidades de **este** lanzamiento.

---

## Qué pasa después del primer sync

- Launch OS suma `entraron / salieron / clicks` de todas las comunidades elegidas, acotado a la **ventana del lanzamiento** (`date_start` → `date_end`).
- En el dashboard aparecen los dos KPIs (% retención y % que entró).
- Cada vez que apretás **Sincronizar SendFlow**, recalcula con los datos más nuevos. Es idempotente: correrlo 2 veces seguidas no duplica nada.

---

## Cuándo Reconectar

- Si Launch OS te muestra **"Reconectar SendFlow"**, la API Key dejó de funcionar (la revocaste, expiró, cambiaste de plan).
- Volvé al **Paso 1** y pegá una key nueva. Los release IDs guardados no se tocan.

---

## Fuera del alcance

Hoy SendFlow en Launch OS es **solo lectura de métricas agregadas**:

- No envía mensajes ni programa campañas.
- No agrega ni saca gente de las comunidades.
- No hace cruce lead-por-lead con GHL (eso seguiría viviendo en GHL).
