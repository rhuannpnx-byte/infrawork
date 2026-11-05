-- InfraWork Web — capacidade (cubagem) dos veículos lida da FleetHub.
-- A sincronização lê o campo Capacidade da página de edição do equipamento: `fleet_capacidade` guarda o texto como
-- está lá (valor + unidade); quando ele se converte em m³, `capacidade_m3` passa a vir da FleetHub
-- (`capacidade_fleethub`) e deixa de ser editável aqui. Sem cubagem válida lá, vale a capacidade digitada no InfraWork.

alter table public.frota_veiculo
  add column if not exists fleet_capacidade    text,
  add column if not exists capacidade_fleethub boolean not null default false;

alter table public.fleet_sync_execucao
  add column if not exists capacidades integer;

create or replace function public.fn_frota_fleethub_protege()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.origem = 'fleethub' then
      raise exception 'Veículo da FleetHub não pode ser excluído aqui (ele volta na próxima sincronização)';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.origem = 'fleethub' or new.fleet_id is not null or new.capacidade_fleethub then
      raise exception 'Veículos da FleetHub entram só pela sincronização';
    end if;
    return new;
  end if;
  if old.origem = 'fleethub' and (
       new.origem is distinct from old.origem or new.fleet_id is distinct from old.fleet_id
    or new.prefixo is distinct from old.prefixo or new.placa is distinct from old.placa
    or new.marca is distinct from old.marca or new.modelo is distinct from old.modelo
    or new.ano is distinct from old.ano or new.fleet_tipo is distinct from old.fleet_tipo
    or new.fleet_obra_id is distinct from old.fleet_obra_id or new.fleet_status is distinct from old.fleet_status
    or new.ativo is distinct from old.ativo or new.empresa_id is distinct from old.empresa_id
    or new.fleet_capacidade is distinct from old.fleet_capacidade
    or new.capacidade_fleethub is distinct from old.capacidade_fleethub) then
    raise exception 'Este campo vem da FleetHub — altere lá e sincronize';
  end if;
  if old.capacidade_fleethub and new.capacidade_m3 is distinct from old.capacidade_m3 then
    raise exception 'A capacidade deste veículo vem da FleetHub — altere lá e sincronize';
  end if;
  if old.origem = 'manual' and (new.origem <> 'manual' or new.fleet_id is not null or new.capacidade_fleethub) then
    raise exception 'Veículos da FleetHub entram só pela sincronização';
  end if;
  return new;
end $$;
