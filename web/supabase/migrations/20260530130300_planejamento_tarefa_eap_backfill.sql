-- InfraWork — Planejamento (Refator EAP/Marcos/Multi-tarefa, M4):
-- Backfill: popula quantidade_alocada e codigo_eap das tarefas pré-existentes.
--
-- Estratégia: cada tarefa existente vira tarefa-folha (tipo_no='tarefa', nivel=1)
-- com quantidade_alocada = item.quantidade_referencia. Como a UNIQUE
-- (planejamento_id, item_orcamentario_id) foi droppada em M3 mas as tarefas
-- pré-existentes ainda são 1:1 com item, a soma de quantidade_alocada por item
-- bate exatamente com quantidade_referencia (trigger M5 valida com tolerância).
--
-- codigo_eap recebe item.codigo (ex: "1.2.3") como derivação inicial. UI calcula
-- codigos por posição ao reorganizar; o snapshot persistido aqui é só baseline.

update public.planejamento_tarefa pt
   set tipo_no            = 'tarefa',
       nivel              = 1,
       quantidade_alocada = io.quantidade_referencia,
       codigo_eap         = io.codigo
  from public.item_orcamentario io
 where io.id = pt.item_orcamentario_id
   and pt.quantidade_alocada is null;

-- Guard: toda tarefa-folha deve ter quantidade_alocada após backfill.
do $$
declare
  v_orfas int;
begin
  select count(*) into v_orfas
    from public.planejamento_tarefa
   where tipo_no = 'tarefa' and quantidade_alocada is null;
  if v_orfas > 0 then
    raise exception 'Backfill incompleto: % tarefa(s)-folha sem quantidade_alocada', v_orfas;
  end if;
end $$;
