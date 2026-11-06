-- InfraWork Web — a produção gerada pelas viagens leva a equipe e o encarregado da ficha.
-- Antes a soma do dia era por (obra, data, serviço, local) e a produção saía sem equipe. Agora cada viagem copia a
-- equipe e o encarregado da sua ficha, e a produção é uma por (obra, data, serviço, local, equipe, encarregado).

alter table public.viagem
  add column if not exists equipe_id      uuid,
  add column if not exists encarregado_id uuid;

-- a viagem segue a equipe e o encarregado da ficha
create or replace function public.fn_viagem_equipe_da_ficha()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select f.equipe_id, f.encarregado_id into new.equipe_id, new.encarregado_id
    from public.viagem_ficha f where f.id = new.ficha_id;
  return new;
end $$;
alter function public.fn_viagem_equipe_da_ficha() owner to postgres;
drop trigger if exists trg_viagem_equipe on public.viagem;
create trigger trg_viagem_equipe before insert or update on public.viagem
  for each row execute function public.fn_viagem_equipe_da_ficha();

create or replace function public.fn_viagem_ficha_depois()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.data is distinct from old.data or new.equipe_id is distinct from old.equipe_id
     or new.encarregado_id is distinct from old.encarregado_id then
    update public.viagem set data = new.data, equipe_id = new.equipe_id, encarregado_id = new.encarregado_id
     where ficha_id = new.id;
  end if;
  return null;
end $$;
alter function public.fn_viagem_ficha_depois() owner to postgres;
drop trigger if exists trg_viagem_ficha_depois on public.viagem_ficha;
create trigger trg_viagem_ficha_depois after update of data, equipe_id, encarregado_id on public.viagem_ficha
  for each row execute function public.fn_viagem_ficha_depois();

-- recomposição com equipe e encarregado na chave
drop function if exists public.fn_viagens_recompor(uuid, date, uuid, uuid);
create or replace function public.fn_viagens_recompor(
  _obra uuid, _data date, _item uuid, _trecho uuid, _equipe uuid, _enc uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tot numeric; v_n int; v_ini numeric; v_fim numeric; v_mat numeric; v_unid text;
  v_prod uuid; v_par record; v_tem_mat boolean;
begin
  select sum(quantidade), count(*), min(posicao_inicio_m), max(posicao_fim_m)
    into v_tot, v_n, v_ini, v_fim
    from public.viagem
   where obra_id = _obra and data = _data and item_orcamentario_id = _item
     and trecho_id is not distinct from _trecho
     and equipe_id is not distinct from _equipe and encarregado_id is not distinct from _enc;
  select id into v_prod from public.acompanhamento_producao
   where obra_id = _obra and data = _data and item_orcamentario_id = _item and origem = 'viagens'
     and trecho_id is not distinct from _trecho
     and equipe_id is not distinct from _equipe and encarregado_id is not distinct from _enc;

  perform set_config('infrawork.viagens_sync', '1', true);
  if coalesce(v_tot, 0) <= 0 then
    if v_prod is not null then delete from public.acompanhamento_producao where id = v_prod; end if;
    perform set_config('infrawork.viagens_sync', '', true);
    return;
  end if;
  if v_prod is null then
    insert into public.acompanhamento_producao
      (obra_id, data, item_orcamentario_id, servico_nome, quantidade, origem, trecho_id,
       posicao_inicio_m, posicao_fim_m, obs, criado_por, equipe_id, encarregado_id)
    values (_obra, _data, _item, '', v_tot, 'viagens', _trecho, v_ini, v_fim,
            v_n || case when v_n = 1 then ' viagem' else ' viagens' end, null, _equipe, _enc)
    returning id into v_prod;
  else
    update public.acompanhamento_producao
       set quantidade = v_tot, posicao_inicio_m = v_ini, posicao_fim_m = v_fim,
           obs = v_n || case when v_n = 1 then ' viagem' else ' viagens' end
     where id = v_prod;
  end if;

  select material_recurso_id, material_unidade into v_par
    from public.servico_parametro
   where item_orcamentario_id = _item and controla_material;
  v_tem_mat := found and v_par.material_recurso_id is not null;
  delete from public.acompanhamento_producao_material where producao_id = v_prod;
  if v_tem_mat then
    select unidade into v_unid from public.acompanhamento_producao where id = v_prod;
    select sum(coalesce(material_qtd,
                        case when lower(coalesce(v_par.material_unidade, '')) = lower(coalesce(v_unid, ''))
                             then quantidade end))
      into v_mat
      from public.viagem
     where obra_id = _obra and data = _data and item_orcamentario_id = _item
       and trecho_id is not distinct from _trecho
       and equipe_id is not distinct from _equipe and encarregado_id is not distinct from _enc;
    if v_mat is not null then
      insert into public.acompanhamento_producao_material (producao_id, recurso_id, nome, quantidade, unidade)
      values (v_prod, v_par.material_recurso_id, '', v_mat, v_par.material_unidade);
    end if;
  end if;
  perform set_config('infrawork.viagens_sync', '', true);
end $$;
alter function public.fn_viagens_recompor(uuid, date, uuid, uuid, uuid, uuid) owner to postgres;
revoke all on function public.fn_viagens_recompor(uuid, date, uuid, uuid, uuid, uuid) from public;

create or replace function public.fn_viagem_depois()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.fn_viagens_recompor(old.obra_id, old.data, old.item_orcamentario_id, old.trecho_id,
                                       old.equipe_id, old.encarregado_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.fn_viagens_recompor(new.obra_id, new.data, new.item_orcamentario_id, new.trecho_id,
                                       new.equipe_id, new.encarregado_id);
  end if;
  return null;
end $$;
alter function public.fn_viagem_depois() owner to postgres;

-- equipe e encarregado da produção das viagens vêm da ficha (limpar por exclusão em cascata passa)
create or replace function public.fn_acomp_prod_viagens_equipe()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.origem = 'viagens' and coalesce(current_setting('infrawork.viagens_sync', true), '') <> '1'
     and ((new.equipe_id is distinct from old.equipe_id and new.equipe_id is not null)
       or (new.encarregado_id is distinct from old.encarregado_id and new.encarregado_id is not null)) then
    raise exception 'A equipe e o encarregado da produção das viagens vêm da ficha — altere na ficha';
  end if;
  return new;
end $$;
drop trigger if exists trg_acomp_prod_viagens_equipe on public.acompanhamento_producao;
create trigger trg_acomp_prod_viagens_equipe before update of equipe_id, encarregado_id
  on public.acompanhamento_producao for each row execute function public.fn_acomp_prod_viagens_equipe();

-- ═══ dados existentes ═════════════════════════════════════════════════════════════════════════════
drop index if exists public.uq_acomp_prod_viagens;

-- produção cujas viagens são todas de uma só equipe/encarregado: recebe os dois no lugar (mantém o id)
select set_config('infrawork.viagens_sync', '1', true);
update public.acompanhamento_producao p
   set equipe_id = u.equipe_id, encarregado_id = u.encarregado_id
  from (
    select v.obra_id, v.data, v.item_orcamentario_id, v.trecho_id,
           max(f.equipe_id::text)::uuid as equipe_id, max(f.encarregado_id::text)::uuid as encarregado_id
      from public.viagem v join public.viagem_ficha f on f.id = v.ficha_id
     group by 1, 2, 3, 4
    having count(distinct coalesce(f.equipe_id::text, '') || '|' || coalesce(f.encarregado_id::text, '')) = 1
  ) u
 where p.origem = 'viagens' and p.obra_id = u.obra_id and p.data = u.data
   and p.item_orcamentario_id = u.item_orcamentario_id and p.trecho_id is not distinct from u.trecho_id
   and (p.equipe_id is distinct from u.equipe_id or p.encarregado_id is distinct from u.encarregado_id);
select set_config('infrawork.viagens_sync', '', true);

-- as viagens recebem a equipe da ficha; o gatilho recompõe (e separa as produções de várias equipes)
update public.viagem v
   set equipe_id = f.equipe_id, encarregado_id = f.encarregado_id
  from public.viagem_ficha f
 where f.id = v.ficha_id
   and (v.equipe_id is distinct from f.equipe_id or v.encarregado_id is distinct from f.encarregado_id);

create unique index if not exists uq_acomp_prod_viagens on public.acompanhamento_producao
  (obra_id, data, item_orcamentario_id,
   coalesce(trecho_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(equipe_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(encarregado_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where origem = 'viagens';
