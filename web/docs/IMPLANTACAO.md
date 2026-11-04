# Colocar uma obra e a equipe em campo

Passo a passo para o administrador (adm) e o engenheiro da obra. Sistema web: https://infrawork-web.vercel.app ·
app de campo (celular): https://infrawork-campo.vercel.app

## 1. Usuários (adm)

1. **Gerencial › Usuários › Novo usuário**: e-mail, nome, papel e a **senha inicial** (botão **Gerar** cria uma fácil de
   ditar). Ainda não há envio de e-mail: passe o e-mail e a senha à pessoa.
   - **Engenheiro**: planeja e acompanha as obras liberadas a ele.
   - **Apoio**: ajuda um engenheiro (lê o planejamento, lança produção).
   - **Apontador**: só usa o app de campo.
   - **Cliente**: acompanha o avanço, sem ver preços.
2. **Gerencial › Obras › (obra) › Conceder acesso**: libere a obra ao engenheiro (e ao cliente, se houver).
3. Esqueceu a senha? Na lista de usuários, ícone de chave (**Redefinir senha**). Saiu da empresa? **Editar › Inativo**:
   o acesso cai na hora, inclusive no celular.

## 2. Obra pronta para o campo (engenheiro)

1. **Orçamento**: planilha importada e cada serviço ligado à sua composição (é a composição que dá a produção por dia).
2. **Planejamento › Parametrização**: como cada serviço é lançado no campo (quantidade ou viagens), se controla material,
   se exige local e estacas.
3. **Planejamento › Calendário**: semana de trabalho, feriados ("Nacionais") e dias parados — clique ou arraste nos dias
   da prévia para editar.
4. **Planejamento › Locais**: o eixo da obra (estaca inicial e final) e as áreas.
5. **Cronograma**: tarefas e dependências; o cálculo roda ao abrir a tela.
6. **Planejamento › Planos e linhas de base › Travar como linha de base** (com **Tornar vigente**). Sem linha de base
   vigente o acompanhamento não tem previsto — as telas avisam.
7. **Acompanhamento › Equipes & Encarregados** e, se houver transporte, **Gerencial › Frota** e **Acompanhamento ›
   Origens e destinos**.

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
- **Viagens**: ficha do caminhão do dia e as viagens (origem, destino, estaca, quantidade).
- **Fotos**: com GPS quando houver; sem sinal de GPS a foto sai sem coordenadas.
- **Escritório**: Acompanhamento › Produção, Previsto × Realizado, Dashboard, Fotos & Mapa. Correções feitas no web
  não são desfeitas pelo celular.
- **Atualização do app**: aparece a faixa "Nova versão disponível — Atualizar"; nada lançado se perde ao atualizar.

## Ainda não disponível

Medições (boletim), Parte Diária de equipamentos, Diário de Obra e e-mails automáticos (convite e "esqueci a senha").
