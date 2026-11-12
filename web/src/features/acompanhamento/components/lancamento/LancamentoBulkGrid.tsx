import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Check, Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatNumber } from '@/lib/format'
import { hojeLocalISO } from '@/lib/format/local-date'
import { cn } from '@/lib/utils'
import { useEquipes } from '@/features/planejamento/hooks/equipes'
import { useObraTrechos } from '@/features/planejamento/hooks/trechos'
import { parametroDe, useParametrosServicos } from '@/features/planejamento/hooks/parametros'
import { estacaFinalTexto, estacaInicialTexto } from '@/features/planejamento/lib/trecho'
import type { LancamentoInput } from '@/types/acompanhamento'
import {
  useCreateLancamentosLote,
  useEncarregados,
  useFrentesObra,
  useItensLancaveis
} from '../../hooks/lancamento'
import { parseQtd } from '../../lib/parse-qtd'
import { resolverLocalProducao } from '../../lib/local-producao'

interface Linha {
  qtd: string
  equipeId: string
  encarregadoId: string
  frente: string
  /** local da linha ('' = o padrão) e as estacas (controle por estaca) */
  trechoId: string
  estIni: string
  estFim: string
  /** material aplicado (serviço com material controlado) */
  mat: string
}

const LINHA_VAZIA: Linha = {
  qtd: '',
  equipeId: '',
  encarregadoId: '',
  frente: '',
  trechoId: '',
  estIni: '',
  estFim: '',
  mat: ''
}

interface Props {
  obraId: string
  dataInicial?: string
}

/**
 * Lançamento em lote (desktop): uma linha por item do orçamento, com data,
 * equipe/encarregado/frente padrão e quantidade por item. Linhas sem
 * quantidade são ignoradas.
 */
export function LancamentoBulkGrid({ obraId, dataInicial }: Props): ReactNode {
  const { data: itens = [] } = useItensLancaveis(obraId)
  const { data: equipes = [] } = useEquipes(obraId)
  const { data: encarregados = [] } = useEncarregados(obraId)
  const { data: frentes = [] } = useFrentesObra(obraId)
  const { data: trechos = [] } = useObraTrechos(obraId)
  const lote = useCreateLancamentosLote()
  const { data: parametros } = useParametrosServicos(obraId)

  const [data, setData] = useState(dataInicial ?? hojeLocalISO())
  const [equipePadrao, setEquipePadrao] = useState('')
  const [encPadrao, setEncPadrao] = useState('')
  const [frentePadrao, setFrentePadrao] = useState('')
  const [localPadrao, setLocalPadrao] = useState('')
  const [busca, setBusca] = useState('')
  const [linhas, setLinhas] = useState<Record<string, Linha>>({})

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    // serviços alimentados por viagens não recebem lançamento de quantidade
    const lancaveis = itens.filter(
      (i) => parametroDe(parametros, i.id).modo_lancamento !== 'viagens'
    )
    if (!q) return lancaveis
    return lancaveis.filter((i) => `${i.codigo} ${i.descricao}`.toLowerCase().includes(q))
  }, [itens, busca, parametros])

  const setLinha = (id: string, patch: Partial<Linha>): void =>
    setLinhas((prev) => ({ ...prev, [id]: { ...LINHA_VAZIA, ...prev[id], ...patch } }))

  const trechoDe = (l: Linha | undefined): (typeof trechos)[number] | null =>
    trechos.find((t) => t.id === (l?.trechoId || localPadrao)) ?? null
  // linhas com quantidade: o lançamento ou o erro do local (eixo exige estacas dentro dele)
  const { prontas, erros } = useMemo(() => {
    const out: LancamentoInput[] = []
    const errs: string[] = []
    for (const [id, l] of Object.entries(linhas)) {
      const q = parseQtd(l.qtd)
      if (q == null || q <= 0) continue
      const tr = trechos.find((t) => t.id === (l.trechoId || localPadrao)) ?? null
      const cod = itens.find((i) => i.id === id)?.codigo ?? '?'
      const par = parametroDe(parametros, id)
      const loc = resolverLocalProducao(tr, l.estIni, l.estFim)
      if (!loc.ok) {
        errs.push(`${cod}: ${loc.erro}`)
        continue
      }
      if (par.exige_local && !tr) {
        errs.push(`${cod}: informe o local (exigido para este serviço)`)
        continue
      }
      const m = parseQtd(l.mat)
      if (par.controla_material && par.material_obrigatorio && m == null) {
        errs.push(`${cod}: informe o material aplicado`)
        continue
      }
      out.push({
        obra_id: obraId,
        data,
        item_orcamentario_id: id,
        equipe_id: l.equipeId || equipePadrao || null,
        encarregado_id: l.encarregadoId || encPadrao || null,
        quantidade: q,
        frente: l.frente || frentePadrao || null,
        estaca_inicial: l.estIni.trim() || null,
        estaca_final: l.estFim.trim() || null,
        trecho_id: loc.trecho_id,
        posicao_inicio_m: loc.posicao_inicio_m,
        posicao_fim_m: loc.posicao_fim_m,
        materiais:
          par.controla_material && m != null
            ? [
                {
                  nome: '',
                  quantidade: m,
                  unidade: par.material_unidade,
                  recurso_id: par.material_recurso_id
                }
              ]
            : undefined
      })
    }
    return { prontas: out, erros: errs }
  }, [
    linhas,
    obraId,
    data,
    equipePadrao,
    encPadrao,
    frentePadrao,
    localPadrao,
    trechos,
    itens,
    parametros
  ])

  const salvar = async (): Promise<void> => {
    if (erros.length) {
      toast.error(erros.slice(0, 3).join(' · '))
      return
    }
    if (prontas.length === 0) return
    if (data > hojeLocalISO()) {
      toast.error('A data não pode ser no futuro.')
      return
    }
    try {
      const r = await lote.mutateAsync({ linhas: prontas, origem: 'app' })
      toast.success(`${r.inseridos} lançamento(s) registrado(s) em ${fmtBR(data)}.`)
      setLinhas({})
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar o lote')
    }
  }

  const campo =
    'h-8 w-full rounded border border-border bg-bg px-2 text-xs text-text focus:border-accent focus:outline-none'

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-3 border-b border-border bg-bg-panel grid grid-cols-2 lg:grid-cols-6 gap-3 items-end">
        <div>
          <Label>Data</Label>
          <input
            type="date"
            value={data}
            max={hojeLocalISO()}
            onChange={(e) => setData(e.target.value)}
            className={campo}
          />
        </div>
        <div>
          <Label>Equipe padrão</Label>
          <select
            value={equipePadrao}
            onChange={(e) => setEquipePadrao(e.target.value)}
            className={campo}
          >
            <option value="">—</option>
            {equipes.map((eq) => (
              <option key={eq.id} value={eq.id}>
                {eq.nome}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>Encarregado padrão</Label>
          <select
            value={encPadrao}
            onChange={(e) => setEncPadrao(e.target.value)}
            className={campo}
          >
            <option value="">—</option>
            {encarregados.map((en) => (
              <option key={en.id} value={en.id}>
                {en.nome}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>Frente padrão</Label>
          <Input
            list="lote-frentes"
            value={frentePadrao}
            onChange={(e) => setFrentePadrao(e.target.value)}
            className="h-8 text-xs"
            placeholder="opcional"
          />
          <datalist id="lote-frentes">
            {frentes.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </div>
        <div>
          <Label>Local padrão</Label>
          <select
            value={localPadrao}
            onChange={(e) => setLocalPadrao(e.target.value)}
            className={campo}
          >
            <option value="">Sem local</option>
            {trechos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.tipo === 'area' ? `Área ${t.nome}` : t.nome}
              </option>
            ))}
          </select>
        </div>
        <div className="relative">
          <Label>Filtrar itens</Label>
          <Search size={11} className="absolute left-2 bottom-2.5 text-text-dim" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="h-8 text-xs pl-6"
            placeholder="código ou descrição"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-bg z-10 text-text-dim font-mono uppercase text-2xs">
            <tr className="border-b border-border">
              <th className="text-left px-3 py-2 w-24">Código</th>
              <th className="text-left px-3 py-2">Item</th>
              <th className="text-right px-3 py-2 w-40">Executado / orçado</th>
              <th className="text-left px-3 py-2 w-32">Quantidade</th>
              <th className="text-left px-3 py-2 w-40">Equipe</th>
              <th className="text-left px-3 py-2 w-40">Encarregado</th>
              <th className="text-left px-3 py-2 w-44">Frente</th>
              <th className="text-left px-3 py-2 w-44">Local</th>
              <th className="text-left px-3 py-2 w-48">Estacas</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-2xs font-mono text-text-dim">
                  Nenhum item com composição no orçamento.
                </td>
              </tr>
            ) : null}
            {filtrados.map((i) => {
              const l = linhas[i.id]
              const un = i.unidade_referencia ?? i.servico_unidade ?? ''
              const q = l ? parseQtd(l.qtd) : null
              const ativa = q != null && q > 0
              return (
                <tr
                  key={i.id}
                  className={cn(
                    'border-b border-border',
                    ativa ? 'bg-accent/5' : 'hover:bg-bg-hover'
                  )}
                >
                  <td className="px-3 py-1.5 font-mono text-2xs text-text-dim">{i.codigo}</td>
                  <td className="px-3 py-1.5 text-text truncate max-w-[360px]" title={i.descricao}>
                    {i.descricao}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-2xs text-text-muted text-right tabular-nums">
                    {formatNumber(Number(i.qtd_real ?? 0), 1)} /{' '}
                    {i.quantidade_referencia != null
                      ? formatNumber(Number(i.quantidade_referencia), 1)
                      : '—'}{' '}
                    {un}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="relative">
                      <input
                        inputMode="decimal"
                        value={l?.qtd ?? ''}
                        onChange={(e) => setLinha(i.id, { qtd: e.target.value })}
                        className={cn(
                          campo,
                          'font-mono pr-8',
                          l?.qtd && q == null && 'border-danger'
                        )}
                        placeholder="0,00"
                      />
                      {un ? (
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-2xs font-mono text-text-dim">
                          {un}
                        </span>
                      ) : null}
                    </div>
                    {parametroDe(parametros, i.id).controla_material ? (
                      <div className="relative mt-1">
                        <input
                          inputMode="decimal"
                          value={l?.mat ?? ''}
                          onChange={(e) => setLinha(i.id, { mat: e.target.value })}
                          className={cn(campo, 'font-mono pr-8 h-7')}
                          placeholder="material"
                          title="Material aplicado (controlado pela parametrização do serviço)"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-2xs font-mono text-text-dim">
                          {parametroDe(parametros, i.id).material_unidade ?? ''}
                        </span>
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-1.5">
                    <select
                      value={l?.equipeId ?? ''}
                      onChange={(e) => setLinha(i.id, { equipeId: e.target.value })}
                      className={campo}
                    >
                      <option value="">{equipePadrao ? '(padrão)' : '—'}</option>
                      {equipes.map((eq) => (
                        <option key={eq.id} value={eq.id}>
                          {eq.nome}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-1.5">
                    <select
                      value={l?.encarregadoId ?? ''}
                      onChange={(e) => setLinha(i.id, { encarregadoId: e.target.value })}
                      className={campo}
                    >
                      <option value="">{encPadrao ? '(padrão)' : '—'}</option>
                      {encarregados.map((en) => (
                        <option key={en.id} value={en.id}>
                          {en.nome}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      list="lote-frentes"
                      value={l?.frente ?? ''}
                      onChange={(e) => setLinha(i.id, { frente: e.target.value })}
                      className={campo}
                      placeholder={frentePadrao || '—'}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <select
                      value={l?.trechoId ?? ''}
                      onChange={(e) => setLinha(i.id, { trechoId: e.target.value })}
                      className={campo}
                    >
                      <option value="">{localPadrao ? '(padrão)' : 'Sem local'}</option>
                      {trechos.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.tipo === 'area' ? `Área ${t.nome}` : t.nome}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-1.5">
                    {(() => {
                      const tr = trechoDe(l)
                      if (tr?.tipo === 'area')
                        return <span className="text-2xs text-text-dim">área inteira</span>
                      const loc =
                        ativa && tr ? resolverLocalProducao(tr, l?.estIni, l?.estFim) : null
                      return (
                        <div
                          className="flex items-center gap-1"
                          title={loc && !loc.ok ? loc.erro : undefined}
                        >
                          <input
                            value={l?.estIni ?? ''}
                            onChange={(e) => setLinha(i.id, { estIni: e.target.value })}
                            className={cn(campo, 'font-mono', loc && !loc.ok && 'border-danger')}
                            placeholder={tr ? estacaInicialTexto(tr) : 'de'}
                          />
                          <input
                            value={l?.estFim ?? ''}
                            onChange={(e) => setLinha(i.id, { estFim: e.target.value })}
                            className={cn(campo, 'font-mono', loc && !loc.ok && 'border-danger')}
                            placeholder={tr ? estacaFinalTexto(tr) : 'até'}
                          />
                        </div>
                      )
                    })()}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t border-border bg-bg-panel px-5 py-3 flex items-center gap-3">
        <span className="text-2xs font-mono text-text-dim">
          {prontas.length} item(ns) com quantidade · {fmtBR(data)}
          {erros.length ? (
            <span className="text-danger"> · {erros.length} com local/estaca inválido</span>
          ) : null}
        </span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLinhas({})}
          disabled={lote.isPending || Object.keys(linhas).length === 0}
        >
          Limpar
        </Button>
        <Button onClick={() => void salvar()} disabled={lote.isPending || prontas.length === 0}>
          {lote.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          Registrar {prontas.length > 0 ? `${prontas.length} lançamento(s)` : ''}
        </Button>
      </div>
    </div>
  )
}

function fmtBR(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
