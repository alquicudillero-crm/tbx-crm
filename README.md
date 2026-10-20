# TRAVEL BIKEX · CRM y páginas de viaje

Web publicada con GitHub Pages en **https://travelbikex.es**

- `crm/` — CRM de gestión para el equipo (acceso con usuario de Supabase).
  - `config.js` — URL y clave publishable del proyecto de Supabase.
  - `tbx-supabase.js` — conexión del CRM con Supabase (datos, archivos y login).
- `viaje/?<dirección>` — página pública de un viaje, generada desde el CRM («Publicar página»). Lee la tabla `tbx_publico`.
- `inscripcion/?<dirección>` — formulario de inscripción online con firma. Guarda en `tbx_inscripciones` (solo lo lee el administrador).
- `viajes/<viaje>/` — páginas estáticas antiguas (Dolomitas 2026).
- `supabase/` — SQL que se ejecuta una vez en Supabase (02 roles, 03 página pública, inscripciones y bicis).
- `INSTALAR.md` — guía de instalación.

Los datos (viajes, clientes, pagos, pasaportes…) **no están en este repositorio**: se guardan en Supabase.
