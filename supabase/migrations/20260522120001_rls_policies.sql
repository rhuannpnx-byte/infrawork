-- InfraWork — RLS policies
-- Espelha a matriz de papéis:
--   God        → enxerga/edita tudo
--   Adm        → opera apenas dentro da própria empresa
--   Engenheiro → vê apenas obras com permissão explícita; cria apenas Apoio vinculado a si
--   Apoio      → herda obras do Engenheiro (engenheiro_id)

-- ─── habilita RLS em todas as tabelas ────────────────────────────────────
alter table public.empresas         enable row level security;
alter table public.profiles         enable row level security;
alter table public.obras            enable row level security;
alter table public.obra_permissoes  enable row level security;

-- =========================================================================
-- empresas
-- =========================================================================
drop policy if exists empresas_god_all on public.empresas;
create policy empresas_god_all on public.empresas
  for all
  to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

drop policy if exists empresas_adm_select_own on public.empresas;
create policy empresas_adm_select_own on public.empresas
  for select
  to authenticated
  using (
    public.auth_role() = 'adm'
    and id = public.auth_empresa_id()
  );

-- Engenheiro/Apoio precisam saber o nome da própria empresa
drop policy if exists empresas_user_select_own on public.empresas;
create policy empresas_user_select_own on public.empresas
  for select
  to authenticated
  using (
    public.auth_role() in ('engenheiro', 'apoio')
    and id = public.auth_empresa_id()
  );

-- =========================================================================
-- profiles
-- =========================================================================
-- SELECT
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

drop policy if exists profiles_god_select on public.profiles;
create policy profiles_god_select on public.profiles
  for select
  to authenticated
  using (public.auth_role() = 'god');

-- Adm / Engenheiro / Apoio veem TODOS os usuários da própria empresa, exceto Gods.
-- (Política unificada — Gods continuam invisíveis para não-Gods porque
--  têm empresa_id = NULL e a cláusula `role <> 'god'` reforça a intenção.)
drop policy if exists profiles_adm_select on public.profiles;
drop policy if exists profiles_engenheiro_select_apoios on public.profiles;
drop policy if exists profiles_user_select_empresa on public.profiles;
create policy profiles_user_select_empresa on public.profiles
  for select
  to authenticated
  using (
    public.auth_role() in ('adm', 'engenheiro', 'apoio')
    and empresa_id = public.auth_empresa_id()
    and role <> 'god'
  );

-- INSERT
-- (Nota: criar profile é normalmente feito pela Edge Function que também cria o
--  registro em auth.users via service_role — então o caminho cliente direto é
--  raro. Mantemos a policy para defesa em profundidade.)
drop policy if exists profiles_god_insert on public.profiles;
create policy profiles_god_insert on public.profiles
  for insert
  to authenticated
  with check (public.auth_role() = 'god');

drop policy if exists profiles_adm_insert on public.profiles;
create policy profiles_adm_insert on public.profiles
  for insert
  to authenticated
  with check (
    public.auth_role() = 'adm'
    and empresa_id = public.auth_empresa_id()
    and role in ('adm', 'engenheiro', 'apoio')
  );

drop policy if exists profiles_engenheiro_insert_apoio on public.profiles;
create policy profiles_engenheiro_insert_apoio on public.profiles
  for insert
  to authenticated
  with check (
    public.auth_role() = 'engenheiro'
    and role = 'apoio'
    and engenheiro_id = auth.uid()
    and empresa_id = public.auth_empresa_id()
  );

-- UPDATE
drop policy if exists profiles_god_update on public.profiles;
create policy profiles_god_update on public.profiles
  for update
  to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

drop policy if exists profiles_adm_update on public.profiles;
create policy profiles_adm_update on public.profiles
  for update
  to authenticated
  using      (public.auth_role() = 'adm' and empresa_id = public.auth_empresa_id())
  with check (public.auth_role() = 'adm' and empresa_id = public.auth_empresa_id());

-- Usuário pode atualizar seu próprio nome (mas não role/empresa_id/engenheiro_id)
-- Pra simplificar e blindar, restrição de colunas se faz na Edge Function /me.
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update
  to authenticated
  using      (id = auth.uid())
  with check (id = auth.uid());

-- =========================================================================
-- obras
-- =========================================================================
-- SELECT
drop policy if exists obras_god_select on public.obras;
create policy obras_god_select on public.obras
  for select
  to authenticated
  using (public.auth_role() = 'god');

drop policy if exists obras_adm_select on public.obras;
create policy obras_adm_select on public.obras
  for select
  to authenticated
  using (
    public.auth_role() = 'adm'
    and empresa_id = public.auth_empresa_id()
  );

-- NOTA: as duas policies abaixo usam helpers SECURITY DEFINER
-- (`has_obra_permissao`, definido na migration 0002) em vez de EXISTS direto
-- em `obra_permissoes`. Sem isso, o pareamento com a policy `obra_perm_adm_all`
-- (que consulta `obras`) gera ciclo de RLS e o Postgres aborta com
-- "infinite recursion detected in policy for relation".
drop policy if exists obras_engenheiro_select on public.obras;
create policy obras_engenheiro_select on public.obras
  for select
  to authenticated
  using (
    public.auth_role() = 'engenheiro'
    and public.has_obra_permissao(obras.id, auth.uid())
  );

-- Apoio herda: a obra é visível se o engenheiro_id do Apoio tem permissão
drop policy if exists obras_apoio_select on public.obras;
create policy obras_apoio_select on public.obras
  for select
  to authenticated
  using (
    public.auth_role() = 'apoio'
    and public.has_obra_permissao(obras.id, public.auth_engenheiro_id())
  );

-- INSERT / UPDATE / DELETE
drop policy if exists obras_god_write on public.obras;
create policy obras_god_write on public.obras
  for all
  to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

drop policy if exists obras_adm_write on public.obras;
create policy obras_adm_write on public.obras
  for all
  to authenticated
  using      (public.auth_role() = 'adm' and empresa_id = public.auth_empresa_id())
  with check (public.auth_role() = 'adm' and empresa_id = public.auth_empresa_id());

-- =========================================================================
-- obra_permissoes
-- =========================================================================
-- God: tudo
drop policy if exists obra_perm_god_all on public.obra_permissoes;
create policy obra_perm_god_all on public.obra_permissoes
  for all
  to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

-- Adm: tudo, desde que a obra seja da sua empresa.
-- Usa helper `obra_empresa()` (SECURITY DEFINER, BYPASSRLS) em vez de
-- EXISTS direto — mesma razão da nota nas policies de `obras` acima.
drop policy if exists obra_perm_adm_all on public.obra_permissoes;
create policy obra_perm_adm_all on public.obra_permissoes
  for all
  to authenticated
  using (
    public.auth_role() = 'adm'
    and public.obra_empresa(obra_permissoes.obra_id) = public.auth_empresa_id()
  )
  with check (
    public.auth_role() = 'adm'
    and public.obra_empresa(obra_permissoes.obra_id) = public.auth_empresa_id()
  );

-- Engenheiro: vê apenas o próprio vínculo (para saber a quais obras tem acesso)
drop policy if exists obra_perm_user_select_own on public.obra_permissoes;
create policy obra_perm_user_select_own on public.obra_permissoes
  for select
  to authenticated
  using (user_id = auth.uid());

-- Apoio: vê os vínculos do seu engenheiro_id (para listar suas obras)
drop policy if exists obra_perm_apoio_select_via_eng on public.obra_permissoes;
create policy obra_perm_apoio_select_via_eng on public.obra_permissoes
  for select
  to authenticated
  using (
    public.auth_role() = 'apoio'
    and user_id = public.auth_engenheiro_id()
  );
