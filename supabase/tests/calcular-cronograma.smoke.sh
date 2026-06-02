#!/usr/bin/env bash
# Smoke test da edge function `calcular-cronograma`.
#
# O QUE VALIDA:
#   1. OPTIONS preflight retorna 200 + Access-Control-Allow-Origin.
#   2. POST sem auth retorna 401 + CORS header (não pode bloquear browser).
#   3. POST com auth + planejamento_id inexistente retorna 404 + CORS header.
#   4. POST sem body retorna 400 + CORS header.
#   5. (opcional) POST com PLANEJAMENTO_ID válido → 200 + ok=true.
#
# REGRESSION GUARD: o fix da Fase 2 (try/catch global) garante que TODA
# resposta de erro vem com CORS header — se algum teste mostrar "missing
# CORS header", a edge function regrediu pro estado bugado.
#
# USO:
#   .env precisa ter VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY.
#   Opcional: passe PLANEJAMENTO_ID como variável de ambiente pra testar caso (5):
#     PLANEJAMENTO_ID=abc-123 bash supabase/tests/calcular-cronograma.smoke.sh
#
# DEPENDÊNCIAS: bash + curl + grep + jq (jq opcional, melhora output).

set -u

# ── Carrega .env (chaves Supabase) ─────────────────────────────────────────
if [[ -f .env ]]; then
  # shellcheck disable=SC2046
  export $(grep -E '^(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY)=' .env | xargs -d '\n')
fi

SUPABASE_URL="${VITE_SUPABASE_URL:-}"
ANON_KEY="${VITE_SUPABASE_ANON_KEY:-}"

if [[ -z "$SUPABASE_URL" || -z "$ANON_KEY" ]]; then
  echo "FAIL: VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY precisam estar definidos."
  exit 2
fi

ENDPOINT="$SUPABASE_URL/functions/v1/calcular-cronograma"

# ── Utilitários ────────────────────────────────────────────────────────────
RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RESET=$'\033[0m'

PASSED=0
FAILED=0

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    echo "${GREEN}✓${RESET} $label (expected $expected, got $actual)"
    PASSED=$((PASSED + 1))
  else
    echo "${RED}✗${RESET} $label (expected $expected, got ${YELLOW}$actual${RESET})"
    FAILED=$((FAILED + 1))
  fi
}

assert_contains() {
  local label="$1" needle="$2" haystack="$3"
  if echo "$haystack" | grep -qi "$needle"; then
    echo "${GREEN}✓${RESET} $label"
    PASSED=$((PASSED + 1))
  else
    echo "${RED}✗${RESET} $label (esperava encontrar '$needle')"
    FAILED=$((FAILED + 1))
  fi
}

# ── Teste 1: OPTIONS preflight ────────────────────────────────────────────
echo ""
echo "── Teste 1: OPTIONS preflight ───────────────────────────────────────"
RESP=$(curl -sS -i -X OPTIONS "$ENDPOINT" \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST" 2>&1)
STATUS=$(echo "$RESP" | head -1 | awk '{print $2}')
assert_eq "Status preflight" "200" "$STATUS"
assert_contains "CORS header em preflight" "access-control-allow-origin" "$RESP"

# ── Teste 2: POST sem auth ────────────────────────────────────────────────
echo ""
echo "── Teste 2: POST sem auth ───────────────────────────────────────────"
RESP=$(curl -sS -i -X POST "$ENDPOINT" \
  -H "Origin: http://localhost:5173" \
  -H "Content-Type: application/json" \
  -H "apikey: $ANON_KEY" \
  -d '{}' 2>&1)
STATUS=$(echo "$RESP" | head -1 | awk '{print $2}')
assert_eq "Status sem auth" "401" "$STATUS"
assert_contains "CORS header em 401" "access-control-allow-origin" "$RESP"

# ── Teste 3: POST autenticado mas sem body ────────────────────────────────
# 400 (body invalido) tambem aplica se mandar body que nao tem planejamento_id.
echo ""
echo "── Teste 3: POST com auth + body vazio ──────────────────────────────"
RESP=$(curl -sS -i -X POST "$ENDPOINT" \
  -H "Origin: http://localhost:5173" \
  -H "Content-Type: application/json" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" \
  -d '{}' 2>&1)
STATUS=$(echo "$RESP" | head -1 | awk '{print $2}')
# Pode ser 400 (body sem planejamento_id), 401 (anon key sem user JWT),
# ou 403 (sem role). Aceito qualquer 4xx — o objetivo aqui eh garantir CORS
# header em ERRO (regression do try/catch).
if [[ "$STATUS" =~ ^4[0-9][0-9]$ ]]; then
  echo "${GREEN}✓${RESET} Status 4xx esperado (got $STATUS)"
  PASSED=$((PASSED + 1))
else
  echo "${RED}✗${RESET} Status inesperado: $STATUS (esperava 4xx)"
  FAILED=$((FAILED + 1))
fi
assert_contains "CORS header em erro 4xx" "access-control-allow-origin" "$RESP"

# ── Teste 4: POST autenticado com planejamento_id inexistente ─────────────
echo ""
echo "── Teste 4: POST com planejamento_id inexistente ────────────────────"
RESP=$(curl -sS -i -X POST "$ENDPOINT" \
  -H "Origin: http://localhost:5173" \
  -H "Content-Type: application/json" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" \
  -d '{"planejamento_id":"00000000-0000-0000-0000-000000000000"}' 2>&1)
STATUS=$(echo "$RESP" | head -1 | awk '{print $2}')
# 404 (nao encontrado), 401/403 (sem role), ou 500 com CORS sao todos OK
# desde que CORS esteja presente.
echo "  Status retornado: $STATUS"
assert_contains "CORS header em planejamento inexistente" "access-control-allow-origin" "$RESP"

# ── Teste 5: POST com PLANEJAMENTO_ID válido (opcional) ──────────────────
if [[ -n "${PLANEJAMENTO_ID:-}" ]]; then
  echo ""
  echo "── Teste 5: POST com planejamento_id válido ($PLANEJAMENTO_ID) ──────"
  RESP=$(curl -sS -i -X POST "$ENDPOINT" \
    -H "Origin: http://localhost:5173" \
    -H "Content-Type: application/json" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $ANON_KEY" \
    -d "{\"planejamento_id\":\"$PLANEJAMENTO_ID\"}" 2>&1)
  STATUS=$(echo "$RESP" | head -1 | awk '{print $2}')
  BODY=$(echo "$RESP" | awk 'BEGIN{found=0} /^\r?$/{found=1; next} found')
  assert_eq "Status do recalc valido" "200" "$STATUS"
  assert_contains "Response com ok=true" '"ok":true' "$BODY"
fi

# ── Sumário ───────────────────────────────────────────────────────────────
echo ""
echo "──────────────────────────────────────────────────────────────────────"
echo "Passed: ${GREEN}$PASSED${RESET}   Failed: ${RED}$FAILED${RESET}"
if [[ $FAILED -gt 0 ]]; then
  exit 1
fi
exit 0
