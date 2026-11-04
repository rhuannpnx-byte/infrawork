-- InfraWork — WhatsApp: evita duplicar serviço na legenda do mapa
--
-- O mapa de fotos colore/agrupa por siga_servico_id (corDeServico). A versão
-- anterior de whatsapp_registrar_foto SEMPRE criava um id sintético (negativo)
-- por serviço, então uma foto de CBUQ do WhatsApp ganhava um id diferente do
-- vínculo SIGA real de CBUQ — gerando uma 2ª entrada "CBUQ" na legenda.
--
-- Correção: se o serviço já tem um match (vínculo) existente na obra, a foto
-- REUTILIZA aquele siga_servico_executado_id (preferindo o id real positivo),
-- agrupando junto com as fotos do mobile. Só cria id sintético quando o
-- serviço nunca teve vínculo.

create or replace function public.whatsapp_registrar_foto(
  _grupo_id      uuid,
  _obra_id       uuid,
  _servico_id    uuid,
  _servico_nome  text,
  _lat           numeric,
  _lng           numeric,
  _captured_at   timestamptz,
  _storage_key   text,
  _mime          text,
  _size_bytes    bigint,
  _wa_message_id text,
  _remetente     text,
  _ai            jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  _synthetic bigint;
  _foto_id   uuid;
  _existente uuid;
begin
  -- dedup: se já processada, devolve a foto associada sem reinserir
  select foto_id into _existente
    from public.whatsapp_mensagem_log where wa_message_id = _wa_message_id;
  if found then
    return _existente;
  end if;

  if _servico_id is not null then
    -- 1. Reutiliza um match existente desse serviço (prefere id real positivo).
    select siga_servico_executado_id into _synthetic
      from public.acompanhamento_servico_match
     where obra_id = _obra_id
       and servico_id = _servico_id
       and origem <> 'rejeitado'
     order by case when siga_servico_executado_id >= 0 then 0 else 1 end,
              siga_servico_executado_id
     limit 1;

    -- 2. Sem vínculo existente: cria id sintético próprio (negativo) + match.
    if _synthetic is null then
      insert into public.whatsapp_servico_id_map (obra_id, servico_id)
      values (_obra_id, _servico_id)
      on conflict (obra_id, servico_id) do nothing;

      select synthetic_siga_id into _synthetic
        from public.whatsapp_servico_id_map
       where obra_id = _obra_id and servico_id = _servico_id;

      insert into public.acompanhamento_servico_match
        (obra_id, siga_servico_executado_id, siga_servico_nome, servico_id, origem, confirmado_em)
      values (_obra_id, _synthetic, _servico_nome, _servico_id, 'auto', now())
      on conflict (obra_id, siga_servico_executado_id) do update
        set servico_id = excluded.servico_id,
            siga_servico_nome = excluded.siga_servico_nome;
    end if;
  end if;

  insert into public.acompanhamento_foto (
    obra_id, siga_foto_id, lat, lng, servico_executado_id, servico_executado_nome,
    captured_at, storage_bucket, storage_key, mime, size_bytes, payload_bruto
  ) values (
    _obra_id, nextval('public.seq_whatsapp_foto_id'), _lat, _lng, _synthetic, _servico_nome,
    _captured_at, 'monito-fotos', _storage_key, _mime, _size_bytes,
    jsonb_build_object('fonte', 'whatsapp', 'wa_message_id', _wa_message_id,
                       'remetente', _remetente, 'ai', _ai)
  ) returning id into _foto_id;

  insert into public.whatsapp_mensagem_log
    (grupo_id, wa_message_id, remetente, decisao, foto_id, ai_resultado)
  values (_grupo_id, _wa_message_id, _remetente, 'subida', _foto_id, _ai)
  on conflict (wa_message_id) do nothing;

  return _foto_id;
end $$;
