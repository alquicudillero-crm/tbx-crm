# Instalar el CRM de TRAVEL BIKEX en tu dominio

Tienes dos paquetes:

| Paquete | Qué es | Dónde va |
|---|---|---|
| **tbx-web** | La web: el CRM (`crm/`) y la página de clientes de Dolomitas (`viajes/dolomitas-2026/`). No contiene datos personales. | Repositorio de **GitHub** (GitHub Pages) |
| **tbx-migracion** | Tus datos: viajes, hoteles, clientes, pagos, etapas, gastos y los 28 archivos (pasaportes, consentimiento, perfiles, tracks). | **Solo en tu ordenador.** Se importa una vez a Supabase. **Nunca lo subas a GitHub.** |

Puedes usar el mismo proyecto de Supabase de alquicudillero o uno nuevo. Todo lo del CRM va con el prefijo `tbx_`, así que no se mezcla con nada, y solo los emails que pongas en `tbx_team` pueden ver los datos.

---

## 1. Supabase

1. Abre tu proyecto en **supabase.com**.
2. **SQL Editor → New query**. Abre `01_supabase.sql` y cambia la línea `('nuria@travelbikex.com')` por los emails de tu equipo (uno por línea, separados por comas). Pégalo y pulsa **Run**.
3. **Authentication → Users → Add user → Create new user**. Crea un usuario por persona del equipo, con el **mismo email** que pusiste en el paso 2, una contraseña y **Auto Confirm User** marcado.
4. **Authentication → URL Configuration**:
   - **Site URL:** `https://TU-DOMINIO/crm/`
   - **Redirect URLs:** añade `https://TU-DOMINIO/crm/` (sirve para «He olvidado la contraseña»).
5. **Authentication → Sign In / Providers → Email**: si el proyecto es solo del CRM, desactiva **Allow new users to sign up**. Si lo compartes con alquicudillero y allí sí se registran usuarios, déjalo como está: la tabla `tbx_team` ya impide que entren en el CRM.
6. **Project Settings → API**: copia **Project URL** y la clave **anon public**.

## 2. GitHub Pages

1. Crea un repositorio nuevo, por ejemplo `tbx-crm`.
2. Sube **el contenido** de la carpeta `tbx-web` (no la carpeta en sí): `index.html`, `crm/` y `viajes/`.
3. En GitHub, abre `crm/config.js`, pulsa el lápiz y pega los dos valores del paso 1.6:
   ```js
   supabaseUrl: "https://xxxxxxxx.supabase.co",
   supabaseAnonKey: "eyJhbGciOi..."
   ```
   Guarda con **Commit changes**. Es normal que la clave anon esté a la vista: los datos los protegen las reglas de Supabase.
4. **Settings → Pages**: Source **Deploy from a branch**, rama **main**, carpeta **/ (root)** → Save.
5. En la misma pantalla, **Custom domain**: escribe tu dominio o subdominio (por ejemplo `crm.travelbikex.com`) → Save. Marca **Enforce HTTPS** cuando aparezca.
6. En tu proveedor de dominio (DNS), crea un registro **CNAME**: nombre `crm` → valor `TU-USUARIO.github.io`. Igual que hiciste con alquicudillero.

## 3. Pasar tus datos (una sola vez)

1. Entra en `https://TU-DOMINIO/crm/?importar` e inicia sesión.
2. Elige la carpeta **tbx-migracion** de tu ordenador (la que contiene `datos.json` y `archivos/`).
3. Espera a ver **«Listo: 41 registros y 28 archivos importados»** y pulsa **Ir al CRM**.

Si se corta, repítelo: no duplica nada.

## 4. Uso diario

- **CRM (tú y tus guías):** `https://TU-DOMINIO/crm/`. Cada uno con su email y contraseña. «Salir» está arriba a la derecha.
- **Clientes de Dolomitas:** `https://TU-DOMINIO/viajes/dolomitas-2026/`. Lo abren sin cuenta y descargan los tracks GPX directamente.
- En el viaje, el botón **«Página de clientes ↗»** ya apunta a esa página.

## Importante

- A partir de la importación, trabaja **solo en la versión de tu dominio**. La versión dentro de Claude ya no se sincroniza con ella.
- **Añadir a alguien al equipo:** crea su usuario en Supabase (paso 1.3) y añade su email a `tbx_team` (Table Editor → tbx_team → Insert row).
- **Quitar a alguien:** borra su fila de `tbx_team` y su usuario.
- **Página de clientes para un viaje nuevo:** pídela a Claude y añade la carpeta a `viajes/` del repositorio.
