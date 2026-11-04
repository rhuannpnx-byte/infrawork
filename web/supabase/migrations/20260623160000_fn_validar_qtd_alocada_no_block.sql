-- InfraWork — Planejamento: remove a TRAVA de qtd_alocada > qtd orçada.
--
-- Antes, `fn_tarefa_validar_qtd_alocada` lançava exceção quando a SOMA de
-- quantidade_alocada das tarefas de um item excedia a quantidade orçada
-- (quantidade_referencia). Isso bloqueava o `calcular-cronograma` (erro
-- "Falha ao persistir quantidades vinculadas / Quantidade alocada total
-- excede a quantidade orcada").
--
-- Decisão de negócio (2026-06-23): o cronograma PODE alocar mais que o
-- orçado — é comum estar executando um serviço cujo quantitativo só entra
-- como ADITIVO no futuro. A trava atrapalhava a rotina de execução.
--
-- A comparação orçado × alocado continua disponível como INFORMAÇÃO na UI
-- (AlocacaoIndicator / over-allocation), só não bloqueia mais a persistência.
--
-- A função vira no-op (mantém o trigger `trg_tarefa_validar_qtd_alocada`
-- intacto pra reversão fácil — basta restaurar o corpo antigo).

create or replace function public.fn_tarefa_validar_qtd_alocada()
returns trigger
language plpgsql
as $$
begin
  -- Sem bloqueio: cronograma pode exceder o orçado (aditivos futuros).
  return null;
end
$$;

comment on function public.fn_tarefa_validar_qtd_alocada() is
  'No-op desde 2026-06-23: cronograma pode alocar acima do orçado (aditivos). A divergência é mostrada na UI, não bloqueada.';
