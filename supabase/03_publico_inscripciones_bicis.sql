-- =====================================================================
-- TRAVEL BIKEX CRM · Página de clientes, inscripción online y bicis
-- Pégalo entero en Supabase > SQL Editor > New query y pulsa "Run".
-- Se puede ejecutar más de una vez.
-- =====================================================================

-- 1) Bicis de alquiler: los guías también pueden apuntar entregas y devoluciones
create or replace function public.tbx_guia_puede_editar(p text, d jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select public.tbx_guia_en_viaje(p)
     and split_part(p, '/', 3) in ('rooming', 'compra', 'gastos', 'bicis')
     and not coalesce((d ->> 'soloAdmin')::boolean, false)
$$;

-- 2) Página pública de cada viaje (lo que ven los clientes, sin datos personales)
create table if not exists public.tbx_publico (
  slug        text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{2,59}$'),
  viaje       text not null,
  data        jsonb not null default '{}'::jsonb,
  inscripcion boolean not null default false,
  updated_at  timestamptz not null default now()
);
alter table public.tbx_publico enable row level security;
drop policy if exists "tbx_publico_leer"  on public.tbx_publico;
drop policy if exists "tbx_publico_admin" on public.tbx_publico;
create policy "tbx_publico_leer" on public.tbx_publico for select to anon, authenticated using (true);
create policy "tbx_publico_admin" on public.tbx_publico for all to authenticated
  using (public.tbx_es_admin()) with check (public.tbx_es_admin());
grant select on public.tbx_publico to anon;

-- Archivos públicos de esas páginas (tracks y documento de consentimiento en blanco)
insert into storage.buckets (id, name, public, file_size_limit)
values ('tbx-public', 'tbx-public', true, 20971520)
on conflict (id) do update set public = true;
drop policy if exists "tbx_public_ver"     on storage.objects;
drop policy if exists "tbx_public_subir"   on storage.objects;
drop policy if exists "tbx_public_cambiar" on storage.objects;
drop policy if exists "tbx_public_borrar"  on storage.objects;
create policy "tbx_public_ver" on storage.objects for select to authenticated
  using (bucket_id = 'tbx-public' and public.tbx_es_admin());
create policy "tbx_public_subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'tbx-public' and public.tbx_es_admin());
create policy "tbx_public_cambiar" on storage.objects for update to authenticated
  using (bucket_id = 'tbx-public' and public.tbx_es_admin());
create policy "tbx_public_borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'tbx-public' and public.tbx_es_admin());

-- 3) Inscripciones online: cualquiera puede enviar una (solo si la inscripción del viaje está abierta),
--    pero solo el administrador puede leerlas
create or replace function public.tbx_inscripcion_abierta(s text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tbx_publico where slug = s and inscripcion)
$$;
grant execute on function public.tbx_inscripcion_abierta(text) to anon, authenticated;

create table if not exists public.tbx_inscripciones (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null,
  data       jsonb not null,
  estado     text not null default 'nueva' check (estado in ('nueva', 'añadida', 'descartada')),
  created_at timestamptz not null default now()
);
create index if not exists tbx_inscripciones_slug_idx on public.tbx_inscripciones (slug);
alter table public.tbx_inscripciones enable row level security;
drop policy if exists "tbx_insc_enviar" on public.tbx_inscripciones;
drop policy if exists "tbx_insc_admin"  on public.tbx_inscripciones;
create policy "tbx_insc_enviar" on public.tbx_inscripciones for insert to anon, authenticated
  with check (estado = 'nueva' and public.tbx_inscripcion_abierta(slug) and pg_column_size(data) < 300000);
create policy "tbx_insc_admin" on public.tbx_inscripciones for all to authenticated
  using (public.tbx_es_admin()) with check (public.tbx_es_admin());
grant insert on public.tbx_inscripciones to anon;

-- Documentos que adjuntan al inscribirse (DNI, pasaporte): privados, solo los ve el administrador
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tbx-inscripciones', 'tbx-inscripciones', false, 10485760, array['image/jpeg','image/png','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['image/jpeg','image/png','application/pdf'];
drop policy if exists "tbx_inscf_subir" on storage.objects;
drop policy if exists "tbx_inscf_admin" on storage.objects;
drop policy if exists "tbx_inscf_borrar" on storage.objects;
create policy "tbx_inscf_subir" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'tbx-inscripciones' and public.tbx_inscripcion_abierta((storage.foldername(name))[1]));
create policy "tbx_inscf_admin" on storage.objects for select to authenticated
  using (bucket_id = 'tbx-inscripciones' and public.tbx_es_admin());
create policy "tbx_inscf_borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'tbx-inscripciones' and public.tbx_es_admin());
