-- InfraWork — soft-delete de fotos pelo god/adm.
--
-- A foto continua existindo em acompanhamento_foto (necessario porque o sync
-- usaria o siga_foto_id como conflict key e recriaria a linha). Em vez disso,
-- marcamos excluida_em + excluida_por; views enriquecidas filtram is null.
-- Edge function tambem remove o arquivo do bucket.

alter table public.acompanhamento_foto
  add column if not exists excluida_em timestamptz,
  add column if not exists excluida_por uuid references public.profiles(id) on delete set null;

create index if not exists idx_acomp_foto_excluida
  on public.acompanhamento_foto(obra_id)
  where excluida_em is null;

-- View enriquecida exclui fotos marcadas como deletadas
drop view if exists public.vw_acompanhamento_foto_enriquecida cascade;

create view public.vw_acompanhamento_foto_enriquecida
with (security_invoker = true)
as
select
  f.id                                                            as id,
  f.obra_id                                                       as obra_id,
  f.siga_foto_id                                                  as siga_foto_id,
  f.producao_siga_id                                              as producao_siga_id,
  f.lat                                                           as lat,
  f.lng                                                           as lng,
  f.servico_executado_id                                          as siga_servico_id,
  f.servico_executado_nome                                        as siga_servico_nome,
  f.encarregado_id                                                as siga_encarregado_id,
  f.encarregado_nome                                              as siga_encarregado_nome,
  f.captured_at                                                   as captured_at,
  (f.captured_at at time zone 'America/Sao_Paulo')::date          as captured_date,
  f.storage_bucket                                                as storage_bucket,
  f.storage_key                                                   as storage_key,
  f.obs                                                           as obs,
  f.size_bytes                                                    as size_bytes,
  f.mime                                                          as mime,
  f.sincronizado_em                                               as sincronizado_em,
  sm.id                                                           as servico_match_id,
  sm.servico_id                                                   as servico_planejamento_id,
  s.nome                                                          as servico_display_nome,
  enm.id                                                          as encarregado_match_id,
  coalesce(enm.apelido_canonico, f.encarregado_nome)              as encarregado_display_nome,
  em.id                                                           as equipe_match_id,
  coalesce(e.nome, enm.apelido_canonico, f.encarregado_nome)      as equipe_display_nome,
  coalesce(e.cor, '#94a3b8')                                      as equipe_display_cor,
  case
    when f.producao_siga_id is not null then 'direto'
    when prod_inferido.id is not null then 'inferido'
    else 'avulso'
  end                                                             as correlacao_producao,
  prod_inferido.id                                                as producao_inferida_id,
  prod_inferido.frente                                            as frente
from public.acompanhamento_foto f
left join public.acompanhamento_servico_match sm
       on sm.obra_id = f.obra_id and sm.siga_servico_executado_id = f.servico_executado_id
left join public.servico s
       on s.id = sm.servico_id
left join public.acompanhamento_encarregado_match enm
       on enm.obra_id = f.obra_id and enm.siga_encarregado_nome = f.encarregado_nome
left join public.acompanhamento_equipe_match em
       on em.id = enm.equipe_match_id
left join public.equipe e
       on e.id = em.equipe_id
left join lateral (
  select p.id, p.frente
    from public.acompanhamento_producao p
   where p.obra_id = f.obra_id
     and p.servico_id = f.servico_executado_id
     and p.data between (f.captured_at at time zone 'America/Sao_Paulo')::date - interval '1 day'
                    and (f.captured_at at time zone 'America/Sao_Paulo')::date + interval '1 day'
   order by abs(extract(epoch from (p.data::timestamp - f.captured_at)))
   limit 1
) prod_inferido on f.producao_siga_id is null
where f.excluida_em is null;

grant select on public.vw_acompanhamento_foto_enriquecida to authenticated;
