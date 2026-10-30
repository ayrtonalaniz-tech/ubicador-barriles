-- Ubicador de Barriles — base de datos
-- Pegar completo en Supabase → SQL Editor → New query → Run.

-- 1) Tablas ---------------------------------------------------------------
create table if not exists public.barriles (
  codigo      text primary key check (codigo ~ '^[A-Z0-9-]+$'),
  litros      integer,
  cerveza     text not null default '',
  cerveceria  text not null default 'FÁBRICA',
  estado      text not null default 'fabrica'
              check (estado in ('servicio','retirar','fabrica','limpieza')),
  nota        text not null default '',
  actualizado timestamptz not null default now()
);

create table if not exists public.movimientos (
  id          bigint generated always as identity primary key,
  codigo      text not null references public.barriles(codigo) on delete cascade on update cascade,
  fecha       timestamptz not null default now(),
  cerveceria  text not null default '',
  cerveza     text not null default '',
  estado      text not null,
  nota        text not null default '',
  usuario     text default (auth.jwt() ->> 'email')
);
create index if not exists movimientos_codigo_fecha on public.movimientos (codigo, fecha desc);

-- 2) Mayúsculas siempre (aunque alguien cargue desde otro lado) -----------
create or replace function public.normalizar_barril() returns trigger
language plpgsql as $$
begin
  new.cerveceria := upper(regexp_replace(trim(coalesce(new.cerveceria,'')), '\s+', ' ', 'g'));
  new.cerveza    := upper(regexp_replace(trim(coalesce(new.cerveza,'')),    '\s+', ' ', 'g'));
  return new;
end $$;

drop trigger if exists normalizar on public.barriles;
create trigger normalizar before insert or update on public.barriles
  for each row execute function public.normalizar_barril();
drop trigger if exists normalizar on public.movimientos;
create trigger normalizar before insert or update on public.movimientos
  for each row execute function public.normalizar_barril();

-- 3) Permisos: cualquiera consulta (el QR), solo usuarios ingresados cargan
grant usage on schema public to anon, authenticated;
grant select on public.barriles, public.movimientos to anon, authenticated;
grant insert, update, delete on public.barriles to authenticated;
grant insert on public.movimientos to authenticated;
grant usage on all sequences in schema public to authenticated;

alter table public.barriles    enable row level security;
alter table public.movimientos enable row level security;

drop policy if exists "ver barriles" on public.barriles;
create policy "ver barriles" on public.barriles for select to anon, authenticated using (true);
drop policy if exists "cargar barriles" on public.barriles;
create policy "cargar barriles" on public.barriles for all to authenticated using (true) with check (true);

drop policy if exists "ver movimientos" on public.movimientos;
create policy "ver movimientos" on public.movimientos for select to anon, authenticated using (true);
drop policy if exists "cargar movimientos" on public.movimientos;
create policy "cargar movimientos" on public.movimientos for insert to authenticated with check (true);

-- 4) Actualización en vivo en todas las pantallas abiertas -----------------
do $$ begin
  alter publication supabase_realtime add table public.barriles;
exception when duplicate_object then null; end $$;

-- 5) Barriles que ya estaban cargados -------------------------------------
insert into public.barriles (codigo, litros, cerveza, cerveceria, estado) values
  ('50-001', 50, 'IPA',    'TERRAZA', 'servicio'),
  ('50-002', 50, 'GOLDEN', 'TERRAZA', 'servicio')
on conflict (codigo) do nothing;

insert into public.movimientos (codigo, fecha, cerveceria, cerveza, estado, nota, usuario)
select v.* from (values
  ('50-001', timestamptz '2026-10-30 13:16-03', 'TERRAZA','IPA','servicio','Alta del barril', null::text),
  ('50-002', timestamptz '2026-10-30 13:17-03', 'TERRAZA','GOLDEN','fabrica','Alta del barril', null::text),
  ('50-002', timestamptz '2026-10-30 13:18-03', 'TERRAZA','GOLDEN','servicio','', null::text)
) as v(codigo, fecha, cerveceria, cerveza, estado, nota, usuario)
where not exists (select 1 from public.movimientos);
