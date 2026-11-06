-- InfraWork Web — equipe vinculada a um encarregado (o encarregado tem N equipes).
-- No app de campo a sessão começa pelo encarregado e a lista de equipes mostra só as dele; encarregado sem equipe
-- vinculada vê as equipes sem encarregado.

alter table public.equipe
  add column if not exists encarregado_id uuid references public.encarregado(id) on delete set null;
create index if not exists idx_equipe_encarregado on public.equipe(encarregado_id) where encarregado_id is not null;

create or replace function public.fn_equipe_encarregado_obra()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.encarregado_id is not null and not exists (
    select 1 from public.encarregado en where en.id = new.encarregado_id and en.obra_id = new.obra_id
  ) then raise exception 'Encarregado de outra obra'; end if;
  return new;
end $$;
drop trigger if exists trg_equipe_encarregado_obra on public.equipe;
create trigger trg_equipe_encarregado_obra before insert or update of encarregado_id, obra_id on public.equipe
  for each row execute function public.fn_equipe_encarregado_obra();

-- catálogo do app (0038) com o encarregado de cada equipe
create or replace function public.campo_catalogo(_obra_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform public.campo_assert(_obra_id);
  select jsonb_build_object(
    'obra', (select jsonb_build_object('id', o.id, 'codigo', o.codigo, 'nome', o.nome, 'empresa_id', o.empresa_id)
               from public.obras o where o.id = _obra_id),
    'servicos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'codigo', i.codigo, 'descricao', i.descricao,
               'unidade', coalesce(s.unidade, i.unidade_referencia),
               'modo_lancamento', coalesce(p.modo_lancamento, 'quantidade'),
               'controla_material', coalesce(p.controla_material, false),
               'material', case when p.controla_material then jsonb_build_object(
                             'id', r.id, 'nome', r.nome, 'unidade', coalesce(p.material_unidade, r.unidade)) end,
               'material_obrigatorio', coalesce(p.material_obrigatorio, true),
               'habilita_obs', coalesce(p.habilita_obs, true),
               'exige_local', coalesce(p.exige_local, false))
             order by i.ordem, i.codigo)
        from public.item_orcamentario i
        join public.servico s on s.id = i.servico_id
        left join public.servico_parametro p on p.item_orcamentario_id = i.id
        left join public.recurso r on r.id = p.material_recurso_id
       where i.obra_id = _obra_id and i.tipo = 'servico_grupo' and i.indireto_id is null), '[]'::jsonb),
    'equipes', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'nome', e.nome, 'encarregado_id', e.encarregado_id) order by e.ordem, e.nome)
        from public.equipe e where e.obra_id = _obra_id and e.ativo and not coalesce(e.is_sistema, false)), '[]'::jsonb),
    'encarregados', coalesce((
      select jsonb_agg(jsonb_build_object('id', en.id, 'nome', en.nome, 'apelido', en.apelido) order by en.nome)
        from public.encarregado en where en.obra_id = _obra_id and en.ativo), '[]'::jsonb),
    'locais', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'nome', t.nome, 'tipo', t.tipo, 'ordem', t.ordem,
               'comprimento_m', t.comprimento_m, 'geometry_comprimento_m', t.geometry_comprimento_m,
               'unidade_espaco_padrao', t.unidade_espaco_padrao, 'unidade_custom_label', t.unidade_custom_label,
               'unidade_custom_divisor_m', t.unidade_custom_divisor_m,
               'marcador_valor_inicial', t.marcador_valor_inicial, 'geometry_sentido', t.geometry_sentido)
             order by t.tipo, t.ordem, t.nome)
        from public.obra_trecho t where t.obra_id = _obra_id), '[]'::jsonb),
    'veiculos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id, 'prefixo', v.prefixo, 'placa', v.placa, 'tipo', v.tipo, 'modelo', v.modelo,
               'proprietario', v.proprietario, 'capacidade_m3', v.capacidade_m3, 'capacidade_t', v.capacidade_t)
             order by v.prefixo)
        from public.veiculos_da_obra(_obra_id) v), '[]'::jsonb),
    'origens_destinos', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'nome', l.nome, 'tipo', l.tipo, 'trecho_id', l.trecho_id)
             order by l.nome)
        from public.transporte_local l where l.obra_id = _obra_id and l.ativo), '[]'::jsonb),
    'rotas', coalesce((
      select jsonb_agg(jsonb_build_object('origem_id', r.origem_id, 'destino_id', r.destino_id, 'dmt_km', r.dmt_km))
        from public.transporte_rota r where r.obra_id = _obra_id), '[]'::jsonb)
  ) into v;
  return v || jsonb_build_object('versao', md5(v::text));
end $$;
