-- =====================================================================
-- MOZONA TPV — SQL #47 — Documentación para añadir chat_query a admin-ops
-- =====================================================================
-- Esta SQL NO se ejecuta automáticamente. Es solo DOCUMENTACIÓN.
-- El código de la Edge Function se actualiza en Supabase Dashboard:
-- https://supabase.com/dashboard/project/hcqkpokodrqimkulporw/functions/admin-ops
--
-- INSTRUCCIONES:
-- 1. Ve a la Edge Function admin-ops en Supabase Dashboard
-- 2. Click en "Edit" (esquina superior)
-- 3. ANTES del "default:" final, añade el nuevo case
-- 4. Click "Deploy"
-- =====================================================================

/*
AÑADIR ESTE CASO en el switch de la Edge Function admin-ops:

    case 'chat_query': {
      // Validar tenant_id del payload vs tenant_id del usuario autenticado
      const requestedTenantId = payload.tenant_id;
      if (!requestedTenantId) {
        result = { ok: false, error: 'tenant_id is required' };
        break;
      }

      // Verificar que el usuario autenticado tiene acceso a este tenant
      const { data: tenantAccess, error: tenantErr } = await supabaseAdmin
        .from('tenants')
        .select('id, owner_id, is_vip_flag')
        .eq('id', requestedTenantId)
        .eq('owner_id', user.id)
        .maybeSingle();

      // Si no es owner directo, verificar si es VIP (bypass)
      let allowed = !!tenantAccess;
      if (!allowed && user.email) {
        const { data: vipEmails } = await supabaseAdmin
          .from('app_settings')
          .select('value')
          .eq('key', 'vip_emails')
          .maybeSingle();
        if (vipEmails && user.email) {
          const vipList = String(vipEmails.value).split(',').map(e => e.trim().toLowerCase());
          allowed = vipList.includes(user.email.toLowerCase());
        }
      }

      if (!allowed) {
        result = { ok: false, error: 'Access denied: tenant_id does not belong to user' };
        break;
      }

      const intent = payload.intent;
      const params = payload.params || {};

      // Ejecutar query según intent
      if (intent === 'query_sales') {
        const period = params.period || 'today';
        let date_from = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
        let date_label = 'hoy';
        if (period === 'yesterday') {
          date_from = new Date(Date.now() - 86400000).toISOString();
          date_label = 'ayer';
        } else if (period === 'week') {
          date_from = new Date(Date.now() - 7 * 86400000).toISOString();
          date_label = 'esta semana';
        } else if (period === 'month') {
          date_from = new Date(Date.now() - 30 * 86400000).toISOString();
          date_label = 'este mes';
        }

        const { data: orders, error: ordErr } = await supabaseAdmin
          .from('orders')
          .select('id, total, created_at')
          .eq('tenant_id', requestedTenantId)
          .is('deleted_at', null)
          .gte('created_at', date_from)
          .limit(1000);

        if (ordErr) throw ordErr;

        const arr = orders || [];
        const total = arr.reduce((s, o) => s + Number(o.total || 0), 0);
        const count = arr.length;
        const avg = count > 0 ? total / count : 0;

        result = {
          ok: true,
          intent: 'query_sales',
          response: count > 0
            ? `📊 Ventas de ${date_label}: ${count} tickets, ${total.toFixed(2)}€ en total, promedio ${avg.toFixed(2)}€ por ticket.`
            : `📊 ${date_label.charAt(0).toUpperCase() + date_label.slice(1)} aún no hay ventas registradas.`,
          data: {
            total_ventas: total.toFixed(2),
            num_tickets: count,
            promedio_por_ticket: avg.toFixed(2),
            periodo: date_label,
          },
        };
      }
      else if (intent === 'query_top_products') {
        const { data: ordersData, error: oErr } = await supabaseAdmin
          .from('orders')
          .select('id')
          .eq('tenant_id', requestedTenantId)
          .is('deleted_at', null)
          .limit(5000);

        if (oErr) throw oErr;

        const orderIds = (ordersData || []).map(o => o.id);
        if (orderIds.length === 0) {
          result = {
            ok: true,
            intent: 'query_top_products',
            response: '📊 Aún no hay ventas registradas en tu local.',
            data: { top: [] },
          };
          break;
        }

        const { data: itemsData, error: iErr } = await supabaseAdmin
          .from('order_items')
          .select('name, quantity, price')
          .in('order_id', orderIds.slice(0, 100))
          .limit(5000);

        if (iErr) throw iErr;

        const counts = {};
        for (const it of itemsData || []) {
          const name = it.name || 'Sin nombre';
          if (!counts[name]) counts[name] = { qty: 0, revenue: 0 };
          counts[name].qty += Number(it.quantity || 0);
          counts[name].revenue += Number(it.price || 0) * Number(it.quantity || 0);
        }

        const top = Object.entries(counts)
          .sort((a, b) => b[1].qty - a[1].qty)
          .slice(0, 5)
          .map(([name, info]) => ({
            name,
            qty: info.qty,
            revenue: info.revenue.toFixed(2),
          }));

        result = {
          ok: true,
          intent: 'query_top_products',
          response: top.length > 0
            ? `🏆 Tus productos más vendidos: ${top.map((t, i) => `${i + 1}. ${t.name} (${t.qty} uds, ${t.revenue}€)`).join(' | ')}.`
            : '📊 Aún no hay datos de ventas para mostrar.',
          data: { top },
        };
      }
      else if (intent === 'query_low_stock') {
        const { data: products, error: pErr } = await supabaseAdmin
          .from('products')
          .select('id, name, is_active, is_available')
          .eq('tenant_id', requestedTenantId)
          .or('is_active.eq.false,is_available.eq.false')
          .limit(20);

        if (pErr) throw pErr;

        const arr = products || [];
        if (arr.length === 0) {
          const { count } = await supabaseAdmin
            .from('products')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', requestedTenantId);
          result = {
            ok: true,
            intent: 'query_low_stock',
            response: `✅ Tienes ${count ?? 0} producto(s) en tu carta y todos están disponibles.`,
            data: { total_products: count, low_stock: [] },
          };
          break;
        }

        result = {
          ok: true,
          intent: 'query_low_stock',
          response: `📦 Tienes ${arr.length} producto(s) no disponible(s): ${arr.slice(0, 5).map(p => p.name).join(', ')}.`,
          data: { low_stock: arr },
        };
      }
      else if (intent === 'query_tables') {
        const { data: ordersData, error: tErr } = await supabaseAdmin
          .from('orders')
          .select('table_id, status')
          .eq('tenant_id', requestedTenantId)
          .is('deleted_at', null)
          .in('status', ['draft', 'open', 'sent']);

        if (tErr) throw tErr;

        const occupied = (ordersData || []).filter(o => o.table_id).length;
        result = {
          ok: true,
          intent: 'query_tables',
          response: `🍽️ Estado de mesas: ${occupied} mesa(s) ocupada(s) ahora mismo.`,
          data: { occupied_tables: occupied },
        };
      }
      else {
        result = { ok: false, error: `Unknown intent: ${intent}` };
      }
      break;
    }

    case 'health_check':
      result = { ok: true, message: 'admin-ops healthy', timestamp: new Date().toISOString() };
      break;

*/

-- =====================================================================
-- Verificar que la Edge Function tiene la nueva acción (después de editar)
-- =====================================================================

-- Esta función devuelve todas las acciones soportadas por admin-ops
SELECT
    proname AS function_name,
    pg_get_functiondef(oid) AS definition
FROM pg_proc
WHERE proname IN ('admin-ops', 'admin_ops')
LIMIT 5;

COMMENT ON EXTENSION IF EXISTS pg_net IS 'Para invocar Edge Functions desde SQL';
