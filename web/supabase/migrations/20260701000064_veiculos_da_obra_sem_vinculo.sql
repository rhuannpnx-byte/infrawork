-- Obra sem vínculo com a FleetHub não enxerga mais a frota inteira da FleetHub (obra nova via ~1.200 equipamentos
-- antes de ser ligada a uma obra de lá). Agora: os veículos cadastrados à mão no InfraWork sempre; os da FleetHub só
-- os das obras da FleetHub vinculadas à obra (obra_fleet_obra). Vale para o web, o app de campo (campo_catalogo) e o
-- MCP, que leem a mesma função. Fichas antigas continuam mostrando o veículo que citam (o web busca pelo id).
create or replace function public.veiculos_da_obra(_obra_id uuid)
returns setof public.frota_veiculo
language sql stable
set search_path to 'public'
as $$
  select v.*
    from public.frota_veiculo v
   where v.ativo
     and v.empresa_id = public.obra_empresa(_obra_id)
     and (
       v.origem = 'manual'
       or v.fleet_obra_id in (select x.fleet_obra_id from public.obra_fleet_obra x where x.obra_id = _obra_id)
     )
$$;
