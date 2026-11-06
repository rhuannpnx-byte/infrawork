# Colocar uma obra e a equipe em campo

Passo a passo para o administrador (adm) e o engenheiro da obra. Sistema web: https://infrawork-web.vercel.app ·
app de campo (celular): https://infrawork-campo.vercel.app

## 1. Usuários (adm)

1. **Gerencial › Usuários › Novo usuário**: e-mail, nome, papel e a **senha inicial** (botão **Gerar** cria uma fácil de
   ditar). Ainda não há envio de e-mail: passe o e-mail e a senha à pessoa.
   - **Engenheiro**: planeja e acompanha as obras liberadas a ele (no app, também a Visão estratégica).
   - **Apoio**: ajuda um engenheiro (lê o planejamento, lança produção).
   - **Apontador**: só usa o app de campo.
   - **Cliente**: acompanha o avanço, sem ver preços.
2. **Gerencial › Obras › (obra) › Conceder acesso**: libere a obra ao engenheiro (e ao cliente, se houver).
3. Esqueceu a senha? Na lista de usuários, ícone de chave (**Redefinir senha**). Saiu da empresa? **Editar › Inativo**:
   o acesso cai na hora, inclusive no celular.

## 2. Obra pronta para o campo (engenheiro)

1. **Orçamento**: planilha importada e cada serviço ligado à sua composição (é a composição que dá a produção por dia).
2. **Planejamento › Parametrização**: como cada serviço é lançado no campo (quantidade ou viagens), se controla material,
   se exige local e estacas. Nos serviços por viagens, a **Medição da viagem**: volume (m³ da caçamba; sem valor vale a
   capacidade do caminhão) ou peso (t do ticket, que passa a ser obrigatório), e o fator para a unidade do serviço
   (argila medida no corte com caçamba solta: 0,8; CBUQ em t: 1; CBUQ em m³: 1 ÷ 2,4).
3. **Planejamento › Calendário**: semana de trabalho, feriados ("Nacionais") e dias parados — clique ou arraste nos dias
   da prévia para editar.
4. **Planejamento › Locais**: o eixo da obra (estaca inicial e final) e as áreas.
5. **Cronograma**: tarefas e dependências; o cálculo roda ao abrir a tela.
6. No **Cronograma**, com o plano em edição aberto e o cálculo em dia, **Travar como linha de base** (com **Tornar
   vigente**). O seletor do plano, no topo, alterna entre o plano em edição e as linhas de base; com uma linha de base
   aberta, a faixa de somente leitura oferece editar a partir dela, tornar vigente e restaurar. Sem linha de base
   vigente o acompanhamento não tem previsto — as telas avisam.
7. **Acompanhamento › Equipes & Encarregados**: cadastre as equipes e depois os encarregados, marcando no encarregado
   as **Equipes** dele (ou escolha o **Encarregado** no cadastro da equipe). No app, o apontador escolhe o encarregado e
   vê só as equipes dele. Se houver transporte, **Acompanhamento › Origens e destinos**: a **Pista** (tipo pista, com o
   trecho; a viagem informa a estaca) e cada jazida, caixa de empréstimo, bota-fora, usina… com o trecho, a **estaca
   do acesso** (onde o acesso encontra o eixo) e a **distância do acesso** (km do local ao eixo). A DMT da viagem é
   calculada: acesso da origem + distância entre as estacas + acesso do destino. Para o par que não se liga pelo eixo
   (usina distante, outro trecho), cadastre a **distância fixa**, que vale no lugar do cálculo.
8. **Frota**: em **Gerencial › Frota**, se a empresa usa a FleetHub, o adm toca em **Conectar FleetHub** e digita o
   e-mail e a senha de lá (o login é testado e a senha fica cifrada no servidor); depois **Sincronizar agora** (também
   roda sozinho às 5h). Sem FleetHub, cadastre os veículos em **Cadastro manual**. Vêm os caminhões, carretas, pipas e as escavadeiras/carregadeiras ativos, com a
   **cubagem (m³)** do campo Capacidade da FleetHub (selo FH; só muda lá). Onde a FleetHub está em toneladas, vazia ou
   sem sentido (⚠ com o valor de lá), corrija na FleetHub ou digite a capacidade aqui e use o ícone de copiar para
   aplicar ao mesmo modelo. Em **Gerencial › Obras › (obra) › Editar dados**,
   marque a(s) **Obra(s) na FleetHub**: as viagens da obra passam a mostrar só esses veículos.

## 3. Apontadores

1. Engenheiro ou adm: **Gerencial › Usuários**, na linha do apontador, ícone de prédio (**Obras liberadas**) — marque a
   obra.
2. No celular (Android, Chrome): abrir https://infrawork-campo.vercel.app, entrar com e-mail e senha e usar **Instalar**
   (ou menu do Chrome › Adicionar à tela inicial). Abrir o app uma vez com internet para baixar os dados da obra.
3. Pronto: o app funciona sem sinal e envia sozinho quando a rede volta. Com uma obra só, ela já vem selecionada.

## 4. No dia a dia

- **Produção**: Nova sessão → serviço → quantidade (local e estacas quando o serviço pede) → Finalizar. A sessão em
  andamento fica salva no celular mesmo se o app fechar. Lançamento recusado aparece em vermelho com o motivo — tocar,
  corrigir, finalizar de novo.
- **Viagens**: ficha do caminhão do dia e as viagens: origem e destino, estaca de carga e/ou de descarga quando a
  ponta é a pista, volume da caçamba ou peso do ticket (conforme o serviço) e a máquina que carregou. A DMT e a
  quantidade aparecem calculadas; a DMT pode ser ajustada na viagem (fica marcada como ajustada, com a calculada ao
  lado). Não há hodômetro.
- **Fotos**: com GPS quando houver; sem sinal de GPS a foto sai sem coordenadas.
- **Escritório**: Acompanhamento › Produção, Previsto × Realizado, Dashboard, Fotos & Mapa. Correções feitas no web
  não são desfeitas pelo celular.
- **Medição**: Acompanhamento › Valor Agregado › Exportar .xlsx. Nos serviços lançados por viagens, a memória de
  cálculo é o quadro de distribuição das viagens (origem → destino com as estacas de carga e de descarga, nº de
  viagens, volume/peso lançado, volume medido, DMT, momento e faixa de DMT), com o resumo por faixa e a relação viagem
  a viagem (com a origem de cada DMT: pelo eixo, distância fixa ou ajustada).
- **Visão estratégica (engenheiro, adm)**: no app, o cartão **Visão estratégica** abre o resumo da obra (avanço
  físico × esperado, valor executado × previsto, curva S), a lista de **Serviços** (atrasados primeiro, com o detalhe
  de cada um), **Produção** (mapa de calor da produção diária por serviço, encarregado e equipe) e **Equipes** (quem lançou hoje e quem trabalhou na semana e ainda não lançou). Sem sinal, mostra os
  dados da última atualização com a data; tocar em atualizar com internet traz os lançamentos novos. Apontadores e
  apoio não veem essa área.
- **Atualização do app**: aparece a faixa "Nova versão disponível — Atualizar"; nada lançado se perde ao atualizar.

## Ainda não disponível

Medições (boletim), Parte Diária de equipamentos, Diário de Obra e e-mails automáticos (convite e "esqueci a senha").
