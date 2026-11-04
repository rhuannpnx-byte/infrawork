-- InfraWork — RLS para o papel 'cliente'.
--
-- O cliente espelha o engenheiro em termos de escopo de dados:
--   - vê apenas a própria empresa (empresa_id no profile)
--   - vê apenas as obras concedidas explicitamente em obra_permissoes
-- Diferenças (tratadas no front + edge functions, não aqui):
--   - não acessa Gerencial/Orçamento/Planejamento
--   - dentro de Acompanhamento vê só um subconjunto (sem valor agregado/projeções)
--
-- obra_permissoes: a leitura do próprio vínculo já é coberta por
-- `obra_perm_user_select_own` (user_id = auth.uid()), válida p/ qualquer papel.
-- profiles: o cliente NÃO deve listar usuários da empresa — basta
-- `profiles_self_select`; por isso não o incluímos em profiles_user_select_empresa.

-- ─── empresas: cliente vê a própria empresa ──────────────────────────────
-- Recria a policy de leitura de empresa pra incluir 'cliente' junto de eng/apoio.
drop policy if exists empresas_user_select_own on public.empresas;
create policy empresas_user_select_own on public.empresas
  for select
  to authenticated
  using (
    public.auth_role() in ('engenheiro', 'apoio', 'cliente')
    and id = public.auth_empresa_id()
  );

-- ─── obras: cliente vê apenas obras com permissão explícita ───────────────
-- Espelha obras_engenheiro_select; usa o helper SECURITY DEFINER
-- has_obra_permissao para evitar recursão de RLS com obra_permissoes.
drop policy if exists obras_cliente_select on public.obras;
create policy obras_cliente_select on public.obras
  for select
  to authenticated
  using (
    public.auth_role() = 'cliente'
    and public.has_obra_permissao(obras.id, auth.uid())
  );

-- ─── obra_trecho: cliente vê os trechos (KMZ) das obras concedidas ────────
-- Necessário para o mapa de Fotos (geometria/legenda dos trechos).
-- obra_trecho não contém preço/custo — exposição segura. Espelha o engenheiro.
drop policy if exists obra_trecho_cliente_select on public.obra_trecho;
create policy obra_trecho_cliente_select on public.obra_trecho
  for select
  to authenticated
  using (
    public.auth_role() = 'cliente'
    and public.has_obra_permissao(obra_id, auth.uid())
  );

-- NOTA DE ARQUITETURA — por que NÃO damos SELECT direto ao cliente nas tabelas
-- de produção/planejamento/orçamento:
--   As telas do cliente (calendário, produção, previsto × realizado) leem views
--   security_invoker, que dependeriam do RLS das tabelas-base. Dar SELECT bruto
--   em item_orcamentario expõe venda_unitaria/custo/lucratividade (valor
--   agregado), que o cliente NÃO pode ver. Por isso o cliente acessa esses dados
--   apenas via funções SECURITY DEFINER (migration 20260614120200), que retornam
--   somente colunas seguras e filtram por obra concedida.
