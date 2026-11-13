import { useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { formatNumber } from '@/lib/format'
import { hojeLocalISO } from '@/lib/format/local-date'
import { contar } from '@/lib/rotulos'
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

const TH = 'px-2 py-2 text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim'

interface Props {
  obraId: string
  dataInicial?: string
}

/**
 * Lançamento em lote (desktop): uma linha por serviço do orçamento, com data, equipe, encarregado, frente e
 * local padrão e a quantidade de cada serviço. Linhas sem quantidade são ignoradas.
 */
export function LancamentoBulkGrid({ obraId, dataInicial }: Props): ReactNode {
  const consultaItens = useItensLancaveis(obraId)
  const { data: itens = [] } = consultaItens
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
  const [tentou, setTentou] = useState(false)
  const tabelaRef = useRef<HTMLDivElement>(null)

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
        errs.push(`${cod}: informe o local, exigido para este serviço`)
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

  const dataFutura = data > hojeLocalISO()

  const salvar = async (): Promise<void> => {
    setTentou(true)
    if (erros.length) {
      toast.error(`Corrija as linhas marcadas antes de registrar. ${erros.slice(0, 3).join('; ')}`)
      return
    }
    if (prontas.length === 0) {
      tabelaRef.current?.querySelector<HTMLInputElement>('input[data-qtd]')?.focus()
      return
    }
    if (dataFutura) {
      toast.error('A data não pode ser no futuro.')
      return
    }
    try {
      const r = await lote.mutateAsync({ linhas: prontas, origem: 'app' })
      toast.success(
        `${contar(r.inseridos, 'lançamento registrado', 'lançamentos registrados')} em ${fmtBR(data)}.`
      )
      setLinhas({})
      setTentou(false)
    } catch (e) {
      toast.error(
        `Não foi possível registrar os lançamentos.${e instanceof Error && e.message ? ` ${e.message}` : ''}`
      )
    }
  }

  const campo =
    'h-8 w-full rounded border border-border-strong bg-bg-panel px-2 text-sm text-text placeholder:text-text-dim focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent aria-[invalid=true]:border-danger aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-danger'
  const sufixo =
    'pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-text-muted'
  const msgErro = 'mt-0.5 text-xs font-medium text-danger'
  const semLinhaPronta = tentou && prontas.length === 0 && erros.length === 0

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-3 border-b border-border bg-bg-panel grid grid-cols-2 lg:grid-cols-6 gap-3 items-start">
        <Campo rotulo="Data" erro={tentou && dataFutura ? 'A data não pode ser no futuro.' : null}>
          <Input
            type="date"
            value={data}
            max={hojeLocalISO()}
            onChange={(e) => setData(e.target.value)}
          />
        </Campo>
        <Campo rotulo="Equipe padrão">
          <Select value={equipePadrao} onChange={(e) => setEquipePadrao(e.target.value)}>
            <option value="">—</option>
            {equipes.map((eq) => (
              <option key={eq.id} value={eq.id}>
                {eq.nome}
              </option>
            ))}
          </Select>
        </Campo>
        <Campo rotulo="Encarregado padrão">
          <Select value={encPadrao} onChange={(e) => setEncPadrao(e.target.value)}>
            <option value="">—</option>
            {encarregados.map((en) => (
              <option key={en.id} value={en.id}>
                {en.nome}
              </option>
            ))}
          </Select>
        </Campo>
        <div>
          <Campo rotulo="Frente padrão">
            <Input
              list="lote-frentes"
              value={frentePadrao}
              onChange={(e) => setFrentePadrao(e.target.value)}
              placeholder="Opcional"
            />
          </Campo>
          <datalist id="lote-frentes">
            {frentes.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </div>
        <Campo rotulo="Local padrão">
          <Select value={localPadrao} onChange={(e) => setLocalPadrao(e.target.value)}>
            <option value="">Sem local</option>
            {trechos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.tipo === 'area' ? `Área ${t.nome}` : t.nome}
              </option>
            ))}
          </Select>
        </Campo>
        <Campo rotulo="Filtrar serviços">
          <Input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Código ou descrição"
          />
        </Campo>
      </div>

      <div className="flex-1 overflow-auto" ref={tabelaRef}>
        <table className="w-full min-w-[1180px] table-fixed text-sm">
          <colgroup>
            <col className="w-[84px]" />
            <col />
            <col className="w-[156px]" />
            <col className="w-[116px]" />
            <col className="w-[124px]" />
            <col className="w-[124px]" />
            <col className="w-[104px]" />
            <col className="w-[124px]" />
            <col className="w-[168px]" />
          </colgroup>
          <thead className="sticky top-0 bg-bg-elevated z-10">
            <tr className="border-b border-border">
              <th scope="col" className={cn(TH, 'pl-5 text-left')}>
                Código
              </th>
              <th scope="col" className={cn(TH, 'text-left')}>
                Serviço
              </th>
              <th scope="col" className={cn(TH, 'text-right')}>
                Executado / orçado
              </th>
              <th scope="col" className={cn(TH, 'text-left')}>
                Quantidade
              </th>
              <th scope="col" className={cn(TH, 'text-left')}>
                Equipe
              </th>
              <th scope="col" className={cn(TH, 'text-left')}>
                Encarregado
              </th>
              <th scope="col" className={cn(TH, 'text-left')}>
                Frente
              </th>
              <th scope="col" className={cn(TH, 'text-left')}>
                Local
              </th>
              <th scope="col" className={cn(TH, 'pr-5 text-left')}>
                Estacas
              </th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-5 py-8 text-sm text-text-muted">
                  {consultaItens.isLoading
                    ? 'Carregando os serviços…'
                    : busca.trim()
                      ? 'Nenhum serviço com esse código ou descrição. Mude o filtro para ver os demais.'
                      : 'Nenhum serviço com composição no orçamento desta obra. Vincule as composições na planilha orçamentária para poder lançar.'}
                </td>
              </tr>
            ) : null}
            {filtrados.map((i) => {
              const l = linhas[i.id]
              const un = i.unidade_referencia ?? i.servico_unidade ?? ''
              const q = l ? parseQtd(l.qtd) : null
              const ativa = q != null && q > 0
              const par = parametroDe(parametros, i.id)
              const nome = `${i.codigo} ${i.descricao}`
              const qtdInvalida = !!l?.qtd && q == null
              const tr = trechoDe(l)
              // as pendências da linha aparecem depois da primeira tentativa de registrar
              const faltaLocal = tentou && ativa && par.exige_local && !tr
              const faltaMaterial =
                tentou &&
                ativa &&
                par.controla_material &&
                par.material_obrigatorio &&
                parseQtd(l?.mat ?? '') == null
              const loc = ativa && tr ? resolverLocalProducao(tr, l?.estIni, l?.estFim) : null
              const erroEstaca = loc && !loc.ok ? loc.erro : null
              return (
                <tr
                  key={i.id}
                  className={cn(
                    'border-b border-border align-top',
                    ativa ? 'bg-accent/5' : 'hover:bg-bg-hover'
                  )}
                >
                  <td className="pl-5 pr-2 py-3 tabular text-xs text-text-muted">{i.codigo}</td>
                  <td className="px-2 py-2.5 text-text" title={i.descricao}>
                    <span className="line-clamp-2">{i.descricao}</span>
                  </td>
                  <td className="px-2 py-3 text-xs text-text-muted text-right tabular">
                    {formatNumber(Number(i.qtd_real ?? 0), 1)} /{' '}
                    {i.quantidade_referencia != null
                      ? formatNumber(Number(i.quantidade_referencia), 1)
                      : '—'}{' '}
                    {un}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="relative">
                      <input
                        data-qtd=""
                        inputMode="decimal"
                        value={l?.qtd ?? ''}
                        onChange={(e) => setLinha(i.id, { qtd: e.target.value })}
                        className={cn(campo, 'tabular pr-9')}
                        placeholder="0,00"
                        aria-label={`Quantidade${un ? ` em ${un}` : ''}, ${nome}`}
                        aria-invalid={qtdInvalida || undefined}
                      />
                      {un ? <span className={sufixo}>{un}</span> : null}
                    </div>
                    {qtdInvalida ? (
                      <p className={msgErro}>Digite um número, como 1.250,5.</p>
                    ) : null}
                    {par.controla_material ? (
                      <>
                        <div className="relative mt-1">
                          <input
                            inputMode="decimal"
                            value={l?.mat ?? ''}
                            onChange={(e) => setLinha(i.id, { mat: e.target.value })}
                            className={cn(campo, 'tabular pr-9')}
                            placeholder="Material"
                            title="Material aplicado (controlado pela parametrização do serviço)"
                            aria-label={`Material aplicado${par.material_unidade ? ` em ${par.material_unidade}` : ''}, ${nome}`}
                            aria-invalid={faltaMaterial || undefined}
                          />
                          <span className={sufixo}>{par.material_unidade ?? ''}</span>
                        </div>
                        {faltaMaterial ? (
                          <p className={msgErro}>Informe o material aplicado.</p>
                        ) : null}
                      </>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      value={l?.equipeId ?? ''}
                      onChange={(e) => setLinha(i.id, { equipeId: e.target.value })}
                      className={campo}
                      aria-label={`Equipe, ${nome}`}
                    >
                      <option value="">{equipePadrao ? 'A padrão' : '—'}</option>
                      {equipes.map((eq) => (
                        <option key={eq.id} value={eq.id}>
                          {eq.nome}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      value={l?.encarregadoId ?? ''}
                      onChange={(e) => setLinha(i.id, { encarregadoId: e.target.value })}
                      className={campo}
                      aria-label={`Encarregado, ${nome}`}
                    >
                      <option value="">{encPadrao ? 'O padrão' : '—'}</option>
                      {encarregados.map((en) => (
                        <option key={en.id} value={en.id}>
                          {en.nome}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      list="lote-frentes"
                      value={l?.frente ?? ''}
                      onChange={(e) => setLinha(i.id, { frente: e.target.value })}
                      className={campo}
                      placeholder={frentePadrao || '—'}
                      aria-label={`Frente, ${nome}`}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      value={l?.trechoId ?? ''}
                      onChange={(e) => setLinha(i.id, { trechoId: e.target.value })}
                      className={campo}
                      aria-label={`Local, ${nome}`}
                      aria-invalid={faltaLocal || undefined}
                    >
                      <option value="">{localPadrao ? 'O padrão' : 'Sem local'}</option>
                      {trechos.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.tipo === 'area' ? `Área ${t.nome}` : t.nome}
                        </option>
                      ))}
                    </select>
                    {faltaLocal ? <p className={msgErro}>Este serviço exige o local.</p> : null}
                  </td>
                  <td className="pl-2 pr-5 py-1.5">
                    {tr?.tipo === 'area' ? (
                      <span className="inline-block py-1.5 text-xs text-text-muted">
                        Área inteira
                      </span>
                    ) : (
                      <>
                        <div className="flex items-center gap-1">
                          <input
                            value={l?.estIni ?? ''}
                            onChange={(e) => setLinha(i.id, { estIni: e.target.value })}
                            className={cn(campo, 'tabular')}
                            placeholder={tr ? estacaInicialTexto(tr) : 'De'}
                            aria-label={`Estaca inicial, ${nome}`}
                            aria-invalid={erroEstaca ? true : undefined}
                            autoComplete="off"
                          />
                          <input
                            value={l?.estFim ?? ''}
                            onChange={(e) => setLinha(i.id, { estFim: e.target.value })}
                            className={cn(campo, 'tabular')}
                            placeholder={tr ? estacaFinalTexto(tr) : 'Até'}
                            aria-label={`Estaca final, ${nome}`}
                            aria-invalid={erroEstaca ? true : undefined}
                            autoComplete="off"
                          />
                        </div>
                        {erroEstaca ? <p className={msgErro}>{erroEstaca}</p> : null}
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t border-border bg-bg-panel px-5 py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm text-text-muted" role="status">
          {contar(prontas.length, 'serviço pronto', 'serviços prontos')} para {fmtBR(data)}
          {erros.length ? (
            <span className="text-danger font-medium">
              {' '}
              e {contar(erros.length, 'linha com pendência', 'linhas com pendência')} de local,
              estaca ou material
            </span>
          ) : null}
        </span>
        {semLinhaPronta ? (
          <span role="alert" className="text-sm font-medium text-danger">
            Digite a quantidade de pelo menos um serviço para registrar.
          </span>
        ) : null}
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setLinhas({})
            setTentou(false)
          }}
          disabled={lote.isPending || Object.keys(linhas).length === 0}
          title={Object.keys(linhas).length === 0 ? 'Nenhuma linha preenchida.' : undefined}
        >
          Limpar linhas
        </Button>
        <Button
          onClick={() => void salvar()}
          disabled={lote.isPending}
          title={prontas.length === 0 ? 'Digite a quantidade de pelo menos um serviço.' : undefined}
        >
          {lote.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {lote.isPending
            ? 'Registrando…'
            : prontas.length > 0
              ? `Registrar ${contar(prontas.length, 'lançamento', 'lançamentos')}`
              : 'Registrar lançamentos'}
        </Button>
      </div>
    </div>
  )
}

function fmtBR(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
