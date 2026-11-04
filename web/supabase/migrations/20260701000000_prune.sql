-- InfraWork Web — PODA do schema herdado do InfraWork.
--
-- Roda logo após as migrations originais (2026-05 … 2026-06). Remove tudo que
-- o produto web não carrega: WhatsApp, Documentação IA, Agrupamento IA,
-- importação legada, SIGA (vínculo, matching, produção/fotos sincronizadas e
-- views dependentes), trechos/estaqueamento e colunas do cronograma avançado.
--
-- Tudo com CASCADE: views/policies/triggers dependentes caem junto e são
-- recriadas pelas migrations 0006+ (modelo nativo de produção, programação por
-- equipes). Idempotente (if exists).

-- ─── cron jobs herdados (apontavam para o projeto TecPav) ──────────────────
select cron.unschedule(jobid) from cron.job
 where jobname in ('acompanhamento-sync-todos', 'acompanhamento-alertas-todos');

-- ─── WhatsApp ─────────────────────────────────────────────────────────────
drop table if exists
  public.whatsapp_oraculo_log,
  public.whatsapp_oraculo_saida,
  public.whatsapp_oraculo_conversa,
  public.whatsapp_oraculo_acesso,
  public.whatsapp_servico_id_map,
  public.whatsapp_mensagem_log,
  public.whatsapp_job,
  public.whatsapp_grupo,
  public.whatsapp_sessao
cascade;
drop sequence if exists public.seq_whatsapp_foto_id cascade;
drop sequence if exists public.seq_whatsapp_servico_synthetic_id cascade;

-- ─── Documentação IA ──────────────────────────────────────────────────────
drop table if exists
  public.documentacao_finding,
  public.documentacao_tap,
  public.extracao_candidato,
  public.extracao_template,
  public.documento_classificacao_feedback,
  public.documento_chunk,
  public.documento_versao,
  public.documento,
  public.tipo_documento,
  public.aresta,
  public.no_grafo,
  public.lacuna,
  public.campo_dossie,
  public.clausula,
  public.evento,
  public.parte,
  public.responsavel_tecnico,
  public.ledger,
  public.contrato,
  public.obra_dossie,
  public.obra_perfil
cascade;

-- ─── Agrupamento IA ───────────────────────────────────────────────────────
drop table if exists public.agrupamento_job, public.agrupamento_feedback cascade;

-- ─── Importação legada (wizard TecPav) ────────────────────────────────────
drop table if exists public.import_match_fraco, public.import_job, public.template_importacao cascade;

-- ─── SIGA: vínculo, matching, produção/fotos sincronizadas ────────────────
drop view if exists
  public.vw_acompanhamento_obra_resumo,
  public.vw_acompanhamento_frente_kpis,
  public.vw_acompanhamento_heatmap_dia_servico,
  public.vw_acompanhamento_produtividade_equipe,
  public.vw_acompanhamento_previsto_x_realizado,
  public.vw_acompanhamento_curva_s,
  public.vw_acompanhamento_foto_enriquecida,
  public.vw_acompanhamento_producao_enriquecida
cascade;
drop table if exists
  public.acompanhamento_servico_match,
  public.acompanhamento_encarregado_match,
  public.acompanhamento_equipe_match,
  public.acompanhamento_foto,
  public.acompanhamento_producao,
  public.obra_acompanhamento_link
cascade;

-- ─── Trechos / estaqueamento / quantidades por trecho ─────────────────────
drop table if exists
  public.trecho_quantidade_celula,
  public.trecho_quantidade_segmento,
  public.trecho_quantidade_coluna,
  public.trecho_quantidade_versao,
  public.trecho_quantidade_template,
  public.obra_trecho
cascade;

-- Colunas do cronograma avançado em planejamento_tarefa (cascade derruba a
-- view vw_planejamento_tarefa_completa v11, recriada como v12 na 0006).
alter table public.planejamento_tarefa
  drop column if exists trecho_id cascade,
  drop column if exists posicao_inicio_m cascade,
  drop column if exists posicao_fim_m cascade,
  drop column if exists unidade_espaco_display cascade,
  drop column if exists qtd_link cascade,
  drop column if exists perfil_default cascade,
  drop column if exists usa_perfil_customizado cascade;

-- ─── Funções órfãs (todas as sobrecargas) ─────────────────────────────────
do $$
declare
  r record;
  alvo text[] := array[
    'whatsapp_registrar_foto', 'wa_grupo_empresa', 'wa_sessao_empresa',
    'buscar_chunks_fts', 'match_documento_chunks', 'match_documento_chunks_hibrido',
    'fn_doc_apply_obra_rls', 'fn_doc_chunk_escopo', 'fn_doc_clf_empresa',
    'fn_doc_empresa_from_obra', 'fn_extracao_template_empresa',
    'fn_agrupamento_feedback_empresa',
    'fn_import_job_touch', 'fn_template_default_tecpav_payload', 'fn_template_default_unico',
    'fn_template_touch', 'job_empresa', 'job_obra', 'match_fraco_obra', 'template_empresa',
    'template_obra',
    'acomp_link_obra', 'acomp_encarregado_match_obra', 'acomp_equipe_match_obra',
    'acomp_servico_match_obra', 'acomp_foto_obra', 'acomp_producao_obra',
    'pode_vincular_acompanhamento', 'fn_acomp_link_updated_at',
    'acompanhamento_perf_historico', 'cliente_curva_s', 'cliente_previsto_realizado',
    'cliente_producao',
    'trecho_obra', 'tqseg_obra', 'tqt_obra', 'tqv_obra', 'fn_tqv_imutavel',
    'fn_tqv_numero_auto', 'fn_tqv_promote', 'fn_tarefa_trecho_mesma_obra',
    'recalc_qtd_link_tarefas',
    'fn_ptps_validar_soma', 'fn_tarefa_validar_qtd_alocada'
  ];
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any(alvo)
  loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
end $$;

-- ─── Storage da documentação (bucket + policies) ──────────────────────────
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and policyname like 'documentacao%'
  loop
    execute format('drop policy if exists %I on storage.objects', r.policyname);
  end loop;
end $$;
-- (objetos/bucket 'documentacao' não existem em instalações novas; em bases antigas remova via Storage API)

-- ─── Extensões sem uso ────────────────────────────────────────────────────
drop extension if exists vector cascade;
