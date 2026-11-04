/**
 * Propriedades da tarefa — o "Task Properties" do ApeX (`EditWorkSiteDlg`) com os dados do InfraWork:
 *
 * - Geral: nome, serviço, início/término (mover o início fixa o início desejado; mudar o término recalcula o número
 *   de equipes, como no Gantt), restrições de data, calendário, "o mais cedo possível", "início no começo do dia",
 *   derivar predecessoras das dependências entre serviços, prioridade.
 * - Locais: os trechos da tarefa (work places) com estacas, quantidade manual ou do template do trecho e o sentido.
 * - Equipes: composição (equipe do motor, produtividade da composição) × número de equipes e as equipes nomeadas (recursos
 *   identificados: a mesma equipe não trabalha em duas tarefas ao mesmo tempo).
 * - Dependências: predecessoras e sucessoras (do usuário editáveis; as derivadas dos serviços, só leitura).
 * - Aparência e comentário.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogErrorBanner,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { TabPill } from '@/components/ui/TabPill'
import { useTrechosQuantidadeTemplatesAtuais } from '@/features/planejamento/hooks/trechos'
import { segmentosDoTemplate } from '@/features/planejamento/lib/trecho'
import { divisorMetrosPorUnidade } from '@/lib/format/posicao'
import { quantidadeNaFaixa } from '@/lib/quantidades/segmentos'
import { cn } from '@/lib/utils'
import type { CalculoCronograma } from '../hooks/calculo'
import {
  traduzirErro,
  useAtualizarTarefa,
  useComandoVisao,
  useExcluirDependencias,
  useSalvarEquipesTarefa,
  useSalvarLocais,
  type CamposTarefa,
  type LocalInput
} from '../hooks/edicao'
import { isoParaSeg, segParaTimestamp } from '../motor/tempo'
import type { TarefaEntrada } from '../motor/tipos'
import { NOME_TIPO } from '../visoes/dependencias'
import {
  coresServicos,
  ctxTrecho,
  fmtData,
  fmtDataHora,
  fmtDias,
  fmtNum,
  lerEstaca,
  textoEstaca
} from '../visoes/formato'
import { Caixa, Campo, Secao } from './campos'
import { doInputDataHora, lerNumero, paraInputDataHora } from './campos-util'

type Aba = 'geral' | 'locais' | 'equipes' | 'dependencias' | 'aparencia' | 'comentario'

interface Props {
  calc: CalculoCronograma
  tarefaId: string | null
  somenteLeitura: boolean
  onFechar: () => void
  onAbrirDependencia: (d: {
    id: string | null
    pred: string
    succ: string
    tipo: 'FS' | 'SS' | 'FF' | 'SF' | 'EST'
  }) => void
}

interface LocalForm {
  /** id do local já gravado (local novo: ausente) */
  id?: string
  trecho_id: string
  ini: string
  fim: string
  qtd: string
  origem: 'manual' | 'trecho'
}

export function TarefaDialog({
  calc,
  tarefaId,
  somenteLeitura,
  onFechar,
  onAbrirDependencia
}: Props): ReactNode {
  const e = calc.entrada
  const t = tarefaId ? e?.tarefas.find((x) => x.id === tarefaId) : undefined
  return (
    <Dialog open={!!t && !!e} onOpenChange={(o) => !o && onFechar()} size="xl">
      {t && e ? (
        <Conteudo
          key={t.id}
          calc={calc}
          t={t}
          somenteLeitura={somenteLeitura}
          onFechar={onFechar}
          onAbrirDependencia={onAbrirDependencia}
        />
      ) : null}
    </Dialog>
  )
}

function Conteudo({
  calc,
  t,
  somenteLeitura,
  onFechar,
  onAbrirDependencia
}: { calc: CalculoCronograma; t: TarefaEntrada } & Omit<Props, 'calc' | 'tarefaId'>): ReactNode {
  const e = calc.entrada!
  const r = calc.resultado?.tarefas.get(t.id)
  const planoId = e.plano.id
  const servico = t.servico_id ? e.servicos.find((s) => s.id === t.servico_id) : undefined
  const equipe = t.servico_id ? e.equipes.find((q) => q.servico_id === t.servico_id) : undefined
  const trechos = new Map(e.trechos.map((x) => [x.id, x]))
  const cores = useMemo(() => coresServicos(e.servicos), [e.servicos])
  const ro = somenteLeitura
  // planilha de quantidades de cada local: "no template: X nesta faixa" e a opção "do template"
  const templates = useTrechosQuantidadeTemplatesAtuais(e.trechos.map((x) => x.id))
  const noTemplate = (l: { trecho_id: string; ini: string; fim: string }): number | null => {
    const tr = trechos.get(l.trecho_id)
    if (!tr || !t.item_orcamentario_id) return null
    const segs = segmentosDoTemplate(templates.get(tr.id))
    if (!segs.some((s) => (s.valores[t.item_orcamentario_id!] ?? 0) > 0)) return null
    if (tr.tipo === 'area')
      return segs.reduce((s, x) => s + (x.valores[t.item_orcamentario_id!] ?? 0), 0)
    const a = lerEstaca(l.ini, tr),
      b = lerEstaca(l.fim, tr)
    if (a === null || b === null || !(b > a)) return null
    return quantidadeNaFaixa(segs, t.item_orcamentario_id, a, b)
  }

  const atualizar = useAtualizarTarefa()
  const salvarLocais = useSalvarLocais()
  const salvarEquipes = useSalvarEquipesTarefa()
  const comando = useComandoVisao()
  const excluirDeps = useExcluirDependencias()

  const [aba, setAba] = useState<Aba>('geral')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  // ── formulário ──
  const [nome, setNome] = useState(t.nome)
  const [asap, setAsap] = useState(t.asap)
  const [inicioDia, setInicioDia] = useState(t.inicio_dia)
  const [derivar, setDerivar] = useState(t.derivar_predecessoras)
  const [prioridade, setPrioridade] = useState(String(t.prioridade))
  const [calendario, setCalendario] = useState(t.calendario_id ?? '')
  const [restIni, setRestIni] = useState<'' | 'nao_antes' | 'exato'>(t.restricao_inicio ?? '')
  const [restIniEm, setRestIniEm] = useState(paraInputDataHora(t.restricao_inicio_em))
  const [restFim, setRestFim] = useState<'' | 'nao_depois' | 'exato'>(t.restricao_fim ?? '')
  const [restFimEm, setRestFimEm] = useState(paraInputDataHora(t.restricao_fim_em))
  const inicioAtual = r ? paraInputDataHora(segParaTimestamp(r.inicio)) : ''
  const fimAtual = r ? paraInputDataHora(segParaTimestamp(r.fim)) : ''
  const [inicio, setInicio] = useState(inicioAtual)
  const [fim, setFim] = useState(fimAtual)
  const [qtdEquipes, setQtdEquipes] = useState(String(t.qtd_equipes))
  const [coef, setCoef] = useState(fmtNum(t.coef_producao, 'auto'))
  const [sentido, setSentido] = useState(t.sentido)
  const [nomeadas, setNomeadas] = useState<string[]>(t.equipes_ids)
  const [qtdSemLocal, setQtdSemLocal] = useState(t.quantidade ? fmtNum(t.quantidade, 'auto') : '')
  const locaisIniciais: LocalForm[] = [...t.locais]
    .sort((a, b) => a.ordem - b.ordem)
    .map((l) => ({
      id: l.id,
      trecho_id: l.trecho_id ?? '',
      ini:
        l.trecho_id && l.inicio_m !== null ? textoEstaca(l.inicio_m, trechos.get(l.trecho_id)) : '',
      fim: l.trecho_id && l.fim_m !== null ? textoEstaca(l.fim_m, trechos.get(l.trecho_id)) : '',
      qtd: fmtNum(l.quantidade, 'auto'),
      origem: l.qtd_origem
    }))
  const [locais, setLocais] = useState<LocalForm[]>(locaisIniciais)
  const [cor, setCor] = useState(t.exib?.aparencia?.cor ?? '')
  const [rotulo, setRotulo] = useState(t.exib?.aparencia?.rotulo !== false)
  const [notas, setNotas] = useState(t.exib?.notas ?? '')

  const corPadrao = (t.servico_id && cores.get(t.servico_id)) || 'oklch(67% 0.17 255)'
  const n = Math.max(1, Math.round(lerNumero(qtdEquipes) ?? t.qtd_equipes))
  const coefN = lerNumero(coef) ?? t.coef_producao
  const prodComp = Number(equipe?.producao_diaria) || 0
  const prodEfetiva = prodComp * n * coefN
  const producaoMudou = n !== t.qtd_equipes || Math.abs(coefN - t.coef_producao) > 1e-9

  // ── validação e gravação ──
  const locaisDoForm = (): LocalInput[] | string => {
    const out: LocalInput[] = []
    for (const [k, l] of locais.entries()) {
      if (!l.trecho_id) {
        const q = lerNumero(l.qtd)
        if (q === null || q < 0) return `Local ${k + 1}: informe a quantidade.`
        out.push({
          id: l.id ?? null,
          trecho_id: null,
          inicio_m: null,
          fim_m: null,
          quantidade: q,
          qtd_origem: 'manual'
        })
        continue
      }
      const tr = trechos.get(l.trecho_id)
      if (tr?.tipo === 'area') {
        // área: sem estacas (work place 0…1 do ApeX)
        const q = l.origem === 'trecho' ? 0 : lerNumero(l.qtd)
        if (q === null || q < 0) return `Local ${k + 1}: informe a quantidade.`
        out.push({
          id: l.id ?? null,
          trecho_id: l.trecho_id,
          inicio_m: null,
          fim_m: null,
          quantidade: q,
          qtd_origem: l.origem
        })
        continue
      }
      const a = lerEstaca(l.ini, tr),
        b = lerEstaca(l.fim, tr)
      if (a === null) return `Local ${k + 1}: estaca inicial inválida ou fora do trecho.`
      if (b === null) return `Local ${k + 1}: estaca final inválida ou fora do trecho.`
      const ini = Math.min(a, b),
        fimM = Math.max(a, b)
      if (!(fimM > ini))
        return `Local ${k + 1}: as estacas inicial e final precisam ser diferentes.`
      const q = l.origem === 'trecho' ? 0 : lerNumero(l.qtd)
      if (q === null || q < 0) return `Local ${k + 1}: informe a quantidade.`
      out.push({
        id: l.id ?? null,
        trecho_id: l.trecho_id,
        inicio_m: Math.round(ini * 1000) / 1000,
        fim_m: Math.round(fimM * 1000) / 1000,
        quantidade: q,
        qtd_origem: l.origem
      })
    }
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const x = out[i]!,
          y = out[j]!
        if (
          x.trecho_id === y.trecho_id &&
          (x.inicio_m === null || (x.inicio_m < y.fim_m! && y.inicio_m! < x.fim_m!))
        )
          return x.trecho_id === null
            ? 'Só um local sem trecho por tarefa.'
            : x.inicio_m === null
              ? `Só um local por área (locais ${i + 1} e ${j + 1}).`
              : `Os locais ${i + 1} e ${j + 1} se sobrepõem no mesmo trecho.`
      }
    return out
  }

  const salvar = async (): Promise<void> => {
    setErro(null)
    const campos: CamposTarefa = {}
    if (nome.trim() !== t.nome) campos.nome_custom = nome.trim() || null
    if (asap !== t.asap) campos.asap = asap
    if (inicioDia !== t.inicio_dia) campos.inicio_dia = inicioDia
    if (derivar !== t.derivar_predecessoras) campos.derivar_predecessoras = derivar
    const pr = Math.round(lerNumero(prioridade) ?? NaN)
    if (!(pr >= 0)) return setErro('A prioridade é um número inteiro a partir de zero.')
    if (pr !== t.prioridade) campos.prioridade = pr
    if ((calendario || null) !== t.calendario_id) campos.calendario_id = calendario || null
    const ri = restIni || null,
      rie = ri ? doInputDataHora(restIniEm) : null
    if (ri && !rie) return setErro('Informe a data da restrição de início.')
    if (ri !== t.restricao_inicio || rie !== t.restricao_inicio_em)
      Object.assign(campos, { restricao_inicio: ri, restricao_inicio_em: rie })
    const rf = restFim || null,
      rfe = rf ? doInputDataHora(restFimEm) : null
    if (rf && !rfe) return setErro('Informe a data da restrição de término.')
    if (rf !== t.restricao_fim || rfe !== t.restricao_fim_em)
      Object.assign(campos, { restricao_fim: rf, restricao_fim_em: rfe })
    if (!(n >= 1 && n <= 50)) return setErro('O número de equipes vai de 1 a 50.')
    if (n !== t.qtd_equipes) campos.qtd_equipes = n
    if (!(coefN > 0)) return setErro('O coeficiente de produção precisa ser maior que zero.')
    if (Math.abs(coefN - t.coef_producao) > 1e-9)
      campos.coef_producao = Math.round(coefN * 1e6) / 1e6
    if (sentido !== t.sentido) campos.sentido = sentido
    const ap = { ...(t.exib?.aparencia ?? {}), cor: cor || undefined, rotulo }
    if (
      (ap.cor ?? '') !== (t.exib?.aparencia?.cor ?? '') ||
      ap.rotulo !== (t.exib?.aparencia?.rotulo !== false)
    )
      campos.aparencia = ap
    if ((notas || null) !== (t.exib?.notas ?? null)) campos.notas = notas || null
    // início movido: o início desejado (tarefa deixa de ser ASAP, como no arraste)
    const novoInicio = inicio && inicio !== inicioAtual ? doInputDataHora(inicio) : null
    if (novoInicio) Object.assign(campos, { inicio_em: novoInicio, asap: false })
    if (!locais.length) {
      const q = lerNumero(qtdSemLocal)
      if (t.servico_id && !t.is_indireto && (q === null || q <= 0))
        return setErro('Informe a quantidade da tarefa.')
      if (q !== null && Math.abs(q - t.quantidade) > 1e-9) campos.quantidade_alocada = q
    }
    const ls = locaisDoForm()
    if (typeof ls === 'string') {
      setAba('locais')
      return setErro(ls)
    }
    const locaisMudaram = !mesmosLocais(ls, locaisDoFormInicial())
    const equipesMudaram = [...nomeadas].sort().join() !== [...t.equipes_ids].sort().join()
    const fimMudou = !!fim && fim !== fimAtual

    setSalvando(true)
    try {
      // o término vira número de equipes (pelo projeto calculado) antes das outras mudanças
      if (fimMudou && !producaoMudou) {
        const rc = await comando.mutateAsync({
          planejamentoId: planoId,
          sig: calc.sig,
          comando: { tipo: 'fim', tarefaId: t.id, em: isoParaSeg(doInputDataHora(fim)!) }
        })
        if (rc.aviso) toast.info(rc.aviso)
      }
      if (Object.keys(campos).length)
        await atualizar.mutateAsync({ planejamentoId: planoId, id: t.id, campos })
      if (locaisMudaram)
        await salvarLocais.mutateAsync({ planejamentoId: planoId, tarefaId: t.id, locais: ls })
      if (equipesMudaram)
        await salvarEquipes.mutateAsync({
          planejamentoId: planoId,
          tarefaId: t.id,
          equipes: nomeadas
        })
      onFechar()
    } catch (err) {
      setErro(traduzirErro(err instanceof Error ? err.message : String(err)))
    } finally {
      setSalvando(false)
    }
  }

  function locaisDoFormInicial(): LocalInput[] {
    return [...t.locais]
      .sort((a, b) => a.ordem - b.ordem)
      .map((l) => ({
        id: l.id,
        trecho_id: l.trecho_id,
        inicio_m: l.trecho_id ? l.inicio_m : null,
        fim_m: l.trecho_id ? l.fim_m : null,
        quantidade: l.qtd_origem === 'trecho' ? 0 : l.quantidade,
        qtd_origem: l.qtd_origem
      }))
  }

  // dependências da tarefa
  const preds = e.dependencias.filter((d) => d.sucessora_id === t.id)
  const succs = e.dependencias.filter((d) => d.predecessora_id === t.id)
  const autoPreds = (calc.resultado?.automaticas ?? []).filter((d) => d.sucessora_id === t.id)
  const autoSuccs = (calc.resultado?.automaticas ?? []).filter((d) => d.predecessora_id === t.id)
  const nomeT = (id: string): string => e.tarefas.find((x) => x.id === id)?.nome ?? '—'
  const viol = r?.violacoes ?? []

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-[3px]" style={{ background: cor || corPadrao }} />
          {t.nome}
        </DialogTitle>
        <DialogDescription>
          {servico
            ? `${servico.codigo} ${servico.nome}`
            : t.is_indireto
              ? 'Custo indireto'
              : 'Sem serviço'}
          {r
            ? ` · ${fmtDataHora(r.inicio)} → ${fmtDataHora(r.fim)} · ${fmtDias(r.duracao_dias_uteis)}`
            : ''}
        </DialogDescription>
        <div className="mt-2 flex gap-4 border-b border-transparent" role="tablist">
          {(
            [
              ['geral', 'Geral'],
              ['locais', `Locais (${locais.length})`],
              ['equipes', 'Equipes'],
              [
                'dependencias',
                `Dependências (${preds.length + succs.length + autoPreds.length + autoSuccs.length})`
              ],
              ['aparencia', 'Aparência'],
              ['comentario', 'Comentário']
            ] as [Aba, string][]
          ).map(([k, rot]) => (
            <TabPill
              key={k}
              active={aba === k}
              onClick={() => {
                setAba(k)
                setErro(null)
              }}
            >
              {rot}
            </TabPill>
          ))}
        </div>
      </DialogHeader>
      <DialogBody className="max-h-[62vh] min-h-[420px] overflow-y-auto">
        <DialogErrorBanner message={erro} />
        {viol.length ? (
          <div className="mb-3 space-y-0.5 rounded border border-danger/30 bg-danger/10 px-3 py-2 text-2xs text-danger">
            {viol.map((v, i) => (
              <div key={i}>
                ⚑{' '}
                {v.tipo === 'marco'
                  ? `Marco violado: ${e.marcos.find((m) => m.id === v.marco_id)?.nome ?? ''}`
                  : v.tipo === 'projeto'
                    ? v.ponto === 'fim'
                      ? 'Prazo do projeto violado'
                      : 'Início do projeto violado'
                    : v.tipo === 'restricao'
                      ? `Restrição de ${v.ponto === 'inicio' ? 'início' : 'término'} violada`
                      : `Atraso máximo violado (de ${nomeT(v.dependencia_predecessora)})`}
              </div>
            ))}
          </div>
        ) : null}

        {aba === 'geral' ? (
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <Campo rotulo="Nome" className="col-span-2">
              <Input
                value={nome}
                onChange={(x) => setNome(x.target.value)}
                disabled={ro}
                placeholder={servico?.nome}
              />
            </Campo>
            <Secao titulo="Datas">
              <div className="grid grid-cols-2 gap-3">
                <Campo
                  rotulo="Início"
                  dica="Mudar o início fixa o início desejado da tarefa (deixa de ser 'o mais cedo possível')"
                >
                  <Input
                    type="datetime-local"
                    value={inicio}
                    onChange={(x) => setInicio(x.target.value)}
                    disabled={ro || !r}
                  />
                </Campo>
                <Campo
                  rotulo="Término"
                  dica="Mudar o término recalcula o número de equipes (a produção é a da composição × equipes), como esticar a barra no Gantt"
                >
                  <Input
                    type="datetime-local"
                    value={fim}
                    onChange={(x) => setFim(x.target.value)}
                    disabled={ro || !r || producaoMudou}
                  />
                </Campo>
              </div>
              {producaoMudou ? (
                <p className="text-2xs text-text-dim">Salve as equipes antes de mudar o término.</p>
              ) : null}
              <Caixa
                marcado={asap}
                onMudar={setAsap}
                desabilitado={ro}
                dica="Começa no início do plano ou assim que as dependências permitem; desligado, mantém o início atual"
              >
                O mais cedo possível
              </Caixa>
              <Caixa
                marcado={inicioDia}
                onMudar={setInicioDia}
                desabilitado={ro}
                dica="Só começa no início de um dia de trabalho"
              >
                Começar no início do dia
              </Caixa>
              {r ? (
                <div className="grid grid-cols-3 gap-2 pt-1 text-2xs text-text-muted">
                  <span>Duração: {fmtDias(r.duracao_dias_uteis)}</span>
                  <span>Folga total: {fmtNum(r.folga_total_h, 1)} h</span>
                  <span>Folga livre: {fmtNum(r.folga_livre_h, 1)} h</span>
                </div>
              ) : null}
            </Secao>
            <Secao titulo="Restrições">
              <div className="grid grid-cols-[1fr_1.2fr] gap-2">
                <Campo rotulo="Início">
                  <Select
                    value={restIni}
                    onChange={(x) => setRestIni(x.target.value as typeof restIni)}
                    disabled={ro}
                  >
                    <option value="">Sem restrição</option>
                    <option value="nao_antes">Não antes de</option>
                    <option value="exato">Exatamente em</option>
                  </Select>
                </Campo>
                <Campo rotulo="Data">
                  <Input
                    type="datetime-local"
                    value={restIniEm}
                    onChange={(x) => setRestIniEm(x.target.value)}
                    disabled={ro || !restIni}
                  />
                </Campo>
                <Campo rotulo="Término">
                  <Select
                    value={restFim}
                    onChange={(x) => setRestFim(x.target.value as typeof restFim)}
                    disabled={ro}
                  >
                    <option value="">Sem restrição</option>
                    <option value="nao_depois">Não depois de</option>
                    <option value="exato">Exatamente em</option>
                  </Select>
                </Campo>
                <Campo rotulo="Data">
                  <Input
                    type="datetime-local"
                    value={restFimEm}
                    onChange={(x) => setRestFimEm(x.target.value)}
                    disabled={ro || !restFim}
                  />
                </Campo>
              </div>
            </Secao>
            <Secao titulo="Programação">
              <div className="grid grid-cols-2 gap-3">
                <Campo rotulo="Calendário">
                  <Select
                    value={calendario}
                    onChange={(x) => setCalendario(x.target.value)}
                    disabled={ro}
                  >
                    <option value="">Padrão do plano</option>
                    {e.calendarios.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo
                  rotulo="Prioridade"
                  dica="Ordem de cálculo quando há disputa por equipes ou recursos: maior primeiro"
                >
                  <Input
                    value={prioridade}
                    onChange={(x) => setPrioridade(x.target.value)}
                    disabled={ro}
                    inputMode="numeric"
                    className="text-right"
                  />
                </Campo>
              </div>
              <Caixa
                marcado={derivar}
                onMudar={setDerivar}
                desabilitado={ro}
                dica="Usa as dependências entre serviços (por estacas) como predecessoras"
              >
                Derivar predecessoras das dependências entre serviços
              </Caixa>
            </Secao>
            <Secao titulo="Resultado">
              {r ? (
                <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-xs">
                  <dt className="text-text-dim">Início</dt>
                  <dd className="tabular-nums text-text">{fmtDataHora(r.inicio)}</dd>
                  <dt className="text-text-dim">Término</dt>
                  <dd className="tabular-nums text-text">{fmtDataHora(r.fim)}</dd>
                  <dt className="text-text-dim">Horas de trabalho</dt>
                  <dd className="tabular-nums text-text">{fmtNum(r.duracao_h, 1)} h</dd>
                  <dt className="text-text-dim">Limitada por</dt>
                  <dd className="text-text">{LIMITE[r.restricao_limite] ?? r.restricao_limite}</dd>
                </dl>
              ) : (
                <p className="text-xs text-text-dim">
                  {t.is_indireto
                    ? 'Custo indireto: a janela vem das tarefas diretas.'
                    : 'Fora do cálculo: a tarefa precisa de um serviço com composição.'}
                </p>
              )}
            </Secao>
          </div>
        ) : null}

        {aba === 'locais' ? (
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <Campo rotulo="Sentido de execução" className="w-72">
                <Select
                  value={sentido}
                  onChange={(x) => setSentido(x.target.value as typeof sentido)}
                  disabled={ro}
                >
                  <option value="crescente">Do início do trecho (estacas crescentes)</option>
                  <option value="decrescente">Do fim do trecho (estacas decrescentes)</option>
                </Select>
              </Campo>
              <p className="mt-4 flex-1 text-2xs text-text-dim">
                Cada local é um trecho de trabalho da tarefa (eixo com estacas, ou uma área). Com
                quantidade “do template”, a planilha de quantidades do local divide a faixa em
                segmentos — o motor avança mais devagar onde há mais quantidade — e acompanha a
                planilha.
              </p>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-2xs font-mono uppercase tracking-wider text-text-dim">
                  <th className="w-6" />
                  <th className="px-1 py-1 text-left">Local</th>
                  <th className="px-1 py-1 text-left">Estaca inicial</th>
                  <th className="px-1 py-1 text-left">Estaca final</th>
                  <th className="px-1 py-1 text-left">Origem</th>
                  <th className="px-1 py-1 text-right">Quantidade {servico?.unidade ?? ''}</th>
                  <th className="px-1 py-1 text-left">Calculado</th>
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody>
                {locais.map((l, k) => {
                  const loc = t.locais.find((x) => x.id === l.id)
                  const tr = l.trecho_id ? trechos.get(l.trecho_id) : undefined
                  const ehEixo = tr?.tipo === 'eixo'
                  const muda = (x: Partial<LocalForm>): void =>
                    setLocais(locais.map((y, j) => (j === k ? { ...y, ...x } : y)))
                  const iniOk = !ehEixo || lerEstaca(l.ini, tr) !== null
                  const fimOk = !ehEixo || lerEstaca(l.fim, tr) !== null
                  const tpl = tr ? noTemplate({ trecho_id: tr.id, ini: l.ini, fim: l.fim }) : null
                  const ws = (r?.wps ?? []).filter((w) => w.local_id === l.id)
                  return (
                    <tr key={k} className="border-t border-border">
                      <td className="py-1 text-center font-mono text-2xs text-text-faint">
                        {k + 1}
                      </td>
                      <td className="px-1 py-1">
                        <Select
                          value={l.trecho_id}
                          onChange={(x) => {
                            const ntr = trechos.get(x.target.value)
                            muda({
                              trecho_id: x.target.value,
                              origem: x.target.value ? l.origem : 'manual',
                              ini: ntr?.tipo === 'eixo' ? textoEstaca(0, ntr) : '',
                              fim:
                                ntr?.tipo === 'eixo' ? textoEstaca(ntr.comprimento_m ?? 0, ntr) : ''
                            })
                          }}
                          disabled={ro}
                          title={
                            ehEixo
                              ? `Faixa do trecho: ${textoEstaca(0, tr)} – ${textoEstaca(tr.comprimento_m ?? 0, tr)}`
                              : undefined
                          }
                        >
                          <option value="">Sem local</option>
                          {e.trechos.some((x) => x.tipo === 'eixo') ? (
                            <optgroup label="Eixos">
                              {e.trechos
                                .filter((x) => x.tipo === 'eixo')
                                .map((x) => (
                                  <option key={x.id} value={x.id}>
                                    {x.nome}
                                  </option>
                                ))}
                            </optgroup>
                          ) : null}
                          {e.trechos.some((x) => x.tipo === 'area') ? (
                            <optgroup label="Áreas">
                              {e.trechos
                                .filter((x) => x.tipo === 'area')
                                .map((x) => (
                                  <option key={x.id} value={x.id}>
                                    {x.nome}
                                  </option>
                                ))}
                            </optgroup>
                          ) : null}
                        </Select>
                      </td>
                      <td className="px-1 py-1">
                        <Input
                          value={l.ini}
                          onChange={(x) => muda({ ini: x.target.value })}
                          disabled={ro || !ehEixo}
                          placeholder={ehEixo ? textoEstaca(0, tr) : tr ? 'área inteira' : '—'}
                          className={cn('font-mono', !iniOk && 'border-danger')}
                          title={
                            ehEixo
                              ? iniOk
                                ? `Entre ${textoEstaca(0, tr)} e ${textoEstaca(tr.comprimento_m ?? 0, tr)}`
                                : 'Estaca inválida ou fora do trecho'
                              : undefined
                          }
                        />
                      </td>
                      <td className="px-1 py-1">
                        <Input
                          value={l.fim}
                          onChange={(x) => muda({ fim: x.target.value })}
                          disabled={ro || !ehEixo}
                          placeholder={
                            ehEixo
                              ? textoEstaca(tr.comprimento_m ?? 0, tr)
                              : tr
                                ? 'área inteira'
                                : '—'
                          }
                          className={cn('font-mono', !fimOk && 'border-danger')}
                          title={
                            ehEixo
                              ? fimOk
                                ? `Entre ${textoEstaca(0, tr)} e ${textoEstaca(tr.comprimento_m ?? 0, tr)}`
                                : 'Estaca inválida ou fora do trecho'
                              : undefined
                          }
                        />
                      </td>
                      <td className="px-1 py-1">
                        <Select
                          value={l.origem}
                          onChange={(x) => muda({ origem: x.target.value as LocalForm['origem'] })}
                          disabled={ro || !l.trecho_id}
                          title={
                            tr && tpl === null && l.origem === 'manual'
                              ? 'A planilha de quantidades deste local não tem este serviço nesta faixa'
                              : undefined
                          }
                        >
                          <option value="manual">Manual</option>
                          <option value="trecho" disabled={tpl === null && l.origem !== 'trecho'}>
                            Do template
                          </option>
                        </Select>
                      </td>
                      <td className="px-1 py-1">
                        {l.origem === 'trecho' ? (
                          <span
                            className="block pr-1 text-right tabular-nums text-text-muted"
                            title="Calculada pela planilha de quantidades do local"
                          >
                            {tpl !== null
                              ? fmtNum(tpl, 'auto')
                              : loc?.qtd_origem === 'trecho'
                                ? fmtNum(loc.quantidade, 'auto')
                                : 'calculada'}
                          </span>
                        ) : (
                          <>
                            <Input
                              value={l.qtd}
                              onChange={(x) => muda({ qtd: x.target.value })}
                              disabled={ro}
                              inputMode="decimal"
                              className="text-right"
                            />
                            {tpl !== null ? (
                              <div
                                className="mt-0.5 text-right text-2xs text-text-dim"
                                title="Quantidade da planilha de quantidades nesta faixa"
                              >
                                no template: {fmtNum(tpl, 'auto')}
                              </div>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td className="px-1 py-1 whitespace-nowrap font-mono text-2xs text-text-muted">
                        {ws.length
                          ? `${fmtData(Math.min(...ws.map((w) => w.inicio)))} → ${fmtData(Math.max(...ws.map((w) => w.fim)) - 1)}`
                          : '—'}
                      </td>
                      <td className="px-1 py-1 text-right">
                        <div className="flex justify-end gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={ro || k === 0}
                            onClick={() => setLocais(trocar(locais, k, k - 1))}
                            aria-label="Subir"
                          >
                            <ArrowUp size={12} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={ro || k === locais.length - 1}
                            onClick={() => setLocais(trocar(locais, k, k + 1))}
                            aria-label="Descer"
                          >
                            <ArrowDown size={12} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={ro}
                            onClick={() => setLocais(locais.filter((_, j) => j !== k))}
                            aria-label="Remover local"
                          >
                            <Trash2 size={12} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {!locais.length ? (
              <div className="flex items-center gap-3 rounded border border-border bg-bg-elevated/40 px-3 py-2">
                <span className="text-xs text-text-muted">
                  Sem locais: a tarefa fica em “Sem local” (fora do tempo-caminho), com a quantidade
                </span>
                <Input
                  value={qtdSemLocal}
                  onChange={(x) => setQtdSemLocal(x.target.value)}
                  disabled={ro || t.is_indireto}
                  inputMode="decimal"
                  className="w-32 text-right"
                />
                <span className="text-xs text-text-dim">{servico?.unidade ?? ''}</span>
              </div>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              disabled={ro || t.is_indireto}
              onClick={() => {
                // como no ApeX: o local novo começa onde o anterior termina e vale uma unidade
                const ultimo = locais[locais.length - 1]
                const trechoId = ultimo?.trecho_id ?? e.trechos[0]?.id ?? ''
                const tr = trechos.get(trechoId)
                let ini = '',
                  fim = ''
                if (tr?.tipo === 'eixo') {
                  const comp = tr.comprimento_m ?? 0
                  const a0 = ultimo && ultimo.trecho_id === trechoId ? lerEstaca(ultimo.fim, tr) : 0
                  const a = Math.min(a0 ?? 0, comp)
                  const b = Math.min(a + divisorMetrosPorUnidade(ctxTrecho(tr)), comp)
                  ini = textoEstaca(a, tr)
                  fim = textoEstaca(b > a ? b : comp, tr)
                }
                setLocais([
                  ...locais,
                  { trecho_id: trechoId, ini, fim, qtd: '', origem: ultimo?.origem ?? 'manual' }
                ])
              }}
            >
              <Plus size={12} /> Novo local
            </Button>
          </div>
        ) : null}

        {aba === 'equipes' ? (
          <div className="grid grid-cols-2 gap-6">
            <Secao titulo="Composição (equipe do cálculo)">
              {equipe && prodComp > 0 ? (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <Campo rotulo="Produção/dia" dica="Produção da composição vigente do serviço">
                      <div className="flex h-7 items-center justify-end rounded border border-border bg-bg px-2 text-xs tabular-nums text-text-muted">
                        {fmtNum(prodComp, 'auto')} {servico?.unidade ?? ''}
                      </div>
                    </Campo>
                    <Campo
                      rotulo="Equipes"
                      dica="Composições trabalhando juntas: recursos e produção multiplicados"
                    >
                      <Input
                        value={qtdEquipes}
                        onChange={(x) => setQtdEquipes(x.target.value)}
                        disabled={ro}
                        inputMode="numeric"
                        className="text-right"
                      />
                    </Campo>
                    <Campo
                      rotulo="Produtividade"
                      dica="A produtividade é a da composição do serviço; a duração muda pelo número de equipes"
                    >
                      <div className="flex h-7 items-center justify-end rounded border border-border bg-bg px-2 text-xs tabular-nums text-text-muted">
                        {Math.abs(coefN - 1) < 1e-9
                          ? 'da composição'
                          : `× ${fmtNum(coefN, 'auto')}`}
                      </div>
                    </Campo>
                  </div>
                  {Math.abs(coefN - 1) > 1e-9 ? (
                    <div className="flex items-center gap-2 rounded border border-warn/40 bg-warn/10 px-2 py-1.5 text-2xs text-warn">
                      <span className="flex-1">
                        Esta tarefa está com a produtividade alterada (× {fmtNum(coefN, 'auto')}),
                        resto de um arraste antigo do término. No InfraWork a produção é a da
                        composição × equipes.
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={ro}
                        onClick={() => setCoef('1')}
                      >
                        Usar a da composição
                      </Button>
                    </div>
                  ) : null}
                  <p className="text-xs text-text">
                    Produção efetiva:{' '}
                    <strong className="tabular-nums">{fmtNum(prodEfetiva, 'auto')}</strong>{' '}
                    {servico?.unidade ?? ''}/dia
                  </p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-2xs font-mono uppercase tracking-wider text-text-dim">
                        <th className="py-1 text-left">Recurso</th>
                        <th className="py-1 text-right">Por equipe</th>
                        <th className="py-1 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {equipe.recursos.map((x) => (
                        <tr key={x.recurso_id} className="border-t border-border">
                          <td className="py-1 text-text">{x.nome}</td>
                          <td className="py-1 text-right tabular-nums text-text-muted">
                            {fmtNum(x.qtd, 'auto')}
                          </td>
                          <td className="py-1 text-right tabular-nums text-text">
                            {fmtNum(x.qtd * n, 'auto')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <p className="text-xs text-text-dim">
                  {t.is_indireto
                    ? 'Custo indireto: sem equipe.'
                    : 'O serviço não tem composição com produção/dia — a tarefa fica sem duração.'}
                </p>
              )}
            </Secao>
            <Secao titulo="Equipes nomeadas">
              <p className="text-2xs text-text-dim">
                Uma equipe nomeada não trabalha em duas tarefas ao mesmo tempo: o motor sequencia as
                tarefas que a dividem, pela prioridade.
              </p>
              {e.equipesNomeadas.length ? (
                <div className="space-y-1.5">
                  {e.equipesNomeadas.map((q) => (
                    <Caixa
                      key={q.id}
                      marcado={nomeadas.includes(q.id)}
                      desabilitado={ro || t.is_indireto}
                      onMudar={(v) =>
                        setNomeadas(v ? [...nomeadas, q.id] : nomeadas.filter((x) => x !== q.id))
                      }
                    >
                      {q.nome}
                    </Caixa>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-text-dim">
                  Nenhuma equipe cadastrada na obra (Planejamento › Equipes).
                </p>
              )}
            </Secao>
          </div>
        ) : null}

        {aba === 'dependencias' ? (
          <div className="grid grid-cols-2 gap-6">
            {(
              [
                ['Predecessoras', preds, autoPreds, 'pred'],
                ['Sucessoras', succs, autoSuccs, 'succ']
              ] as const
            ).map(([titulo, us, au, lado]) => (
              <Secao
                key={titulo}
                titulo={titulo}
                acoes={
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={ro || !r}
                    onClick={() =>
                      onAbrirDependencia(
                        lado === 'pred'
                          ? { id: null, pred: '', succ: t.id, tipo: 'FS' }
                          : { id: null, pred: t.id, succ: '', tipo: 'FS' }
                      )
                    }
                  >
                    <Plus size={12} /> Nova
                  </Button>
                }
              >
                {us.length + au.length === 0 ? (
                  <p className="text-xs text-text-dim">Nenhuma.</p>
                ) : null}
                {us.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center gap-2 rounded border border-border px-2 py-1.5 text-xs"
                  >
                    <span className="flex-1 truncate text-text">
                      {nomeT(lado === 'pred' ? d.predecessora_id : d.sucessora_id)}
                    </span>
                    <span className="font-mono text-2xs text-text-muted" title={NOME_TIPO[d.tipo]}>
                      {d.tipo}
                      {d.atraso_min ? ` +${d.atraso_min}d` : ''}
                      {d.atraso_max !== null ? ` ≤${d.atraso_max}d` : ''}
                      {d.dias_uteis ? ' úteis' : ''}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={ro}
                      onClick={() =>
                        onAbrirDependencia({
                          id: d.id,
                          pred: d.predecessora_id,
                          succ: d.sucessora_id,
                          tipo: d.tipo
                        })
                      }
                      aria-label="Editar"
                    >
                      ✎
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={ro}
                      onClick={() =>
                        excluirDeps.mutate(
                          { planejamentoId: planoId, ids: [d.id] },
                          { onError: (x) => toast.error(x.message) }
                        )
                      }
                      aria-label="Remover"
                    >
                      <Trash2 size={12} />
                    </Button>
                  </div>
                ))}
                {au.map((d, k) => (
                  <div
                    key={`a${k}`}
                    className="flex items-center gap-2 rounded border border-dashed border-border px-2 py-1.5 text-xs text-text-muted"
                    title="Derivada das dependências entre serviços"
                  >
                    <span className="flex-1 truncate">
                      {nomeT(lado === 'pred' ? d.predecessora_id : d.sucessora_id)}
                    </span>
                    <span className="font-mono text-2xs">
                      por estacas{d.atraso ? ` +${d.atraso}d` : ''}
                    </span>
                  </div>
                ))}
              </Secao>
            ))}
          </div>
        ) : null}

        {aba === 'aparencia' ? (
          <div className="max-w-md space-y-4">
            <Campo rotulo="Cor da barra">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={cor || '#5b8def'}
                  onChange={(x) => setCor(x.target.value)}
                  disabled={ro}
                  className="h-7 w-12 cursor-pointer rounded border border-border-strong bg-bg-elevated"
                />
                <Button variant="ghost" size="sm" disabled={ro || !cor} onClick={() => setCor('')}>
                  Usar a cor do serviço
                </Button>
                <span className="h-4 w-10 rounded-[3px]" style={{ background: cor || corPadrao }} />
              </div>
            </Campo>
            <Caixa marcado={rotulo} onMudar={setRotulo} desabilitado={ro}>
              Mostrar o nome ao lado da barra
            </Caixa>
          </div>
        ) : null}

        {aba === 'comentario' ? (
          <textarea
            value={notas}
            onChange={(x) => setNotas(x.target.value)}
            disabled={ro}
            rows={12}
            className="w-full rounded border border-border-strong bg-bg-elevated p-2 text-xs text-text outline-none focus:border-accent"
            placeholder="Observações da tarefa…"
          />
        ) : null}
      </DialogBody>
      <DialogFooter>
        <span className={cn('mr-auto text-2xs text-text-dim', !ro && 'hidden')}>
          Somente leitura
        </span>
        <Button variant="ghost" onClick={onFechar} disabled={salvando}>
          {ro ? 'Fechar' : 'Cancelar'}
        </Button>
        {!ro ? (
          <Button onClick={() => void salvar()} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </Button>
        ) : null}
      </DialogFooter>
    </>
  )
}

const LIMITE: Record<string, string> = {
  TC_DEADLINE: 'prazo do projeto',
  TC_MILESTONE: 'marco',
  TC_FORCED_START: 'restrição de início',
  TC_FORCED_FINISH: 'restrição de término'
}

function mesmosLocais(a: LocalInput[], b: LocalInput[]): boolean {
  const perto = (x: number | null, y: number | null): boolean =>
    x === null || y === null ? x === y : Math.abs(x - y) < 0.01
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i]!
      return (
        x.trecho_id === y.trecho_id &&
        x.qtd_origem === y.qtd_origem &&
        perto(x.inicio_m, y.inicio_m) &&
        perto(x.fim_m, y.fim_m) &&
        (x.qtd_origem === 'trecho' || perto(x.quantidade, y.quantidade))
      )
    })
  )
}

function trocar<T>(l: T[], a: number, b: number): T[] {
  const out = [...l]
  ;[out[a], out[b]] = [out[b]!, out[a]!]
  return out
}
