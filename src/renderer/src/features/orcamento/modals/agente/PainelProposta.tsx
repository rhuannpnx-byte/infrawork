// Painel central do workbench — a proposta de agrupamento, editável, com
// destaque "ao vivo" do que o agente mudou no último turno (diff verde/vermelho)
// e realce do serviço selecionado no painel de cobertura (à esquerda).

import { useEffect, useRef, type ReactNode } from 'react'
import {
  Sparkles,
  X,
  Check,
  AlertTriangle,
  Loader2,
  Package,
  Ban,
  Info,
  Folder
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { fmtBRL, fmtQtd } from '@/lib/money'
import type { ReceitaNaoAgrupada, QtdRefModoAgente } from '@/types/agrupamento'
import type { Servico, ServicoCustoAgregado } from '@/types/orcamento'
import { confiancaBadge, PAPEL_LABEL, type GrupoVM, type OmissoNode } from './agente-shared'
import type { DiffResult } from './diff'

/** Linhas da árvore da EAP dos itens omissos (recursivo, indentado por nível). */
function OmissoRows({ nodes, depth }: { nodes: OmissoNode[]; depth: number }): ReactNode {
  return (
    <>
      {nodes.map((n) =>
        n.tipo === 'etapa' ? (
          <div key={n.id}>
            <div
              style={{ paddingLeft: depth * 14 + 4 }}
              className="flex items-center gap-1.5 py-1 text-2xs font-mono text-text-dim uppercase tracking-wide"
            >
              <Folder size={11} className="text-text-faint shrink-0" />
              <span className="truncate">
                {n.codigo} {n.descricao}
              </span>
            </div>
            <OmissoRows nodes={n.children} depth={depth + 1} />
          </div>
        ) : (
          <div
            key={n.id}
            style={{ paddingLeft: depth * 14 + 4 }}
            className="flex items-center gap-2 py-1 text-xs border-t border-border/40"
          >
            <span className="text-text-muted font-mono w-20 truncate shrink-0">{n.codigo}</span>
            <span className="text-text flex-1 truncate">{n.descricao}</span>
            <span className="text-2xs font-mono text-text-dim shrink-0 tabular-nums">
              {fmtBRL(n.venda ?? 0)}
            </span>
          </div>
        )
      )}
    </>
  )
}

interface Props {
  grupos: GrupoVM[]
  naoAgrupados: ReceitaNaoAgrupada[]
  avisos: string[]
  servicosFolha: Servico[]
  custoPorServico: Map<string, ServicoCustoAgregado>
  qtdPorReceita: Map<string, number>
  omissosTree: OmissoNode[]
  diff: DiffResult | null
  servicoSelecionadoId: string | null
  hasResp: boolean
  trabalhando: boolean
  busy: boolean
  applyingKey: string | null
  computeQtd: (g: GrupoVM) => number
  onGerarInicial: () => void
  onPatchGrupo: (key: string, patch: Partial<GrupoVM>) => void
  onMudarModo: (key: string, modo: QtdRefModoAgente) => void
  onEscolherHeranca: (key: string, receitaId: string) => void
  onToggleSomaFilho: (key: string, receitaId: string) => void
  onRemoverReceita: (key: string, receitaId: string) => void
  onMudarServico: (key: string, servicoId: string) => void
  onAplicarGrupo: (g: GrupoVM) => void
  onRejeitarGrupo: (g: GrupoVM) => void
}

export function PainelProposta({
  grupos,
  naoAgrupados,
  avisos,
  servicosFolha,
  custoPorServico,
  qtdPorReceita,
  omissosTree,
  diff,
  servicoSelecionadoId,
  hasResp,
  trabalhando,
  busy,
  applyingKey,
  computeQtd,
  onGerarInicial,
  onPatchGrupo,
  onMudarModo,
  onEscolherHeranca,
  onToggleSomaFilho,
  onRemoverReceita,
  onMudarServico,
  onAplicarGrupo,
  onRejeitarGrupo
}: Props): ReactNode {
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const selAnteriorRef = useRef<string | null>(null)

  // Rola até o grupo APENAS quando a seleção de serviço (na cobertura) muda —
  // não a cada edição de grupo, para não tirar o usuário do lugar no meio de
  // várias ações seguidas.
  useEffect(() => {
    if (servicoSelecionadoId && servicoSelecionadoId !== selAnteriorRef.current) {
      const alvo = grupos.find((g) => g.servico_id === servicoSelecionadoId)
      if (alvo) {
        cardRefs.current.get(alvo.key)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
    selAnteriorRef.current = servicoSelecionadoId
  }, [servicoSelecionadoId, grupos])

  // Estado vazio (antes da 1ª proposta)
  if (!hasResp && !trabalhando) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
        <div className="w-12 h-12 rounded-full bg-accent-glow flex items-center justify-center">
          <Sparkles size={22} className="text-accent" />
        </div>
        <div className="text-sm text-text">Pronto para analisar o orçamento</div>
        <p className="text-xs text-text-muted max-w-sm leading-relaxed">
          O agente lê as CPUs dos serviços e cruza com as receitas soltas para propor os
          agrupamentos. Você revisa, conversa e ajusta até ficar do seu jeito.
        </p>
        <Button variant="default" size="md" onClick={onGerarInicial} disabled={busy}>
          <Sparkles size={14} /> Gerar proposta
        </Button>
      </div>
    )
  }

  // Carregando a 1ª proposta
  if (trabalhando && grupos.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-1.5 text-text-muted text-xs">
        <span className="inline-flex items-center gap-2">
          <Loader2 size={16} className="animate-spin" /> Analisando o orçamento…
        </span>
        <span className="text-2xs text-text-dim">
          O agente lê as CPUs e cruza com as receitas — pode levar até ~1 min.
        </span>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Faixa "agente trabalhando" durante refinos (não bloqueia leitura) */}
      {trabalhando ? (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-accent-glow border-b border-accent-line text-2xs font-mono text-accent shrink-0">
          <Loader2 size={12} className="animate-spin" /> Agente trabalhando no ajuste…
        </div>
      ) : null}

      <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3">
        {/* Avisos globais */}
        {avisos.length > 0 ? (
          <div className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-2xs font-mono text-warn space-y-1">
            {avisos.map((a, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <Info size={12} className="mt-px shrink-0" />
                <span>{a}</span>
              </div>
            ))}
          </div>
        ) : null}

        {grupos.map((g) => {
          const conf = confiancaBadge(g.confianca)
          const custo = custoPorServico.get(g.servico_id)?.custo_unit_agregado
          const qtd = computeQtd(g)
          const selecionado = g.servico_id === servicoSelecionadoId
          const removidas = diff?.removedByServico.get(g.servico_id) ?? []
          // Filho herdado (modo herança) e nº de filhos marcados (modo soma).
          const herancaSel =
            g.qtd_ref_modo === 'heranca'
              ? (g.qtdRefFilhos.find((id) => g.receitas.some((x) => x.id === id)) ??
                g.receitas[0]?.id ??
                null)
              : null
          const somaCount =
            g.qtd_ref_modo === 'soma_filhos'
              ? g.qtdRefFilhos.filter((id) => g.receitas.some((x) => x.id === id)).length
              : 0
          return (
            <div
              key={g.key}
              ref={(el) => {
                if (el) cardRefs.current.set(g.key, el)
                else cardRefs.current.delete(g.key)
              }}
              className={cn(
                'rounded border p-2.5 space-y-2 transition-colors',
                g.aplicado
                  ? 'border-success/40 bg-success/5 opacity-70'
                  : selecionado
                    ? 'border-accent-line bg-accent-glow'
                    : 'border-border-strong bg-bg-panel'
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Package size={13} className="text-accent shrink-0" />
                    <span className="text-sm text-text font-medium truncate">{g.descricao}</span>
                    <Badge variant={conf.variant}>conf {conf.txt}</Badge>
                    {g.aplicado ? <Badge variant="success">aplicado</Badge> : null}
                    {g.editado && !g.aplicado ? <Badge variant="outline">editado</Badge> : null}
                  </div>
                  {g.justificativa ? (
                    <p className="text-2xs text-text-muted font-mono mt-1 leading-relaxed">
                      {g.justificativa}
                    </p>
                  ) : null}
                </div>
                {!g.aplicado ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger hover:bg-danger/10"
                      onClick={() => onRejeitarGrupo(g)}
                      disabled={busy}
                      title="Rejeitar grupo (volta receitas para 'sem grupo')"
                    >
                      <Ban size={12} /> Rejeitar
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => onAplicarGrupo(g)}
                      disabled={busy || g.receitas.length === 0}
                    >
                      {applyingKey === g.key ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Check size={12} />
                      )}
                      Aplicar
                    </Button>
                  </div>
                ) : null}
              </div>

              {/* Serviço de custo + qtd ref */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <label className="block text-2xs font-mono text-text-dim mb-0.5">
                    Serviço de custo
                  </label>
                  <Select
                    value={g.servico_id}
                    onChange={(e) => onMudarServico(g.key, e.target.value)}
                    disabled={g.aplicado || busy}
                  >
                    {servicosFolha.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.codigo} · {s.nome} ({s.unidade})
                      </option>
                    ))}
                  </Select>
                  <p className="text-2xs font-mono text-text-dim mt-0.5">
                    {custo != null
                      ? `${fmtBRL(Number(custo))}/${g.servico_unidade ?? 'un'}`
                      : 'sem custo'}
                  </p>
                </div>
                <div>
                  <label className="block text-2xs font-mono text-text-dim mb-0.5">
                    Quantidade de referência
                  </label>
                  <div className="flex gap-1">
                    {(['soma_filhos', 'heranca', 'manual'] as QtdRefModoAgente[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        disabled={g.aplicado || busy}
                        onClick={() => onMudarModo(g.key, m)}
                        className={cn(
                          'px-2 py-1 text-2xs rounded border',
                          g.qtd_ref_modo === m
                            ? 'bg-accent text-[color:var(--primary-foreground)] border-accent-line'
                            : 'border-border-strong text-text-muted hover:text-text hover:bg-bg-hover'
                        )}
                      >
                        {m === 'soma_filhos' ? 'Soma' : m === 'heranca' ? 'Herança' : 'Manual'}
                      </button>
                    ))}
                  </div>
                  {g.qtd_ref_modo === 'manual' ? (
                    <Input
                      className="mt-1"
                      value={g.qtdManual}
                      onChange={(e) => onPatchGrupo(g.key, { qtdManual: e.target.value })}
                      inputMode="decimal"
                      placeholder={`Qtd em ${g.servico_unidade ?? '—'}`}
                      disabled={g.aplicado || busy}
                    />
                  ) : (
                    <p className="text-2xs font-mono text-text-dim mt-1">
                      {g.qtd_ref_modo === 'soma_filhos'
                        ? `Soma de ${somaCount} de ${g.receitas.length} item(ns): `
                        : 'Herança: '}
                      <span className="text-text">{fmtQtd(qtd)}</span> {g.servico_unidade ?? ''}
                      {!g.aplicado ? (
                        <span className="text-text-faint">
                          {g.qtd_ref_modo === 'soma_filhos'
                            ? ' · marque abaixo os itens da soma'
                            : ' · escolha abaixo o item base'}
                        </span>
                      ) : null}
                    </p>
                  )}
                </div>
              </div>

              {/* Receitas do grupo */}
              <div className="rounded border border-border bg-bg-elevated divide-y divide-border">
                {g.receitas.map((r) => {
                  const novo = diff?.added.has(r.id)
                  const incluido =
                    g.qtd_ref_modo === 'soma_filhos' ? g.qtdRefFilhos.includes(r.id) : true
                  const ehBase = g.qtd_ref_modo === 'heranca' && herancaSel === r.id
                  const apagado = g.qtd_ref_modo === 'soma_filhos' && !incluido
                  return (
                    <div
                      key={r.id}
                      className={cn(
                        'flex items-center gap-2 px-2 py-1 text-xs transition-colors',
                        novo ? 'bg-success/15' : selecionado ? 'bg-accent-glow' : '',
                        apagado ? 'opacity-45' : ''
                      )}
                    >
                      {/* Seletor de filho de referência (herança = radio, soma = checkbox) */}
                      {g.qtd_ref_modo !== 'manual' && !g.aplicado ? (
                        g.qtd_ref_modo === 'heranca' ? (
                          <input
                            type="radio"
                            name={`heranca-${g.key}`}
                            checked={ehBase}
                            onChange={() => onEscolherHeranca(g.key, r.id)}
                            disabled={busy}
                            title="Herdar a quantidade deste item"
                            className="shrink-0 accent-[color:var(--accent)] cursor-pointer"
                          />
                        ) : (
                          <input
                            type="checkbox"
                            checked={incluido}
                            onChange={() => onToggleSomaFilho(g.key, r.id)}
                            disabled={busy}
                            title="Incluir este item na soma"
                            className="shrink-0 accent-[color:var(--accent)] cursor-pointer"
                          />
                        )
                      ) : null}
                      <Badge
                        variant={r.papel === 'principal' ? 'accent' : 'outline'}
                        className="normal-case shrink-0"
                      >
                        {PAPEL_LABEL[r.papel]}
                      </Badge>
                      <span className="text-text-muted font-mono w-20 truncate shrink-0">
                        {r.codigo}
                      </span>
                      <span className="text-text flex-1 truncate">{r.descricao}</span>
                      <span className="text-2xs font-mono text-text-dim shrink-0">
                        {fmtQtd(qtdPorReceita.get(r.id) ?? 0)}
                      </span>
                      {!g.aplicado ? (
                        <button
                          type="button"
                          onClick={() => onRemoverReceita(g.key, r.id)}
                          disabled={busy}
                          className="text-text-dim hover:text-danger shrink-0"
                          title="Remover do grupo"
                        >
                          <X size={12} />
                        </button>
                      ) : null}
                    </div>
                  )
                })}
                {/* Fantasmas das receitas que saíram deste grupo neste turno */}
                {removidas.map((r) => (
                  <div
                    key={`rm-${r.id}`}
                    className="flex items-center gap-2 px-2 py-1 text-xs bg-danger/10 text-danger line-through opacity-80"
                  >
                    <X size={11} className="shrink-0" />
                    <span className="font-mono w-20 truncate shrink-0">{r.codigo}</span>
                    <span className="flex-1 truncate">{r.descricao}</span>
                    <span className="text-2xs shrink-0">saiu</span>
                  </div>
                ))}
              </div>

              {/* Alertas de compartilhamento */}
              {g.alertas_compartilhamento.length > 0 ? (
                <div className="rounded border border-warn/40 bg-warn/10 px-2 py-1.5 text-2xs font-mono text-warn space-y-1">
                  {g.alertas_compartilhamento.map((al, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <AlertTriangle size={12} className="mt-px shrink-0" />
                      <span>
                        Compartilhado com {al.servicos_concorrentes.join(', ')}: {al.observacao}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )
        })}

        {/* Itens omissos — árvore da EAP (índices com os filhos dentro) */}
        {naoAgrupados.length > 0 ? (
          <div className="rounded border border-border bg-bg-elevated p-2.5">
            <div className="text-2xs font-mono text-text-dim mb-1 uppercase tracking-wide">
              Itens omissos ({naoAgrupados.length}) — organizados pela EAP, para classificar
            </div>
            <OmissoRows nodes={omissosTree} depth={0} />
          </div>
        ) : null}
      </div>
    </div>
  )
}
