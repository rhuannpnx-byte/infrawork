-- InfraWork Web — Alertas: tipos sem SIGA (nada de "*_nao_vinculado"/"sync_falhou");
-- novo tipo `lancamento_sem_equipe`.

delete from public.acompanhamento_alerta
 where tipo in ('equipe_nao_vinculada', 'encarregado_nao_vinculado', 'servico_nao_vinculado', 'sync_falhou');

alter table public.acompanhamento_alerta drop constraint if exists chk_acomp_alerta_tipo;
alter table public.acompanhamento_alerta
  add constraint chk_acomp_alerta_tipo
  check (tipo in (
    'producao_zero_dias',
    'desvio_quantidade',
    'desvio_prazo',
    'sem_foto_periodo',
    'produtividade_baixa',
    'lancamento_sem_equipe'
  ));
