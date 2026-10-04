#!/bin/bash
# =====================================================================
# MOZONA TPV — check-dns.sh
# =====================================================================
# Verifica dónde apunta actualmente mozonatpv.site
# =====================================================================

echo "═══════════════════════════════════════════════════════════"
echo "  VERIFICACIÓN DNS: mozonatpv.site"
echo "═══════════════════════════════════════════════════════════"
echo ""

echo "→ HTTPS al apex (mozonatpv.site):"
curl -sL --max-time 10 -o /dev/null -w "  HTTP %{http_code} | IP %{remote_ip} | %{time_total}s\n" \
  https://mozonatpv.site/ 2>&1

echo ""
echo "→ HTTPS al www (www.mozonatpv.site):"
curl -sL --max-time 10 -o /dev/null -w "  HTTP %{http_code} | IP %{remote_ip} | %{time_total}s\n" \
  https://www.mozonatpv.site/ 2>&1

echo ""
echo "→ GitHub Pages URL (fallback):"
curl -sL --max-time 10 -o /dev/null -w "  HTTP %{http_code} | IP %{remote_ip} | %{time_total}s\n" \
  https://ryad12345.github.io/mozona-tpv-v2/ 2>&1

echo ""
echo "→ API health (Vercel — debería estar caído):"
curl -sL --max-time 10 -o /dev/null -w "  HTTP %{http_code} | IP %{remote_ip}\n" \
  https://mozonatpv.site/api/health 2>&1

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  IPs ESPERADAS PARA GITHUB PAGES:"
echo "    185.199.108.153"
echo "    185.199.109.153"
echo "    185.199.110.153"
echo "    185.199.111.153"
echo ""
echo "  Si ves '198.54.117.242' = apunta a Vercel (caído)"
echo "  Si ves '185.199.x.x' = apunta a GitHub Pages (OK)"
echo "═══════════════════════════════════════════════════════════"
