-- =====================================================================
-- MOZONA TPV — database/74_waiter_pin_hash.sql (v4.6.0)
-- =====================================================================
-- H-07 (auditoría): el PIN de camarero se guardaba en TEXTO PLANO en
-- public.waiters.pin y el cliente lo descargaba entero para compararlo
-- localmente -> cualquiera con la anon key podía leer todos los PINs
-- y entrar como cualquier camarero.
--
-- ESTA MIGRACIÓN:
--   1. Añade waiters.pin_hash (bcrypt vía pgcrypto).
--   2. Migra los PINs planos existentes a bcrypt.
--   3. Anula la columna plana `pin` (NO se borra para no romper
--      inserts legacy; se recomienda DROP en una migración posterior).
--   4. Crea waiter_pin_attempts (anti fuerza bruta por camarero).
--   5. Reescribe verify_waiter_login(username, pin) -> compara HASH.
--   6. Crea verify_waiter_pin_tenant(tenant_id, pin) para login solo-PIN.
--   7. Crea set_waiter_pin(waiter_id, pin) para que el admin fije el PIN
--      hasheado server-side (el cliente NUNCA escribe pin_hash).
--   8. Revoca a anon SELECT sobre waiters.pin / waiters.pin_hash.
--
-- IDEMPOTENTE. Ejecutar en Supabase SQL Editor.
--
-- PRERREQUISITO FRONTEND (ya aplicado en el código de esta entrega):
--   src/lib/waiters.ts NO envía `pin` en claro ni compara PINs en cliente;
--   usa las RPC de este archivo.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 1 + 2) pin_hash + backfill
-- ---------------------------------------------------------------------
alter table public.waiters add column if not exists pin_hash text;

-- Backfill: solo si aún existe la columna plana `pin`.
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'waiters' and column_name = 'pin'
    ) then
        execute $bf$
            update public.waiters
               set pin_hash = extensions.crypt(coalesce(pin, ''), extensions.gen_salt('bf', 12))
             where pin_hash is null
               and pin is not null
               and pin <> ''
        $bf$;
    end if;
end $$;

-- ---------------------------------------------------------------------
-- 3) Anular la columna plana (mantener compat de inserts legacy)
--    Tras esto, `pin` deja de contener el secreto.
-- ---------------------------------------------------------------------
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'waiters' and column_name = 'pin'
    ) then
        execute 'update public.waiters set pin = null where pin is not null';
    end if;
end $$;

-- ---------------------------------------------------------------------
-- 4) Tabla de intentos (anti fuerza bruta) — sin policies: solo RPC
-- ---------------------------------------------------------------------
create table if not exists public.waiter_pin_attempts (
    waiter_id       uuid primary key references public.waiters(id) on delete cascade,
    failed_attempts int  not null default 0,
    locked_until    timestamptz
);
alter table public.waiter_pin_attempts enable row level security;

-- ---------------------------------------------------------------------
-- 5) verify_waiter_login(username, pin) — HASH, rate-limited, sin leak
-- ---------------------------------------------------------------------
drop function if exists public.verify_waiter_login(text, text);
create or replace function public.verify_waiter_login(
    p_username text,
    p_pin      text
)
returns json
language plpgsql
stable
security definer
set search_path = '', public, extensions
as $$
declare
    rec      record;
    v_ok     boolean;
    v_failed int;
    v_locked timestamptz;
begin
    if p_username is null or p_pin is null or length(trim(p_username)) = 0 then
        return json_build_object('ok', false, 'error', 'credenciales inválidas');
    end if;

    select w.id, w.tenant_id, w.role, w.full_name, w.username, w.is_active,
           w.pin_hash, t.subscription_status
      into rec
      from public.waiters w
      left join public.tenants t on t.id = w.tenant_id
     where lower(w.username) = lower(trim(p_username))
     limit 1;

    -- Respuesta genérica: no revelar si el usuario existe.
    if not found then
        return json_build_object('ok', false, 'error', 'credenciales inválidas');
    end if;

    if rec.is_active = false then
        return json_build_object('ok', false, 'error', 'credenciales inválidas');
    end if;

    -- Anti fuerza bruta por camarero.
    select a.failed_attempts, a.locked_until
      into v_failed, v_locked
      from public.waiter_pin_attempts a
     where a.waiter_id = rec.id;

    if v_locked is not null and v_locked > now() then
        return json_build_object('ok', false, 'error', 'cuenta bloqueada temporalmente');
    end if;

    v_ok := (rec.pin_hash is not null)
            and (rec.pin_hash = extensions.crypt(p_pin, rec.pin_hash));

    if not v_ok then
        insert into public.waiter_pin_attempts (waiter_id, failed_attempts)
        values (rec.id, 1)
        on conflict (waiter_id) do update
           set failed_attempts = public.waiter_pin_attempts.failed_attempts + 1,
               locked_until = case
                   when public.waiter_pin_attempts.failed_attempts + 1 >= 5
                   then now() + interval '15 minutes'
                   else public.waiter_pin_attempts.locked_until
               end;
        return json_build_object('ok', false, 'error', 'credenciales inválidas');
    end if;

    delete from public.waiter_pin_attempts where waiter_id = rec.id;

    if rec.subscription_status is not null
       and rec.subscription_status not in ('active', 'trialing', 'lifetime_vip') then
        return json_build_object('ok', false, 'error', 'suscripción del local inactiva');
    end if;

    return json_build_object(
        'ok',        true,
        'tenant_id', rec.tenant_id,
        'user_id',   null,
        'role',      rec.role,
        'name',      coalesce(rec.full_name, rec.username),
        'email',     null
    );
end;
$$;

-- ---------------------------------------------------------------------
-- 6) verify_waiter_pin_tenant(tenant_id, pin) — login solo-PIN (tablet)
-- ---------------------------------------------------------------------
drop function if exists public.verify_waiter_pin_tenant(uuid, text);
create or replace function public.verify_waiter_pin_tenant(
    p_tenant_id uuid,
    p_pin       text
)
returns json
language plpgsql
stable
security definer
set search_path = '', public, extensions
as $$
declare
    rec record;
begin
    if p_tenant_id is null or p_pin is null or length(trim(p_pin)) = 0 then
        return json_build_object('ok', false, 'error', 'credenciales inválidas');
    end if;

    for rec in
        select w.id, w.tenant_id, w.role, w.full_name, w.username, w.pin_hash
          from public.waiters w
         where w.tenant_id = p_tenant_id
           and w.is_active is distinct from false
           and w.pin_hash is not null
    loop
        if rec.pin_hash = extensions.crypt(p_pin, rec.pin_hash) then
            return json_build_object(
                'ok',        true,
                'id',        rec.id,
                'tenant_id', rec.tenant_id,
                'role',      rec.role,
                'name',      coalesce(rec.full_name, rec.username)
            );
        end if;
    end loop;

    return json_build_object('ok', false, 'error', 'credenciales inválidas');
end;
$$;

-- ---------------------------------------------------------------------
-- 7) set_waiter_pin(waiter_id, pin) — el admin fija el PIN (hash server)
--    Solo un miembro autenticado del tenant (o superadmin) puede.
-- ---------------------------------------------------------------------
drop function if exists public.set_waiter_pin(uuid, text);
create or replace function public.set_waiter_pin(
    p_waiter_id uuid,
    p_pin       text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = '', public, extensions
as $$
declare
    v_tenant uuid;
begin
    if p_pin is null or p_pin !~ '^[0-9A-Za-z]{4,6}$' then
        raise exception 'PIN inválido';
    end if;

    select w.tenant_id into v_tenant from public.waiters w where w.id = p_waiter_id;
    if v_tenant is null then
        raise exception 'Camarero no encontrado';
    end if;

    if not (public.is_superadmin() or public.is_tenant_owner(v_tenant) or public.is_tenant_member(v_tenant)) then
        raise exception 'No autorizado';
    end if;

    update public.waiters
       set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 12)),
           updated_at = now()
     where id = p_waiter_id;

    delete from public.waiter_pin_attempts where waiter_id = p_waiter_id;
    return true;
end;
$$;

-- ---------------------------------------------------------------------
-- 8) Permisos
-- ---------------------------------------------------------------------
-- Login de camareros: anon (tablet sin cuenta) puede, pero rate-limited.
grant execute on function public.verify_waiter_login(text, text)      to anon, authenticated;
grant execute on function public.verify_waiter_pin_tenant(uuid, text) to anon, authenticated;
-- Fijar PIN: solo autenticado (verificado dentro por tenant).
revoke all on function public.set_waiter_pin(uuid, text) from public, anon;
grant execute on function public.set_waiter_pin(uuid, text) to authenticated;

-- Ocultar el hash (y el pin plano residual) a anon/authenticated:
-- PostgREST usa privilegios de columna, por lo que esto lo excluye del
-- SELECT por REST aunque pidan select=*.
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema='public' and table_name='waiters' and column_name='pin_hash'
    ) then
        execute 'revoke select (pin_hash) on public.waiters from anon, authenticated';
    end if;
    if exists (
        select 1 from information_schema.columns
        where table_schema='public' and table_name='waiters' and column_name='pin'
    ) then
        execute 'revoke select (pin) on public.waiters from anon, authenticated';
    end if;
end $$;

notify pgrst, 'reload schema';

do $$
begin
  raise notice '74_waiter_pin_hash aplicado: PINs hasheados (bcrypt), verify_waiter_login/verify_waiter_pin_tenant/set_waiter_pin, pin_hash oculto a anon.';
end $$;

-- =====================================================================
-- 9) AUTOSUFICIENCIA: get_my_tenant() + verify_waiter_pin(uuid,text)
-- =====================================================================
-- La migración 73 también define verify_waiter_pin (contexto AUTHENTICATED,
-- usado por WaiterSessionContext al desbloquear una terminal). Para que ESTA
-- migración sea autosuficiente e idempotente se redefine aquí con resolución
-- de tenant inline (sin depender de get_my_tenant de 73). Ejecutar 74 después
-- de 73 es lo recomendado, pero 74 funciona igual sola.

create or replace function public.get_my_tenant()
returns uuid
language sql
stable
security definer
set search_path = '', extensions, public
as $$
  select tu.tenant_id
    from public.tenant_users tu
   where tu.user_id = (select auth.uid())
   order by tu.created_at desc nulls last
   limit 1
$$;
revoke all on function public.get_my_tenant() from public, anon;
grant execute on function public.get_my_tenant() to authenticated;

-- verify_waiter_pin(waiter_id, pin) — contexto AUTHENTICATED (terminal
-- bloqueada que se desbloquea con el PIN de un camarero del propio tenant).
drop function if exists public.verify_waiter_pin(uuid, text);
create or replace function public.verify_waiter_pin(
    p_waiter_id uuid,
    p_pin       text
)
returns json
language plpgsql
stable
security definer
set search_path = '', public, extensions
as $$
declare
    v_tenant   uuid := public.get_my_tenant();
    v_ok       boolean;
    v_attempts int;
    v_locked   timestamptz;
begin
    if v_tenant is null then
        return json_build_object('ok', false, 'error', 'no_session');
    end if;
    if p_pin is null or length(trim(p_pin)) = 0 then
        return json_build_object('ok', false, 'error', 'bad_pin');
    end if;

    select a.failed_attempts, a.locked_until
      into v_attempts, v_locked
      from public.waiter_pin_attempts a
     where a.waiter_id = p_waiter_id;

    if v_locked is not null and v_locked > now() then
        return json_build_object('ok', false, 'error', 'locked', 'until', v_locked);
    end if;

    select exists (
        select 1
          from public.waiters w
         where w.id = p_waiter_id
           and w.tenant_id = v_tenant
           and w.pin_hash is not null
           and w.pin_hash = extensions.crypt(p_pin, w.pin_hash)
    ) into v_ok;

    if v_ok then
        delete from public.waiter_pin_attempts where waiter_id = p_waiter_id;
        return json_build_object('ok', true);
    end if;

    insert into public.waiter_pin_attempts (waiter_id, failed_attempts)
    values (p_waiter_id, 1)
    on conflict (waiter_id) do update
       set failed_attempts = public.waiter_pin_attempts.failed_attempts + 1,
           locked_until = case
               when public.waiter_pin_attempts.failed_attempts + 1 >= 5
               then now() + interval '15 minutes'
               else public.waiter_pin_attempts.locked_until
           end;

    return json_build_object('ok', false, 'error', 'bad_pin');
end;
$$;

revoke all on function public.verify_waiter_pin(uuid, text) from public, anon;
grant execute on function public.verify_waiter_pin(uuid, text) to authenticated;

notify pgrst, 'reload schema';
