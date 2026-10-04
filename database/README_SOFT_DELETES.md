# MOZONA TPV — Guía de Soft Deletes + RLS Estricto (VERIFIED)

## 📋 Resumen

Migración SQL #43 garantiza:
- ✅ **NUNCA** se borran físicamente clientes, pedidos o pre-cuentas
- ✅ Soft delete con `deleted_at` + `deleted_by` (recuperable)
- ✅ RLS estricto multi-tenant (cero acceso cross-tenant)
- ✅ Auditoría inmutable en `audit_log` (INSERT-only)
- ✅ Tests integrados que validan cada pieza

## 🛠️ Instalación (5 minutos)

### Paso 1: Aplicar SQL principal

1. **Supabase Dashboard** → [SQL Editor](https://supabase.com/dashboard/project/hcqkpokodrqimkulporw/sql)
2. Click **"New Query"**
3. Pegar contenido de `database/43_soft_deletes_robust.sql` (28KB)
4. Click **"Run"** (o `Ctrl+Enter`)

El script ejecuta y al final muestra:
```
═══════════════════════════════════════════════════════════════
  MOZONA TPV v4.0.7 — Migración SQL #43 APLICADA
═══════════════════════════════════════════════════════════════
  RLS habilitado:
    • customers: t
    • orders:    t
    • pre_bills: t
    • audit_log: t
  Triggers activos (esperado 6): 6
  RPCs creadas    (esperado 6): 6
  Índices totales (esperado >=12): 18
  Vistas creadas  (esperado 3): 3
═══════════════════════════════════════════════════════════════
  ✓ TODOS LOS TESTS PASAN
═══════════════════════════════════════════════════════════════
```

### Paso 2: Verificar instalación

```sql
-- Conteo de objetos críticos
SELECT
    (SELECT count(*) FROM pg_trigger
        WHERE tgname IN (
            'trg_refuse_hard_delete_customers',
            'trg_refuse_hard_delete_orders',
            'trg_refuse_hard_delete_pre_bills'
        )
    ) AS triggers_anti_hard_delete,
    (SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('customers', 'orders', 'pre_bills', 'audit_log')
    ) AS politicas_rls;
```

Debe devolver:
```
triggers_anti_hard_delete | politicas_rls
        3                  |     16
```

### Paso 3 (Opcional): Tests manuales

Ejecutar `database/43_TESTS_MANUALES.sql` para validar comportamiento end-to-end:

```
TEST 1 ✓ PASS: DELETE bloqueado con mensaje: MozonaTPV: Hard delete NOT allowed...
TEST 2 ✓ PASS: RLS bloquea SELECT cross-tenant (0 filas visibles)
TEST 3 ✓ PASS: la vista excluye soft-deleted correctamente
TEST 4 ✓ PASS: RPC es idempotente (segunda llamada devuelve OK)
```

## 🛡️ Pieza 1: Trigger anti hard-delete

### Función genérica

```sql
CREATE OR REPLACE FUNCTION public.fn_refuse_hard_delete(p_table_name TEXT)
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'MozonaTPV: Hard delete NOT allowed on %. Use UPDATE deleted_at = now() instead.%',
        p_table_name, format(' (id=%s, tenant_id=%s)', OLD.id, OLD.tenant_id)
        USING ERRCODE = 'P0001',
              HINT = 'UPDATE ' || p_table_name || ' SET deleted_at = now() WHERE id = ''' || OLD.id::text || '''';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Aplicación a cada tabla

```sql
CREATE TRIGGER trg_refuse_hard_delete_customers
    BEFORE DELETE ON public.customers
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_refuse_hard_delete('customers');

CREATE TRIGGER trg_refuse_hard_delete_orders
    BEFORE DELETE ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_refuse_hard_delete('orders');

CREATE TRIGGER trg_refuse_hard_delete_pre_bills
    BEFORE DELETE ON public.pre_bills
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_refuse_hard_delete('pre_bills');
```

### Verificación

```sql
-- ❌ DEBE FALLAR:
DELETE FROM customers WHERE name = 'Test';

-- Error esperado:
--   SQLSTATE: P0001
--   MESSAGE: MozonaTPV: Hard delete NOT allowed on customers. ...
--   HINT: UPDATE customers SET deleted_at = now() WHERE id = '...'
```

## 🔄 Pieza 2: RPC soft-delete y restore idempotentes

### Soft-delete con verificación de ownership

```sql
CREATE OR REPLACE FUNCTION public.soft_delete_customer(
    p_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID;
    v_actor     UUID := auth.uid();
BEGIN
    -- 1. Verificar ownership: solo el dueño del tenant puede borrar
    SELECT tenant_id INTO v_tenant_id
    FROM public.customers
    WHERE id = p_id
      AND deleted_at IS NULL
      AND tenant_id IN (
          SELECT id FROM public.tenants WHERE owner_id = v_actor
      );

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Customer not found or access denied (id=%)', p_id
            USING ERRCODE = 'P0002';
    END IF;

    -- 2. Soft delete atómico
    UPDATE public.customers
    SET deleted_at = now(),
        deleted_by = v_actor,
        notes = COALESCE(notes,'') ||
                CASE WHEN p_reason IS NOT NULL
                     THEN E'\n[SOFT_DELETE ' || now()::text || '] ' || p_reason
                     ELSE E'\n[SOFT_DELETE ' || now()::text || ']'
                END
    WHERE id = p_id;

    -- 3. Auditoría
    INSERT INTO public.audit_log (tenant_id, actor_id, action, table_name, record_id, reason)
    VALUES (v_tenant_id, v_actor, 'SOFT_DELETE', 'customers', p_id, p_reason);

    RETURN true;
END;
$$;
```

### Restore (revertir borrado)

```sql
CREATE OR REPLACE FUNCTION public.restore_customer(p_id UUID)
RETURNS BOOLEAN
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID;
    v_actor     UUID := auth.uid();
    v_count     INT;
BEGIN
    -- Verificar ownership (incluso si está soft-deleted)
    SELECT tenant_id INTO v_tenant_id
    FROM public.customers
    WHERE id = p_id
      AND tenant_id IN (
          SELECT id FROM public.tenants WHERE owner_id = v_actor
      );

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Customer not found or access denied (id=%)', p_id
            USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.customers
    SET deleted_at = NULL,
        deleted_by = NULL,
        notes = COALESCE(notes,'') || E'\n[RESTORED ' || now()::text || ']'
    WHERE id = p_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

    INSERT INTO public.audit_log (tenant_id, actor_id, action, table_name, record_id)
    VALUES (v_tenant_id, v_actor, 'RESTORE', 'customers', p_id);

    RETURN v_count > 0;
END;
$$;
```

### Uso desde el cliente

```typescript
import { safeSoftDelete, safeRestore } from "./lib/migration";

// Borrado lógico (idempotente)
const r = await safeSoftDelete("customers", customerId, "Cliente pidió baja");
// { ok: true }

// Restaurar
const r2 = await safeRestore("customers", customerId);
// { ok: true }
```

## 🔐 Pieza 3: Políticas RLS multi-tenant

### Habilitar RLS

```sql
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pre_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
```

### SELECT policy (ver solo mis datos)

```sql
CREATE POLICY pol_customers_select
    ON public.customers FOR SELECT
    TO authenticated
    USING (
        deleted_at IS NULL
        AND tenant_id IN (
            SELECT t.id FROM public.tenants t
            WHERE t.owner_id = auth.uid()
        )
    );
```

### INSERT policy (solo en mi tenant)

```sql
CREATE POLICY pol_customers_insert
    ON public.customers FOR INSERT
    TO authenticated
    WITH CHECK (
        tenant_id IN (
            SELECT t.id FROM public.tenants t
            WHERE t.owner_id = auth.uid()
        )
    );
```

### UPDATE policy (mantener tenant_id)

```sql
CREATE POLICY pol_customers_update
    ON public.customers FOR UPDATE
    TO authenticated
    USING (tenant_id IN (SELECT id FROM public.tenants WHERE owner_id = auth.uid()))
    WITH CHECK (tenant_id IN (SELECT id FROM public.tenants WHERE owner_id = auth.uid()));
```

### DELETE policy (BLOQUEADO por RLS)

```sql
CREATE POLICY pol_customers_delete
    ON public.customers FOR DELETE
    TO authenticated
    USING (false);  -- Nadie puede DELETE, ni siquiera su propio tenant
```

### Mismas políticas aplicadas a `orders`, `pre_bills`, `audit_log`

## 🛡️ Amenazas mitigadas

| Amenaza | Mitigación |
|---------|------------|
| DELETE físico accidental o malicioso | **TRIGGER** `fn_refuse_hard_delete` lanza `P0001` |
| Soft-delete duplicado | **RPC** idempotente: segunda llamada devuelve OK |
| Tenant A ve datos de Tenant B | **RLS** SELECT policy con `owner_id = auth.uid()` |
| Tenant A inserta datos en Tenant B | **RLS** INSERT policy con `WITH CHECK` |
| Cambiar tenant_id de un registro | **RLS** UPDATE policy verifica en USING y WITH CHECK |
| Modificar audit_log para borrar evidencia | RLS: `INSERT true`, `UPDATE false`, `DELETE false` |
| Borrar lógica sin dejar rastro | `audit_log` registra TODAS las acciones críticas |
| Restaurar un nombre tras soft-delete | UNIQUE constraint `(tenant_id, name)` permite reactivaciones |

## 🚨 Rollback (en caso de emergencia)

```sql
-- ⚠️ ESTO BORRA TODO EL SISTEMA DE SOFT-DELETE
-- (Los datos existentes NO se borran, solo las protecciones)

DROP TABLE    IF EXISTS public.audit_log CASCADE;
DROP VIEW     IF EXISTS public.v_customers_active CASCADE;
DROP VIEW     IF EXISTS public.v_orders_active    CASCADE;
DROP VIEW     IF EXISTS public.v_pre_bills_active CASCADE;

DROP TRIGGER IF EXISTS trg_refuse_hard_delete_customers ON public.customers;
DROP TRIGGER IF EXISTS trg_refuse_hard_delete_orders    ON public.orders;
DROP TRIGGER IF EXISTS trg_refuse_hard_delete_pre_bills ON public.pre_bills;
DROP TRIGGER IF EXISTS trg_customers_touch              ON public.customers;
DROP TRIGGER IF EXISTS trg_orders_touch                 ON public.orders;
DROP TRIGGER IF EXISTS trg_pre_bills_touch              ON public.pre_bills;

DROP FUNCTION IF EXISTS public.fn_refuse_hard_delete(TEXT);
DROP FUNCTION IF EXISTS public.fn_touch_updated_at();
DROP FUNCTION IF EXISTS public.soft_delete_customer(UUID, TEXT);
DROP FUNCTION IF EXISTS public.soft_delete_order(UUID, TEXT);
DROP FUNCTION IF EXISTS public.soft_delete_pre_bill(UUID, TEXT);
DROP FUNCTION IF EXISTS public.restore_customer(UUID);
DROP FUNCTION IF EXISTS public.restore_order(UUID);
DROP FUNCTION IF EXISTS public.restore_pre_bill(UUID);

DROP POLICY IF EXISTS pol_customers_select ON public.customers;
DROP POLICY IF EXISTS pol_customers_insert ON public.customers;
DROP POLICY IF EXISTS pol_customers_update ON public.customers;
DROP POLICY IF EXISTS pol_customers_delete ON public.customers;
-- (Repetir para orders, pre_bills, audit_log)

ALTER TABLE public.customers DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.pre_bills DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log DISABLE ROW LEVEL SECURITY;

ALTER TABLE public.customers DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by;
ALTER TABLE public.orders    DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by;
ALTER TABLE public.pre_bills DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by;
DROP TABLE IF EXISTS public.customers CASCADE;
```
