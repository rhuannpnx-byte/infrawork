# Parametrização dos serviços, viagens e app de campo — decisões

Migrações `20260701000033_papel_apontador.sql` e `20260701000034_parametrizacao_campo.sql`; app em `../campo`.

## C-01 Parametrização por serviço do orçamento, fora da trava da cadeia

A chave é o agrupador (`item_orcamentario` tipo `servico_grupo`) — é o que se lança e o que o cronograma controla.
Tabela própria (`servico_parametro`) e não colunas em `servico`: a trava da cadeia (`trg_cadeia_trava`) bloquearia a
edição com plano vigente, e parametrizar o lançamento não mexe em custo. Sem linha = padrão (quantidade, sem material,
observação sim, local livre).

## C-02 Material controlado e média por unidade produzida

O material aplicado passa a apontar o recurso (`acompanhamento_producao_material.recurso_id`; nome/unidade ficam como
retrato). A média é Σ material ÷ Σ produção dos lançamentos que informaram o material
(`vw_servico_consumo_material`); a tela de parametrização mostra ao lado o previsto da composição
(`consumo_material_por_unid` com fator/operação do vínculo serviço → CPU). A obrigatoriedade do material é conferida
nas telas e na RPC do app; o banco não a exige num gatilho porque o web grava lançamento e materiais em duas chamadas.

## C-03 Viagens viram a produção do dia no banco

`viagem_ficha` (caminhão no dia) + `viagem`. O gatilho `fn_viagens_recompor` mantém uma produção `origem='viagens'`
por (obra, dia, serviço, local) = Σ das viagens; faixa = mín–máx das estacas; material = Σ `material_qtd` (ou a própria
quantidade quando a unidade do material é a do serviço). Assim cronograma, Curva-S, Previsto × Realizado e o controle
por estaca não mudam. A produção das viagens só muda pelas viagens (lançar ou alterar à mão é recusado; exclusões em
cascata passam). Serviço em modo viagens recusa lançamento manual.

A estaca da viagem vale para a ponta que está na obra: o destino (aterro, base) ou, senão, a origem (corte da
escavação). Uma descarga numa estaca só (faixa de comprimento zero) é apontada à tarefa cujo local contém o ponto
(`repartirProducao`).

## C-04 Viagens simples + DMT (sem as regras do SIGA)

Do Monito ficaram as telas e o fluxo (cabeçalho → viagens → revisão; "nova viagem" repete o padrão do dia). Saíram
contratos por caminhão, preço, garantia, DT calculado por estaca, ficha numerada e rodoviário/urbano. O DMT da viagem
vem da rota cadastrada (`transporte_rota`) e pode ser editado.

## C-05 Frota por empresa; origens e destinos por obra

`frota_veiculo` é da empresa (o caminhão circula entre obras). `transporte_local` é da obra (jazida, usina, central,
bota-fora, depósito, pista, outro) e pode apontar um local da obra (`trecho_id`) — na pista a viagem informa a estaca.

## C-06 Papel apontador

Novo valor do `role_enum` (migração isolada, exigência do `add value`). Permissão direta em `obra_permissoes` (adm
libera; engenheiro libera apontadores nas obras em que ele tem permissão). Pode lançar (`pode_lancar_producao`), só
altera o que criou, não lê orçamento nem planejamento, e o sistema web mostra "use o app de campo". No Storage só
insere (sem `upsert`): reenviar uma foto cai em "já existe" e conta como enviada.

## C-07 App de campo = cópia do Monito com outra camada de dados

Ficaram PWA (service worker injectManifest, app shell offline), Dexie, filas, motor de envio em primeiro plano,
câmera com marca d'água, GPS, componentes e visual. Saíram Capacitor/APK/OTA, Parte Diária e o background sync do
service worker (com o Supabase o motor do app é dono das filas; todas as escritas são idempotentes). O catálogo é um
snapshot por obra (`campo_catalogo`, sem preços), renovado quando a `versao` (hash) muda.

## C-08 Divergências conhecidas

- Encarregado e equipe não são vinculados entre si (no SIGA eram por projeto); o apontador escolhe livremente.
- Mudar o modo de um serviço que já tem produção manual vale só para os lançamentos novos.
- Parte Diária (horímetro de MVE/EPP) fica para uma próxima etapa.

## C-09 Visão estratégica no app (supervisor)

Quem vê: **engenheiro, adm e god** (o "supervisor" é o engenheiro no app; sem papel novo). Apontador e apoio ficam só
com o lançamento; o cliente continua sem acesso ao app. A área some da home para os demais e as rotas `/painel*`
redirecionam, mas a trava de verdade é no servidor (`campo_assert_painel`: papel + `pode_ver_acompanhamento`), porque
o papel guardado no aparelho pode estar desatualizado.

Os dados vêm de um retrato agregado por RPC (`campo_painel`, migração 0037): avanço físico e esperado, valor
agregado, curva S semanal, serviços, equipes, encarregados e os 30 últimos lançamentos (~17 KB por obra, sem linhas
cruas). O valor executado e o previsto seguem a mesma regra do Valor Agregado do web (`valor-agregado-calc.ts`:
preço do dia com reajuste prospectivo, sem agregar acima da quantidade do contrato), portada para SQL em
`fn_valor_servico_em`; a paridade é conferida pelo e2e (seção 12).

Offline: o último retrato fica no aparelho (`cat_painel`, só regravado quando a `versao` muda) e abre sem sinal com a
data dos dados; amarelo depois de 24 h. Renova ao abrir o app, ao voltar a rede, ao tocar em Atualizar e, no ciclo
comum, no máximo a cada 5 min — só da obra atual. Perder o acesso apaga o retrato daquela obra.

## C-10 Frota vinda da FleetHub

A FleetHub não tem API: a função `fleethub-sync` entra com a conta da empresa e lê a página de Equipamentos
(só leitura; Ativo e Em transferência). Entram os equipamentos de transporte de carga e as máquinas de carga
(escavadeira, retroescavadeira, carregadeira). A FleetHub é dona de código, placa, marca, modelo, ano, obra e status; o
InfraWork, de proprietário, fornecedor e tipo (gatilho impede editar o resto). Quem some da FleetHub é
inativado, nunca apagado. Formato inesperado ou lista vazia abortam a rodada sem mexer na frota.

Cubagem (0041): a rodada abre a página de edição de cada veículo com caçamba ou tanque (GET; o formulário nunca é
enviado) e lê o campo Capacidade (texto livre + unidade salva). Vira `capacidade_m3` (`capacidade_fleethub`, só muda
lá) quando é m³ ou sem unidade (litros ÷ 1000) e fica entre 2 e 60 m³; toneladas, vazio ou lixo ("1", "*.*") não
contam e a capacidade digitada no InfraWork vale. O texto original fica em `fleet_capacidade`. Cavalo mecânico e
máquinas de carga não são lidos. Sem acesso à página de edição, a capacidade não é tocada.

O vínculo obra ↔ obra FleetHub é feito no InfraWork (`obra_fleet_obra`); com ele, viagens (web e app) mostram só os
veículos dessas obras e os manuais (`veiculos_da_obra`). A viagem registra a máquina que carregou (`carregador_id`).

Credenciais por empresa: o adm conecta pela tela; a função testa o login e grava a senha no Vault (`fleethub_config`
guarda só o e-mail e a referência). Só o serviço lê a senha (`fleethub_credencial`, service_role); o cron percorre as
empresas conectadas. Empresa sem FleetHub cadastra a frota à mão.
