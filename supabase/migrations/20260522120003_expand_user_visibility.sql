-- InfraWork — Visibilidade de usuários por empresa
--
-- Antes:
--   - Adm via apenas usuários da própria empresa (OK — Gods naturalmente
--     filtrados porque têm empresa_id = NULL).
--   - Engenheiro via apenas os Apoios vinculados a si.
--   - Apoio via apenas a si mesmo.
--
-- Agora (request explícito):
--   - Adm/Engenheiro/Apoio veem TODOS os usuários da própria empresa, EXCETO Gods.
--   - Gods continuam invisíveis para não-Gods (defesa em profundidade: além de
--     `empresa_id <> NULL`, agora também `role <> 'god'`).
--   - God continua enxergando todo mundo via `profiles_god_select`.
--   - Cada usuário continua enxergando o próprio profile via `profiles_self_select`.

-- Remove as policies de leitura específicas que são substituídas pela nova,
-- mais ampla e mais explícita.
drop policy if exists profiles_adm_select on public.profiles;
drop policy if exists profiles_engenheiro_select_apoios on public.profiles;
drop policy if exists profiles_user_select_empresa on public.profiles;

-- Nova policy unificada para Adm / Engenheiro / Apoio
create policy profiles_user_select_empresa on public.profiles
  for select
  to authenticated
  using (
    public.auth_role() in ('adm', 'engenheiro', 'apoio')
    and empresa_id = public.auth_empresa_id()
    and role <> 'god'
  );
