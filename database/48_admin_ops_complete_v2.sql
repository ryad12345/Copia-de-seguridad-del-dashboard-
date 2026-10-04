-- =====================================================================
-- MOZONA TPV — Edge Function admin-ops v2 — CÓDIGO COMPLETO
-- =====================================================================
-- Este archivo contiene el código COMPLETO de la Edge Function admin-ops
-- con todas las acciones: chat_query + soft_delete + restore + send_telegram
--
-- INSTRUCCIONES:
-- 1. Ve a https://supabase.com/dashboard/project/hcqkpokodrqimkulporw/functions/admin-ops
-- 2. Click "Edit"
-- 3. BORRA TODO el código actual
-- 4. Pega TODO el código que está en este archivo (debajo del comentario)
-- 5. Click "Deploy"
-- =====================================================================

/*
// ═══════════════════════════════════════════════════════════════════════
// MOZONA TPV — admin-ops v2 (CÓDIGO COMPLETO)
// Reemplaza TODO el código previo
// ═══════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // 1. Verificar JWT del usuario
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Unauthorized: missing Authorization header' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false }
  })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token)
  if (userErr || !user) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Invalid token' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  let body: any = {}
  try {
    body = await req.json()
  } catch (_) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Invalid JSON body' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const { action, payload = {} } = body
  let result: any = { ok: false, error: `Unknown action: ${action}` }

  // Helper: validar acceso al tenant
  async function validateTenantAccess(tenantId: string): Promise<boolean> {
    if (!tenantId) return false
    // 1. Owner directo
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id, owner_id')
      .eq('id', tenantId)
      .eq('owner_id', user.id)
      .maybeSingle()
    if (tenant) return true

    // 2. VIP bypass via app_settings
    try {
      const { data: vipSetting } = await supabaseAdmin
        .from('app_settings')
        .select('value')
        .eq('key', 'vip_emails')
        .maybeSingle()
      if (vipSetting?.value && user.email) {
        const vipList = String(vipSetting.value).split(',').map(e => e.trim().toLowerCase())
        if (vipList.includes(user.email.toLowerCase())) return true
      }
    } catch (_) {}

    return false
  }

  try {
    switch (action) {
      // ═══════════════════════════════════════════════════════════════
      // HEALTH CHECK
      // ═══════════════════════════════════════════════════════════════
      case 'health_check':
        result = { ok: true, message: 'admin-ops healthy', timestamp: new Date().toISOString() }
        break

      // ═══════════════════════════════════════════════════════════════
      // CHAT_QUERY — Queries seguras para el ChatPro
      // El cliente llama aquí con el intent + tenant_id
      // Validamos que el usuario tenga acceso al tenant
      // Ejecutamos la query SQL con service_role pero SOLO del tenant validado
      // ═══════════════════════════════════════════════════════════════
      case 'chat_query': {
        const requestedTenantId = payload.tenant_id
        const intent = payload.intent || 'unknown'
        const params = payload.params || {}

        if (!requestedTenantId) {
          result = { ok: false, intent, error: 'tenant_id is required' }
          break
        }

        // Validar acceso al tenant
        const allowed = await validateTenantAccess(requestedTenantId)
        if (!allowed) {
          result = { ok: false, intent, error: 'Access denied: tenant_id does not belong to user' }
          break
        }

        // query_sales: ventas en un periodo
        if (intent === 'query_sales') {
          const period = params.period || 'today'
          let date_from = new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
          let date_label = 'hoy'
          if (period === 'yesterday') {
            date_from = new Date(Date.now() - 86400000).toISOString()
            date_label = 'ayer'
          } else if (period === 'week') {
            date_from = new Date(Date.now() - 7 * 86400000).toISOString()
            date_label = 'esta semana'
          } else if (period === 'month') {
            date_from = new Date(Date.now() - 30 * 86400000).toISOString()
            date_label = 'este mes'
          }

          const { data: orders, error: oErr } = await supabaseAdmin
            .from('orders')
            .select('id, total, created_at')
            .eq('tenant_id', requestedTenantId)
            .is('deleted_at', null)
            .gte('created_at', date_from)
            .limit(1000)

          if (oErr) throw oErr

          const arr = orders || []
          const total = arr.reduce((s: number, o: any) => s + Number(o.total || 0), 0)
          const count = arr.length
          const avg = count > 0 ? total / count : 0

          result = {
            ok: true,
            intent,
            response: count > 0
              ? `Ventas de ${date_label}: ${count} tickets, ${total.toFixed(2)} euros en total, promedio ${avg.toFixed(2)} euros por ticket.`
              : `${date_label.charAt(0).toUpperCase() + date_label.slice(1)} aun no hay ventas registradas.`,
            data: {
              total_ventas: total.toFixed(2),
              num_tickets: count,
              promedio_por_ticket: avg.toFixed(2),
              periodo: date_label,
            },
          }
        }

        // query_top_products: top 5 productos más vendidos
        else if (intent === 'query_top_products') {
          const { data: ordersData, error: oErr } = await supabaseAdmin
            .from('orders')
            .select('id')
            .eq('tenant_id', requestedTenantId)
            .is('deleted_at', null)
            .limit(5000)

          if (oErr) throw oErr

          const orderIds = (ordersData || []).map((o: any) => o.id)
          if (orderIds.length === 0) {
            result = {
              ok: true,
              intent,
              response: 'Aun no hay ventas registradas en tu local.',
              data: { top: [] },
            }
            break
          }

          const { data: itemsData, error: iErr } = await supabaseAdmin
            .from('order_items')
            .select('name, quantity, price')
            .in('order_id', orderIds.slice(0, 100))
            .limit(5000)

          if (iErr) throw iErr

          const counts: Record<string, { qty: number; revenue: number }> = {}
          for (const it of itemsData || []) {
            const name = (it.name || 'Sin nombre') as string
            if (!counts[name]) counts[name] = { qty: 0, revenue: 0 }
            counts[name].qty += Number(it.quantity || 0)
            counts[name].revenue += Number(it.price || 0) * Number(it.quantity || 0)
          }

          const top = Object.entries(counts)
            .sort((a, b) => b[1].qty - a[1].qty)
            .slice(0, 5)
            .map(([name, info]) => ({
              name,
              qty: info.qty,
              revenue: info.revenue.toFixed(2),
            }))

          result = {
            ok: true,
            intent,
            response: top.length > 0
              ? `Tus productos mas vendidos: ${top.map((t, i) => `${i + 1}. ${t.name} (${t.qty} uds, ${t.revenue} euros)`).join(' | ')}.`
              : 'Aun no hay datos de ventas para mostrar.',
            data: { top },
          }
        }

        // query_low_stock: productos no disponibles
        else if (intent === 'query_low_stock') {
          const { data: products, error: pErr } = await supabaseAdmin
            .from('products')
            .select('id, name, is_active, is_available')
            .eq('tenant_id', requestedTenantId)
            .or('is_active.eq.false,is_available.eq.false')
            .limit(20)

          if (pErr) throw pErr

          const arr = products || []
          if (arr.length === 0) {
            const { count } = await supabaseAdmin
              .from('products')
              .select('*', { count: 'exact', head: true })
              .eq('tenant_id', requestedTenantId)
            result = {
              ok: true,
              intent,
              response: `Tienes ${count ?? 0} producto(s) en tu carta y todos estan disponibles.`,
              data: { total_products: count, low_stock: [] },
            }
            break
          }

          result = {
            ok: true,
            intent,
            response: `Tienes ${arr.length} producto(s) no disponible(s): ${arr.slice(0, 5).map((p: any) => p.name).join(', ')}.`,
            data: { low_stock: arr },
          }
        }

        // query_tables: estado de mesas
        else if (intent === 'query_tables') {
          const { data: ordersData, error: tErr } = await supabaseAdmin
            .from('orders')
            .select('table_id, status')
            .eq('tenant_id', requestedTenantId)
            .is('deleted_at', null)
            .in('status', ['draft', 'open', 'sent'])

          if (tErr) throw tErr

          const occupied = (ordersData || []).filter((o: any) => o.table_id).length
          result = {
            ok: true,
            intent,
            response: `Estado de mesas: ${occupied} mesa(s) ocupada(s) ahora mismo.`,
            data: { occupied_tables: occupied },
          }
        }

        else {
          result = { ok: false, intent, error: `Unknown intent: ${intent}` }
        }
        break
      }

      // ═══════════════════════════════════════════════════════════════
      // SOFT_DELETE (idempotente via RPC)
      // ═══════════════════════════════════════════════════════════════
      case 'soft_delete_customer':
        result = await supabaseAdmin.rpc('soft_delete_customer', {
          p_id: payload.id,
          p_reason: payload.reason || null
        })
        break

      case 'soft_delete_order':
        result = await supabaseAdmin.rpc('soft_delete_order', {
          p_id: payload.id,
          p_reason: payload.reason || null
        })
        break

      case 'soft_delete_pre_bill':
        result = await supabaseAdmin.rpc('soft_delete_pre_bill', {
          p_id: payload.id,
          p_reason: payload.reason || null
        })
        break

      // ═══════════════════════════════════════════════════════════════
      // RESTORE
      // ═══════════════════════════════════════════════════════════════
      case 'restore_customer':
        result = await supabaseAdmin.rpc('restore_customer', { p_id: payload.id })
        break

      case 'restore_order':
        result = await supabaseAdmin.rpc('restore_order', { p_id: payload.id })
        break

      // ═══════════════════════════════════════════════════════════════
      // TELEGRAM
      // ═══════════════════════════════════════════════════════════════
      case 'send_telegram': {
        const TG_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')
        const TG_CHAT = Deno.env.get('TELEGRAM_CHAT_ID')
        if (!TG_TOKEN || !TG_CHAT) {
          result = { ok: false, error: 'Telegram secrets not configured' }
          break
        }
        const r = await fetch(
          `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: TG_CHAT,
              text: payload.text,
              parse_mode: 'HTML',
              reply_markup: payload.reply_markup
            })
          }
        )
        const tgData = await r.json()
        result = { ok: tgData.ok, data: tgData }
        break
      }

      // ═══════════════════════════════════════════════════════════════
      // AUDIT LOG (insercion manual)
      // ═══════════════════════════════════════════════════════════════
      case 'audit_log':
        await supabaseAdmin.from('edge_function_logs').insert({
          function_name: payload.function_name || 'admin-ops',
          actor_id: user.id,
          action: payload.event,
          success: payload.success !== false,
          error_msg: payload.error || null,
          ip_address: req.headers.get('x-forwarded-for') || null,
          user_agent: req.headers.get('user-agent') || null
        })
        result = { ok: true }
        break

      default:
        result = { ok: false, error: `Unknown action: ${action}` }
    }

    // Log automatico (todas las invocaciones)
    await supabaseAdmin.from('edge_function_logs').insert({
      function_name: 'admin-ops',
      actor_id: user.id,
      action: action,
      success: result.ok !== false,
      error_msg: result.error || null,
      ip_address: req.headers.get('x-forwarded-for') || null,
      user_agent: req.headers.get('user-agent') || null
    }).catch(() => {})

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (e: any) {
    return new Response(
      JSON.stringify({ ok: false, error: e.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
*/

-- =====================================================================
-- Después de pegar el código anterior, ejecuta esta query para verificar
-- =====================================================================

-- (Esta query no hace nada destructivo, solo documenta)
SELECT
    'admin-ops v2 desplegada con acciones:' as info,
    'health_check, chat_query, soft_delete_*, restore_*, send_telegram, audit_log' as acciones;
