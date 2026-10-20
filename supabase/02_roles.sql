-- =====================================================================
-- TRAVEL BIKEX CRM · Roles: administrador y guía
-- Pégalo entero en Supabase > SQL Editor > New query y pulsa "Run".
-- Se puede ejecutar más de una vez.
-- =====================================================================

-- 1) Equipo: rol y nombre ------------------------------------------------
alter table public.tbx_team add column if not exists rol text not null default 'guia';
alter table public.tbx_team add column if not exists nombre text not null default '';
alter table public.tbx_team drop constraint if exists tbx_team_rol_check;
alter table public.tbx_team add constraint tbx_team_rol_check check (rol in ('admin','guia'));
update public.tbx_team set email = lower(email);
update public.tbx_team set rol = 'admin' where email = 'asturebikes@gmail.com';

create or replace function public.tbx_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.tbx_rol() returns text
language sql stable security definer set search_path = public as $$
  select rol from public.tbx_team where email = public.tbx_email()
$$;

create or replace function public.tbx_es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.tbx_rol() = 'admin', false)
$$;

create or replace function public.tbx_es_equipo() returns boolean
language sql stable security definer set search_path = public as $$
  select public.tbx_rol() is not null
$$;

-- El guía solo entra en los viajes donde su email está en data.guias
create or replace function public.tbx_guia_en_viaje(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.tbx_rol() = 'guia'
     and split_part(p, '/', 1) = 'viajes'
     and exists (
       select 1 from public.tbx_docs v
       where v.path = 'viajes/' || split_part(p, '/', 2)
         and coalesce(v.data -> 'guias', '[]'::jsonb) ? public.tbx_email()
     )
$$;

-- Qué ve un guía: todo el viaje menos lo que pagan los clientes (finanzas)
-- y los gastos marcados "solo administrador" (resúmenes del balance)
create or replace function public.tbx_guia_puede_ver(p text, d jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select public.tbx_guia_en_viaje(p)
     and split_part(p, '/', 3) <> 'finanzas'
     and not (split_part(p, '/', 3) = 'gastos' and coalesce((d ->> 'soloAdmin')::boolean, false))
$$;

-- Qué cambia un guía: maletas/habitaciones, lista de la compra y tickets de gasto
create or replace function public.tbx_guia_puede_editar(p text, d jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select public.tbx_guia_en_viaje(p)
     and split_part(p, '/', 3) in ('rooming', 'compra', 'gastos')
     and not coalesce((d ->> 'soloAdmin')::boolean, false)
$$;

-- 2) Reglas de la tabla de datos ----------------------------------------
drop policy if exists "tbx_docs_equipo"  on public.tbx_docs;
drop policy if exists "tbx_docs_ver"     on public.tbx_docs;
drop policy if exists "tbx_docs_crear"   on public.tbx_docs;
drop policy if exists "tbx_docs_cambiar" on public.tbx_docs;
drop policy if exists "tbx_docs_borrar"  on public.tbx_docs;
create policy "tbx_docs_ver" on public.tbx_docs for select to authenticated
  using (public.tbx_es_admin() or public.tbx_guia_puede_ver(path, data));
create policy "tbx_docs_crear" on public.tbx_docs for insert to authenticated
  with check (public.tbx_es_admin() or public.tbx_guia_puede_editar(path, data));
create policy "tbx_docs_cambiar" on public.tbx_docs for update to authenticated
  using (public.tbx_es_admin() or public.tbx_guia_puede_editar(path, data))
  with check (public.tbx_es_admin() or public.tbx_guia_puede_editar(path, data));
create policy "tbx_docs_borrar" on public.tbx_docs for delete to authenticated
  using (public.tbx_es_admin() or public.tbx_guia_puede_editar(path, data));

-- 3) Reglas del equipo: cada uno se ve a sí mismo; el administrador gestiona a todos
drop policy if exists "tbx_team_ver_mi_fila" on public.tbx_team;
drop policy if exists "tbx_team_ver"     on public.tbx_team;
drop policy if exists "tbx_team_admin"   on public.tbx_team;
create policy "tbx_team_ver" on public.tbx_team for select to authenticated
  using (email = public.tbx_email() or public.tbx_es_admin());
create policy "tbx_team_admin" on public.tbx_team for all to authenticated
  using (public.tbx_es_admin()) with check (public.tbx_es_admin());

-- 4) Archivos: todo el equipo los ve y sube (tickets); solo el administrador cambia o borra
drop policy if exists "tbx_files_ver"     on storage.objects;
drop policy if exists "tbx_files_subir"   on storage.objects;
drop policy if exists "tbx_files_cambiar" on storage.objects;
drop policy if exists "tbx_files_borrar"  on storage.objects;
create policy "tbx_files_ver" on storage.objects for select to authenticated
  using (bucket_id = 'tbx-files' and public.tbx_es_equipo());
create policy "tbx_files_subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'tbx-files' and public.tbx_es_equipo());
create policy "tbx_files_cambiar" on storage.objects for update to authenticated
  using (bucket_id = 'tbx-files' and public.tbx_es_admin());
create policy "tbx_files_borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'tbx-files' and public.tbx_es_admin());

-- 5) Solo pueden crearse cuenta los emails que el administrador haya añadido al equipo
create or replace function public.tbx_solo_equipo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.tbx_team where email = lower(new.email)) then
    raise exception 'Este email no está autorizado en el CRM de Travel Bikex';
  end if;
  return new;
end $$;
drop trigger if exists tbx_solo_equipo on auth.users;
create trigger tbx_solo_equipo before insert on auth.users
  for each row execute function public.tbx_solo_equipo();

-- 6) Separar lo que paga cada cliente (solo administrador) ---------------
--    Mueve precio, pagos y notas de precio de cada cliente a viajes/<viaje>/finanzas/<cliente>.
insert into public.tbx_docs (path, collection, data)
select replace(c.path, '/clientes/', '/finanzas/'),
       replace(c.collection, '/clientes', '/finanzas'),
       jsonb_strip_nulls(jsonb_build_object(
         'precio',   c.data -> 'precio',
         'pagos',    c.data -> 'pagos',
         'cobrado',  c.data -> 'cobrado',
         'notaPago', c.data -> 'notaPago',
         'notaAdmin', nullif(trim(substr(c.data ->> 'notas', length(split_part(c.data ->> 'notas', ' Precio:', 1)) + 1)), '')
       ))
from public.tbx_docs c
where c.collection like 'viajes/%/clientes'
  and (c.data ? 'precio' or c.data ? 'pagos' or c.data ? 'cobrado' or c.data ? 'notaPago')
on conflict (path) do nothing;

update public.tbx_docs
set data = (data - 'precio' - 'pagos' - 'cobrado' - 'notaPago')
           || jsonb_build_object('notas', trim(split_part(coalesce(data ->> 'notas', ''), ' Precio:', 1)))
where collection like 'viajes/%/clientes'
  and (data ? 'precio' or data ? 'pagos' or data ? 'cobrado' or data ? 'notaPago');

-- Los totales de la hoja «Pre y REAL» son datos del balance: solo administrador
update public.tbx_docs set data = data || '{"soloAdmin": true}'::jsonb
where path like 'viajes/dolomitas-sergio-2026/gastos/real-%';
