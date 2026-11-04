-- Fix: cpu_snapshot.empresa_id foi removido na migração 20260524100000.
-- A migração 20260603150200 referenciava essa coluna inexistente, fazendo o
-- trigger crashar com `record "new" has no field "empresa_id"` em qualquer
-- tentativa de DELETE de CPU (que dispara UPDATE em cpu_snapshot via FK).
--
-- Esta migração recria fn_cpu_snapshot_imutavel verificando apenas as
-- colunas que realmente existem no schema atual.

create or replace function public.fn_cpu_snapshot_imutavel()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    -- Exceção: orfanização de cpu_id_origem (FK ON DELETE SET NULL).
    -- Outros campos do snapshot continuam blindados.
    if old.cpu_id_origem is not null
       and new.cpu_id_origem is null
       and new.obra_id                 is not distinct from old.obra_id
       and new.versao_origem           is not distinct from old.versao_origem
       and new.snapshot_em             is not distinct from old.snapshot_em
       and new.criado_por              is not distinct from old.criado_por
       and new.custo_unit              is not distinct from old.custo_unit
       and new.custo_eq_dia            is not distinct from old.custo_eq_dia
       and new.custo_comb_dia          is not distinct from old.custo_comb_dia
       and new.custo_mo_dia            is not distinct from old.custo_mo_dia
       and new.custo_mat_dia           is not distinct from old.custo_mat_dia
       and new.producao_diaria_qtde    is not distinct from old.producao_diaria_qtde
       and new.producao_diaria_unidade is not distinct from old.producao_diaria_unidade
       and new.servico_codigo          is not distinct from old.servico_codigo
       and new.servico_nome            is not distinct from old.servico_nome
       and new.servico_unidade         is not distinct from old.servico_unidade
       and new.payload                 is not distinct from old.payload then
      return new;
    end if;
    raise exception 'cpu_snapshot é imutável; crie um novo snapshot via Edge Function';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'cpu_snapshot não pode ser deletado diretamente; cascade da obra apaga';
  end if;
  return null;
end
$$;
