-- InfraWork — Orçamento (Fase 1.4): views auxiliares
--
-- Hoje só temos uma: `vw_recurso_com_preco` traz cada recurso com o
-- preço vigente em `current_date`. Usada pela tela de Recursos e pelo CPU
-- Editor (preview de custo do item).
--
-- A view herda RLS da tabela `recurso` (security_invoker = true).

create or replace view public.vw_recurso_com_preco
with (security_invoker = true)
as
select
  r.id,
  r.empresa_id,
  r.codigo,
  r.grupo,
  r.nome,
  r.unidade,
  r.ativo,
  r.fonte,
  r.observacao,
  r.created_at,
  r.updated_at,
  public.preco_vigente_recurso(r.id) as preco_vigente
from public.recurso r;

comment on view public.vw_recurso_com_preco is
  'Recurso + preço vigente em current_date. RLS herda da tabela recurso (security_invoker).';
