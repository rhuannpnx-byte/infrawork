-- 0059 — Ficha de viagens com conferência de versão: quem envia (app, web) informa a versão em que se baseou; se a
-- ficha mudou depois (outra pessoa, outro canal), o banco recusa com aviso em vez de apagar as viagens que o outro
-- acrescentou. Sem versão (primeiro envio, app antigo) segue como antes. O retorno passa a trazer a versão nova.

CREATE OR REPLACE FUNCTION public.campo_sync_ficha(_ficha jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_id uuid := (_ficha->>'id')::uuid; v_obra uuid := (_ficha->>'obra_id')::uuid;
  v_atual record; v jsonb; v_ids uuid[] := '{}'; n int := 0;
begin
  if auth.uid() is null then raise exception 'Sessão expirada'; end if;
  if v_id is null or v_obra is null then raise exception 'id e obra_id são obrigatórios'; end if;
  perform public.campo_assert(v_obra);
  select obra_id, criado_por, updated_at into v_atual from public.viagem_ficha where id = v_id;
  if v_atual.obra_id is not null then
    if v_atual.obra_id <> v_obra then raise exception 'Ficha de outra obra'; end if;
    if public.auth_role() in ('apoio', 'apontador') and v_atual.criado_por is distinct from auth.uid() then
      raise exception 'Ficha de outro usuário';
    end if;
    -- quem envia diz em que versão se baseou; se a ficha mudou depois, recusa em vez de apagar a mudança do outro
    if nullif(_ficha->>'versao', '') is not null and v_atual.updated_at > (_ficha->>'versao')::timestamptz then
      raise exception 'A ficha foi alterada por outra pessoa às % (depois da versão que você editou). Abra a ficha de novo e refaça a alteração.',
        to_char(v_atual.updated_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI');
    end if;
  end if;

  if coalesce((_ficha->>'excluir')::boolean, false) then
    delete from public.viagem_ficha where id = v_id;
    return jsonb_build_object('ficha_id', v_id, 'viagens', 0, 'excluida', true);
  end if;

  insert into public.viagem_ficha
    (id, obra_id, data, veiculo_id, motorista, encarregado_id, equipe_id, obs, origem)
  values
    (v_id, v_obra, (_ficha->>'data')::date, nullif(_ficha->>'veiculo_id', '')::uuid,
     nullif(_ficha->>'motorista', ''), nullif(_ficha->>'encarregado_id', '')::uuid,
     nullif(_ficha->>'equipe_id', '')::uuid, nullif(_ficha->>'obs', ''),
     coalesce(nullif(_ficha->>'origem', ''), 'campo'))
  on conflict (id) do update set
    data = excluded.data, veiculo_id = excluded.veiculo_id, motorista = excluded.motorista,
    encarregado_id = excluded.encarregado_id, equipe_id = excluded.equipe_id, obs = excluded.obs;

  for v in select * from jsonb_array_elements(coalesce(_ficha->'viagens', '[]'::jsonb)) loop
    n := n + 1;
    v_ids := v_ids || (v->>'id')::uuid;
    insert into public.viagem
      (id, ficha_id, obra_id, data, item_orcamentario_id, origem_id, destino_id, hora_carga, hora_descarga,
       quantidade, material_qtd, dmt_km, dmt_manual, nf_ticket, estaca_carga_m,
       estaca_descarga_m, obs, ordem, carregador_id)
    values
      ((v->>'id')::uuid, v_id, v_obra, (_ficha->>'data')::date, (v->>'item_orcamentario_id')::uuid,
       nullif(v->>'origem_id', '')::uuid, nullif(v->>'destino_id', '')::uuid,
       nullif(v->>'hora_carga', '')::time, nullif(v->>'hora_descarga', '')::time,
       nullif(v->>'quantidade', '')::numeric, nullif(v->>'material_qtd', '')::numeric,
       nullif(v->>'dmt_km', '')::numeric, coalesce((v->>'dmt_manual')::boolean, false),
       nullif(v->>'nf_ticket', ''), nullif(v->>'estaca_carga_m', '')::numeric,
       nullif(v->>'estaca_descarga_m', '')::numeric, nullif(v->>'obs', ''), n,
       nullif(v->>'carregador_id', '')::uuid)
    on conflict (id) do update set
      item_orcamentario_id = excluded.item_orcamentario_id, origem_id = excluded.origem_id,
      destino_id = excluded.destino_id, hora_carga = excluded.hora_carga, hora_descarga = excluded.hora_descarga,
      quantidade = excluded.quantidade,
      material_qtd = excluded.material_qtd, dmt_km = excluded.dmt_km, dmt_manual = excluded.dmt_manual,
      nf_ticket = excluded.nf_ticket, estaca_carga_m = excluded.estaca_carga_m,
      estaca_descarga_m = excluded.estaca_descarga_m, obs = excluded.obs, ordem = excluded.ordem,
      carregador_id = excluded.carregador_id
    where public.viagem.ficha_id = v_id;
  end loop;
  delete from public.viagem where ficha_id = v_id and not (id = any (v_ids));
  return jsonb_build_object('ficha_id', v_id, 'viagens', n,
                            'versao', (select updated_at from public.viagem_ficha where id = v_id));
end $$;
