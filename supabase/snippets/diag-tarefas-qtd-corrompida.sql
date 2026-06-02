-- Diagnóstico: tarefas com `quantidade_alocada` suspeita (provavelmente
-- corrompidas pelo bug parseBR antigo, que removia o ponto decimal).
--
-- Regra: lista tarefas onde a alocação INDIVIDUAL já excede 5× a quantidade
-- de referência do item orçado. Em rateio legítimo, soma de várias tarefas
-- pode chegar a 100% da referência, mas uma única raramente passa de 5×.
--
-- Uso: rodar no Supabase Studio (SQL Editor) com o projeto certo selecionado.
-- Lê apenas — não modifica nada. Resultado: lista pra revisar e deletar pela
-- UI do cronograma (botão direito → Excluir).
--
-- Após deletar as suspeitas, criar novas tarefas pelo "+ Adicionar" do
-- cronograma — o fix do parseBR de hoje garante quantidade correta.

select
  t.id                       as tarefa_id,
  p.id                       as planejamento_id,
  p.nome                     as planejamento_nome,
  o.codigo                   as obra_codigo,
  o.nome                     as obra_nome,
  tr.nome                    as trecho_nome,
  io.codigo                  as item_codigo,
  io.descricao               as item_descricao,
  t.quantidade_alocada       as qtd_alocada_atual,
  io.quantidade_referencia   as qtd_referencia,
  round(
    (t.quantidade_alocada / nullif(io.quantidade_referencia, 0))::numeric,
    2
  )                          as razao_alocada_referencia,
  t.data_inicio,
  t.data_fim,
  t.created_at
from public.planejamento_tarefa t
inner join public.planejamento p on p.id = t.planejamento_id
inner join public.obras o on o.id = p.obra_id
inner join public.item_orcamentario io on io.id = t.item_orcamentario_id
left join public.obra_trecho tr on tr.id = t.trecho_id
where t.tipo_no = 'tarefa'
  and t.quantidade_alocada is not null
  and io.quantidade_referencia is not null
  and io.quantidade_referencia > 0
  and t.quantidade_alocada > io.quantidade_referencia * 5
order by razao_alocada_referencia desc nulls last,
         p.nome,
         t.created_at;
