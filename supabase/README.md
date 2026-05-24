# InfraWork — Auth & RBAC (Supabase)

Este diretório agrupa **schema, RLS, seed e Edge Functions** do módulo de autenticação e autorização do InfraWork.

## Visão geral

| Camada | Onde | Para que serve |
|---|---|---|
| Schema + RLS | `migrations/*.sql` | Tabelas (`empresas`, `profiles`, `obras`, `obra_permissoes`), enum `role_enum`, helpers `auth_role()/auth_empresa_id()/auth_engenheiro_id()` e policies por papel. RLS é a **camada primária** de autorização. |
| Seed | `seeds/seed-god.ts` (Deno) | Cria/atualiza idempotentemente o usuário God a partir de env vars. |
| Edge Functions | `functions/*` (Deno) | Endpoints REST para operações privilegiadas (criar empresa/usuário/obra, conceder/revogar acesso, /me) — fazem **validação de papel em código** antes de tocar o banco com `service_role`. Defesa em profundidade junto com a RLS. |
| Testes | `tests/rbac.test.ts` | Cobertura dos 5 cenários críticos da matriz de papéis (ver abaixo). |

## Pré-requisitos

- [Node 20+](https://nodejs.org)
- [Deno 1.45+](https://deno.land) (para seed e testes)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (para rodar local: `supabase start`)
- Projeto Supabase: `infrawork`

## Variáveis de ambiente

Crie `.env` na raiz do repositório (não comitado — já está no `.gitignore`):

```dotenv
# Conexão
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# Seed do God
SEED_GOD_EMAIL=rhuann.nunes@tecpav.com.br
SEED_GOD_PASSWORD=<senha-forte-min-12-chars>
SEED_GOD_NAME=God Administrador

# Para o renderer (mesmos values em VITE_*)
VITE_USE_SUPABASE=true
VITE_SUPABASE_URL=$SUPABASE_URL
VITE_SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY
```

> ⚠️ **`SERVICE_ROLE_KEY` jamais vai para o renderer.** É consumida apenas pelas Edge Functions (que rodam server-side no Supabase) e pelo seed.

## Setup local (passo a passo)

```bash
# 1. Subir o stack local
supabase start

# 2. Aplicar migrations
supabase db reset                # apaga e roda tudo do zero
# ou
supabase db push                 # aplica apenas as pendentes

# 3. Seed do God
deno run --allow-env --allow-net supabase/seeds/seed-god.ts

# 4. Deploy das Edge Functions localmente
supabase functions serve         # serve todas em http://localhost:54321/functions/v1/

# 5. (Outro terminal) — rodar os testes
deno test --allow-env --allow-net supabase/tests/rbac.test.ts
```

## Setup contra o projeto remoto `infrawork`

```bash
# 1. Linkar o repo local ao projeto remoto
supabase link --project-ref <project-ref>

# 2. Aplicar migrations no remoto
supabase db push

# 3. Deploy das functions
supabase functions deploy create-empresa
supabase functions deploy create-usuario
supabase functions deploy create-obra
supabase functions deploy grant-obra-permissao
supabase functions deploy revoke-obra-permissao
supabase functions deploy me

# 4. Configurar segredos das functions
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
# Atenção: SUPABASE_URL, SUPABASE_ANON_KEY são providos automaticamente pela plataforma.

# 5. Seed remoto do God
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role> \
SEED_GOD_PASSWORD=<senha> \
deno run --allow-env --allow-net supabase/seeds/seed-god.ts
```

## Matriz de papéis (referência)

| Papel | Escopo | Cria empresa | Cria usuário | Cria obra | Concede acesso |
|---|---|---|---|---|---|
| **God** | global | ✅ | ✅ qualquer papel, qualquer empresa | ✅ qualquer empresa | ✅ |
| **Adm** | empresa | ❌ | ✅ adm/eng/apoio na sua empresa | ✅ na sua empresa | ✅ na sua empresa |
| **Engenheiro** | obras autorizadas | ❌ | ✅ **apenas Apoio vinculado a si** | ❌ | ❌ |
| **Apoio** | herda do Engenheiro | ❌ | ❌ | ❌ | ❌ |

Regras críticas:
- **Apoio herda obras**: o JOIN `obra_permissoes.user_id = profiles.engenheiro_id` define o conjunto de obras do Apoio.
- **Revogação cascateia**: como o Apoio não tem linha própria em `obra_permissoes`, apagar a do Engenheiro derruba todos os Apoios vinculados.
- **Empresa-id é forçada** nas Edge Functions: mesmo se o cliente enviar `empresa_id` de outra empresa, Adm/Engenheiro são sobrescritos com a empresa do caller.

## Endpoints

| Método | Path | Permissão |
|---|---|---|
| POST | `/functions/v1/create-empresa` | God |
| POST | `/functions/v1/create-usuario` | God / Adm / Engenheiro (apenas Apoio) |
| POST | `/functions/v1/create-obra` | God / Adm |
| POST | `/functions/v1/grant-obra-permissao` | God / Adm |
| POST (ou DELETE) | `/functions/v1/revoke-obra-permissao` | God / Adm |
| GET | `/functions/v1/me` | qualquer autenticado |

Todas exigem `Authorization: Bearer <JWT>`. Login (`POST /auth/v1/token?grant_type=password`) é feito direto pelo SDK do Supabase, não pelas Edge Functions.

## Testes

`supabase/tests/rbac.test.ts` valida:

1. **God cria empresa** — pode inserir em `empresas`.
2. **Adm não cria empresa** — RLS retorna erro.
3. **Engenheiro não vê obra sem permissão** — `SELECT obras` retorna lista vazia.
4. **Apoio vê o que o Engenheiro vê** — após Adm conceder, ambos veem a obra.
5. **Revogação cascateia** — após `DELETE obra_permissoes`, Engenheiro E Apoio perdem o acesso.

Execução: `deno test --allow-env --allow-net supabase/tests/rbac.test.ts`.

## Esquema visual

```
auth.users  ───<id>───►  public.profiles
                            │  role: enum
                            │  empresa_id ────► public.empresas
                            │  engenheiro_id ──► public.profiles (self-FK; apenas role=apoio)
                            │
                            ▼
                  public.obra_permissoes
                            ▲
                            │
                  public.obras
                            └── empresa_id ────► public.empresas

Helpers SQL:
  auth_role()         → role do JWT atual
  auth_empresa_id()   → empresa do JWT atual
  auth_engenheiro_id()→ engenheiro_id do JWT atual (NULL p/ não-apoio)
```

## Observações de segurança

- As funções `auth_role()`, `auth_empresa_id()`, `auth_engenheiro_id()` são `SECURITY DEFINER` com owner `postgres` (BYPASSRLS). Assim, quando consultadas dentro de policies em `profiles`, não recursam pela própria policy.
- A Edge Function `me` valida o papel e replica a política em código antes de retornar — defesa em profundidade. O cliente pode usar tanto `me` quanto consultas diretas (a RLS protege).
- Recomenda-se **rotacionar a `SERVICE_ROLE_KEY`** se o ambiente local for compartilhado.
