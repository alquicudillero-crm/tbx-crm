# TRAVEL BIKEX · CRM y páginas de viaje

Web publicada con GitHub Pages en **https://travelbikex.es**

- `crm/` — CRM de gestión para el equipo (acceso con usuario de Supabase).
  - `config.js` — URL y clave publishable del proyecto de Supabase.
  - `tbx-supabase.js` — conexión del CRM con Supabase (datos, archivos y login).
- `viajes/<viaje>/` — páginas públicas para los clientes de cada viaje.
- `INSTALAR.md` — guía de instalación.

Los datos (viajes, clientes, pagos, pasaportes…) **no están en este repositorio**: se guardan en Supabase.
