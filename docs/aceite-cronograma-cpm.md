# Checklist de aceite — Cronograma / Motor CPM (2026-06)

Lista de cenários pra validar manualmente depois do deploy da reescrita do motor CPM (dia-a-dia + constraints MS Project completos + ConstraintPopover). Marque cada item com ✅ OK ou ❌ FAIL (com print/descrição).

Pré-requisito: tarefas com `quantidade_alocada` corrompida pelo bug parseBR antigo já foram deletadas (vide `supabase/snippets/diag-tarefas-qtd-corrompida.sql`).

## 1. Criação de tarefa básica

- [ ] Abrir cronograma de uma obra; clicar **+ Adicionar**.
- [ ] Aba **Tarefas**: escolher item orçado → quantidade alocada vem pré-preenchida com o restante.
- [ ] Trecho vem default (primeiro da obra); data início vem default = âncora do planejamento.
- [ ] Confirmar: tarefa nasce na Gantt, sem erro 400/CORS, recalc dispara automático.
- [ ] **Regression do parseBR**: criar tarefa com qtd `13750.00` → no banco fica `13750`, não `1375000`.

## 2. Constraints MS Project (6 tipos + 2 modes)

Pra cada tipo, criar tarefa COM o tipo de restrição preenchido na seção colapsável do modal:

- [ ] **MSO (Deve iniciar em)**: data alvo → ES da tarefa = data alvo.
- [ ] **MFO (Deve terminar em)**: data alvo → LF/data_fim = data alvo (pode gerar warning se predecessoras conflitam).
- [ ] **SNET (Não iniciar antes de)**: data alvo → ES ≥ data alvo (mesmo se predecessoras permitiriam antes).
- [ ] **SNLT (Não iniciar depois de)** ← NOVO: data alvo → LS ≤ data alvo; se predecessoras empurram ES > LS, TF fica negativo + tarefa vira crítica.
- [ ] **FNET (Não terminar antes de)** ← NOVO: data alvo → dataFim ≥ data alvo (atrasa início pra cumprir).
- [ ] **FNLT (Não terminar depois de)**: data alvo → LF ≤ data alvo.

Schedule modes:

- [ ] **ASAP** (default): tarefa agendada no early start.
- [ ] **ALAP**: tarefa com folga (TF > 0) → barra shifta pra direita; badge "ALAP" aparece ao lado do nome.

## 3. Edição posterior de restrição

- [ ] Right-click numa barra → menu mostra **"Restrição..."**.
- [ ] Click abre ConstraintPopover ancorado na linha; pré-preenchido com o estado atual.
- [ ] Trocar tipo de restrição + salvar → ícone ⚓ aparece na coluna nome.
- [ ] Botão **"Limpar"** zera restrição + schedule_mode pra ASAP.
- [ ] Recalc dispara automático após salvar — ES/EF mudam conforme nova restrição.

## 4. Indicadores visuais

- [ ] Tarefa com restrição: ícone ⚓ azul ao lado do nome, tooltip mostra "Não iniciar antes de 2026-08-15" (ou similar).
- [ ] Tarefa com schedule_mode='alap' e TF > 0: badge "ALAP" pequeno ao lado do nome.
- [ ] Tarefa crítica (TF ≤ 0): número da tarefa em vermelho.

## 5. Cálculo de duração dia-a-dia

- [ ] Tarefa com qtd=7500, prod=79/dia, 1 equipe, fator_mes = 1.0 em todos os meses cruzados: duração ≈ ceil(7500/79) ≈ 95 dias úteis.
- [ ] Tarefa cruzando virada de mês com fator_mes < 1.0 num mês: duração reflete a média ponderada (mais curta que o pior fator, mais longa que o melhor).
- [ ] Fresagem específica que estava em 125d antes deve cair pra ~95d depois do "Recalcular".

## 6. qtd_link (vínculo com template do trecho)

Pré-requisito: o trecho da tarefa tem template com colunas configuradas.

- [ ] Clicar no ícone 🔗 cinza ao lado da quantidade → abre QtdLinkPopover.
- [ ] Selecionar uma métrica → ícone vira azul, célula vira readonly, valor recalculado por `computeLinkedQtd`.
- [ ] Mudar `posicao_inicio_m` ou `posicao_fim_m` da tarefa → próximo recalc atualiza qtd.
- [ ] Desvincular (botão "Desvincular") → volta pra modo manual com o último valor calculado.

## 7. Dependências

- [ ] Drag entre 2 tarefas cria predecessora FS com lag=0.
- [ ] Right-click na seta de dependência → DepContextMenu permite trocar tipo (FS/SS/FF/SF) e lag.
- [ ] Removendo dependência via popover dispara recalc automático.
- [ ] Predecessora num ciclo é rejeitada com mensagem clara.

## 8. Reordenação e EAP

- [ ] Drag vertical numa linha → reordena. Cross-group: dropar dentro de grupo move pra dentro; dropar fora move pra fora.
- [ ] Reordenar grupos do nível 1: mantém hierarquia interna intacta.

## 9. Recalcular e warnings

- [ ] Botão "Recalcular" no header dispara request edge function.
- [ ] Após recalc, badge "X pendência(s)" no header reflete o número de warnings (constraints violadas, drift, free_float negativo).
- [ ] Click em "Revisar" abre listagem de pendências.

## 10. CORS error guard (regression Fase 2)

- [ ] Rodar `bash supabase/tests/calcular-cronograma.smoke.sh` → todos os testes verdes.
- [ ] Tentar trigger de erro (ex: deletar planejamento durante recalc): resposta de erro vem com CORS header → mensagem visível no console, sem "blocked by CORS" genérico.

## 11. Limpeza de tarefas corrompidas (one-off Fase 4)

- [ ] Rodar `supabase/snippets/diag-tarefas-qtd-corrompida.sql` no Supabase Studio.
- [ ] Lista vazia se já não há corrompidas; caso contrário deletar pela UI (right-click → Excluir).
- [ ] Recriar pelo "+ Adicionar" — agora com `Number()` correto, valores não inflam.

---

## Como reportar regressão

Pra cada item ❌ FAIL:
- Print da tela (Win+Shift+S) ou inspeção do console (F12).
- Reproduzir os passos mínimos.
- Anotar abaixo do checkbox ou abrir issue.
