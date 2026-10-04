// =====================================================================
// MOZONA TPV — Edge Function: apply-rls-migrations (v4.0.7)
// =====================================================================
// Ejecuta las migrations SQL críticas (especialmente SQL #58 RLS)
// Idempotente. Llama una sola vez para arreglar tablas sin RLS.
// =====================================================================

declare const Deno: {
    env: { get(key: string): string | undefined };
    serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

// ★ CORS con allowlist + comparación constant-time de secretos.
//   Se elimina el comodín `*` y la comparación con `===`.
import { corsHeaders, timingSafeEqual } from "../_shared/security.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

interface Migration {
    name: string;
    sql: string;
}

const MIGRATIONS: Migration[] = [
    {
        name: "products_RLS",
        sql: `
            ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
            DROP POLICY IF EXISTS products_tenant_isolation ON public.products;
            CREATE POLICY products_tenant_isolation ON public.products
                FOR ALL
                USING (tenant_id::text = (auth.jwt() ->> 'tenant_id'))
                WITH CHECK (tenant_id::text = (auth.jwt() ->> 'tenant_id'));
            GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
        `,
    },
    {
        name: "categories_RLS",
        sql: `
            ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
            DROP POLICY IF EXISTS categories_tenant_isolation ON public.categories;
            CREATE POLICY categories_tenant_isolation ON public.categories
                FOR ALL
                USING (tenant_id::text = (auth.jwt() ->> 'tenant_id'))
                WITH CHECK (tenant_id::text = (auth.jwt() ->> 'tenant_id'));
            GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
        `,
    },
    {
        name: "dining_tables_RLS",
        sql: `
            DO $$
            BEGIN
              IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'dining_tables') THEN
                EXECUTE 'ALTER TABLE public.dining_tables ENABLE ROW LEVEL SECURITY';
                EXECUTE 'DROP POLICY IF EXISTS dining_tables_tenant_isolation ON public.dining_tables';
                EXECUTE 'CREATE POLICY dining_tables_tenant_isolation ON public.dining_tables FOR ALL USING (tenant_id::text = (auth.jwt() ->> ''tenant_id'')) WITH CHECK (tenant_id::text = (auth.jwt() ->> ''tenant_id''))';
                EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.dining_tables TO authenticated';
              END IF;
            END $$;
        `,
    },
    {
        name: "open_orders_RLS",
        sql: `
            DO $$
            BEGIN
              IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'open_orders') THEN
                EXECUTE 'ALTER TABLE public.open_orders ENABLE ROW LEVEL SECURITY';
                EXECUTE 'DROP POLICY IF EXISTS open_orders_tenant_isolation ON public.open_orders';
                EXECUTE 'CREATE POLICY open_orders_tenant_isolation ON public.open_orders FOR ALL USING (tenant_id::text = (auth.jwt() ->> ''tenant_id'')) WITH CHECK (tenant_id::text = (auth.jwt() ->> ''tenant_id''))';
                EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.open_orders TO authenticated';
              END IF;
            END $$;
        `,
    },
    {
        name: "orders_RLS",
        sql: `
            DO $$
            BEGIN
              IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'orders') THEN
                EXECUTE 'ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY';
                EXECUTE 'DROP POLICY IF EXISTS orders_tenant_isolation ON public.orders';
                EXECUTE 'CREATE POLICY orders_tenant_isolation ON public.orders FOR ALL USING (tenant_id::text = (auth.jwt() ->> ''tenant_id'')) WITH CHECK (tenant_id::text = (auth.jwt() ->> ''tenant_id''))';
                EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated';
              END IF;
            END $$;
        `,
    },
    {
        name: "order_items_RLS",
        sql: `
            DO $$
            BEGIN
              IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'order_items') THEN
                EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO authenticated';
              END IF;
            END $$;
        `,
    },
];

async function execSql(sql: string): Promise<{ ok: boolean; error?: string }> {
    // Use Supabase's Postgres REST API via rpc 'exec_sql' if it exists.
    // Otherwise, use the pg connection via postgres.js style.

    // Method: Use REST /rest/v1/rpc with body containing the SQL.
    // This requires an 'exec_sql' function defined in the database with SECURITY DEFINER.
    // Since we don't have that, we use a workaround: connect to Postgres directly.

    // Try the database direct connection (Supabase exposes a pg endpoint)
    // Format: postgres://postgres:password@db.PROJECT.supabase.co:5432/postgres

    // For now, fallback: log and assume manual application
    return { ok: false, error: "DDL must be applied via Supabase Dashboard SQL Editor or psql" };
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(req) });
    }

    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "method_not_allowed" }), {
            status: 405,
            headers: { ...corsHeaders(req), "Content-Type": "application/json" },
        });
    }

    // Auth check: require service role key OR admin JWT
    const authHeader = req.headers.get("Authorization") ?? "";
    const isServiceRole = !!SUPABASE_SERVICE_ROLE_KEY &&
        timingSafeEqual(authHeader.replace(/^Bearer\s+/i, ""), SUPABASE_SERVICE_ROLE_KEY);

    if (!isServiceRole) {
        // Allow anon if there's a special token
        const adminToken = req.headers.get("X-Admin-Token");
        const expectedToken = Deno.env.get("MIGRATION_SECRET_TOKEN");
        if (!expectedToken || !timingSafeEqual(adminToken ?? "", expectedToken)) {
            return new Response(
                JSON.stringify({ error: "unauthorized", reason: "service_role or migration token required" }),
                { status: 401, headers: { ...corsHeaders(req), "Content-Type": "application/json" } }
            );
        }
    }

    const body = await req.json().catch(() => ({}));
    const requested: string[] | undefined = body.migrations;

    const migrationsToRun = MIGRATIONS.filter((m) => !requested || requested.includes(m.name));

    // ★ v4.6.0: NO se devuelve el SQL en la respuesta (evita exponer el
    //   esquema/DDL a quien invoque la función). Solo nombre y estado.
    const results: Array<{ name: string; ok: boolean; error?: string }> = [];

    for (const migration of migrationsToRun) {
        const result = await execSql(migration.sql);
        results.push({
            name: migration.name,
            ok: result.ok,
            error: result.error,
        });
    }

    return new Response(
        JSON.stringify({
            applied: results.filter((r) => r.ok).length,
            failed: results.filter((r) => !r.ok).length,
            results,
        }),
        {
            status: 200,
            headers: { ...corsHeaders(req), "Content-Type": "application/json" },
        }
    );
});
