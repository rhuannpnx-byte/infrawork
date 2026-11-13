# InfraWork Web: produto

Este arquivo descreve o site (`web/`) e o app de campo (`campo/`). O `PRODUCT.md` e o `DESIGN.md` da raiz descrevem o
aplicativo de desktop, que continua existindo.

## Register

product

## Quem usa

- **Engenheiro da obra.** Entra todo dia, no escritório da obra, de dia, com projeto e planilha abertos ao lado.
  Conhece o vocabulário (composição, linha de base, DMT, estaca, medição). Quer o número certo, rápido.
- **Planejador e apoio.** Passam horas no orçamento, no cronograma e no tempo-caminho, importando planilhas e
  preparando medição. Para eles a densidade das telas de trabalho importa.
- **Gestor.** Olha mais do que edita: Início (painel da obra), dashboard, valor agregado e alertas.
- **Cliente.** Só leitura do acompanhamento, sem valores do orçamento.
- **Apontador e carreteiro.** Usam o app de campo, no celular, sob sol e muitas vezes sem rede: produção do dia,
  viagens e fotos.

## Para que serve

Uma obra rodoviária num fluxo só: orçar, planejar, lançar o que foi feito e ver previsto contra realizado. O critério
de sucesso é o engenheiro abrir o Início, ver onde a obra está, ir direto ao desvio e decidir, sem montar planilha
paralela.

## Personalidade

Confiável, técnico e direto. A identidade é a "Prancheta técnica" (`DESIGN.md`): a tela parece um documento de
engenharia, com papel claro, tinta quase preta, linhas finas e um azul de carimbo como único destaque. Elementos
próprios de obra rodoviária, todos com função: o carimbo de identificação da obra, a faixa da obra (o eixo por
quilômetro com o que cada serviço já executou) e as curvas de nível nos estados vazios.

## O que não deve lembrar

- ERP tradicional: árvore de navegação funda, formulário enorme, tela cinza.
- Planilha crua: grade sem hierarquia.
- Painel corporativo genérico: grade de cartões iguais, número grande com degradê.
- App de consumo: mascote, emoji, comemoração.
- As direções visuais já avaliadas e recusadas: "Console refinado" (escuro genérico), "Rodovia" e a inspirada no
  Procore.

## Princípios

1. **Número antes de narrativa.** Avanço, valor executado, prazo e desvio são a interface; o texto vem depois e menor.
2. **Só se soma o que tem a mesma unidade.** O que junta serviços diferentes aparece em valor (R$) ou em dias, nunca
   somando m², m³ e metros. Erro de dado é mais grave que erro de aparência.
3. **Uma palavra por conceito.** Linha de base, plano, lançamento, previsto e realizado. Código do banco não vai para a
   tela.
4. **A tela diz o que falta.** Carregando, erro e vazio são estados desenhados; o vazio diz o que fazer; o erro de
   formulário aparece no campo.
5. **Hierarquia, não cartões.** Uma faixa de indicadores, blocos com título e grupos com rótulo; nada de dezoito
   blocos com o mesmo peso.
6. **Leitura confortável por padrão, densidade onde é trabalho.** Texto de 14 px no geral; cronograma, tempo-caminho e
   planilha orçamentária são compactos; quem prefere pode deixar tudo compacto.
7. **Teclado e leitor de tela contam.** Tudo o que se faz com o mouse se faz com o teclado: busca (Ctrl K), atalhos
   "G + letra", diálogos com foco preso e Esc.

## Acessibilidade

Meta: WCAG 2.2 AA. Conferência automática com o axe nas 45 rotas e nos diálogos (`scripts/acessibilidade-telas.mjs`,
`scripts/acessibilidade-dialogos.mjs`) e teste de contraste dos tokens nos dois temas (`src/styles/contraste.test.ts`).
Ficam fora do axe o mapa (Leaflet) e o interior dos gráficos.

## Site e app de campo

O site é para o escritório (monitor e notebook; em tela estreita o menu vira gaveta). O app de campo é para o
celular: alvos de toque de 44 px, tema claro para o sol, fonte e dados guardados para funcionar sem rede, e os mesmos
rótulos de envio em todas as telas (enviado, aguardando rede, enviando, erro ao enviar, recusado).
