/**
 * Propriedades da dependência — o `DependencyDlg` do ApeX: tipo (término→início, início→início, término→término,
 * início→término ou por estacas), atraso mínimo e máximo (opcionais) em dias corridos ou úteis. Uma dependência nova
 * passa pelo motor (recusa ciclo, prévia imediata) e herda os últimos valores usados, como no original.
 *
 * Regra entre serviços (`WorkTypeDependency`): uma dependência "por estacas" pode valer para todas as tarefas dos dois
 * serviços. As dependências derivadas dessas regras (tracejadas) abrem aqui para mudar o atraso ou remover a regra:
 * tudo se faz no próprio cronograma, sem tela à parte.
 */
import { useMemo, useState, type ReactNode } from 'react'
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
import type { CalculoCronograma } from '../hooks/calculo'
import {
  traduzirErro,
  useComandoVisao,
  useExcluirDependencias,
  useExcluirRegraServico,
  useSalvarDependencia,
  useSalvarRegraServico
} from '../hooks/edicao'
import type { TipoDependencia } from '../motor/tipos'
import { NOME_TIPO } from '../visoes/dependencias'
import { Caixa, Campo } from './campos'

export interface DependenciaAlvo {
  id: string | null
  pred: string
  succ: string
  tipo: TipoDependencia
  /** dependência derivada de uma regra entre serviços (tracejada) */
  derivada?: boolean
}

interface Props {
  calc: CalculoCronograma
  alvo: DependenciaAlvo | null
  somenteLeitura: boolean
  onFechar: () => void
}

/** `DependencyDlg::m_lastArgs` [O]: a última configuração usada vale para a próxima dependência nova. */
let ultimos = { min: true, minDias: 0, max: false, maxDias: 0, uteis: false }
const lembrar = (v: typeof ultimos): void => {
  ultimos = v
}

const TIPOS: TipoDependencia[] = ['FS', 'SS', 'FF', 'SF', 'EST']

export function DependenciaDialog({ calc, alvo, somenteLeitura, onFechar }: Props): ReactNode {
  return (
    <Dialog open={!!alvo && !!calc.entrada} onOpenChange={(o) => !o && onFechar()} size="md">
      {alvo && calc.entrada ? (
        <Conteudo
          key={`${alvo.id}:${alvo.pred}:${alvo.succ}`}
          calc={calc}
          alvo={alvo}
          somenteLeitura={somenteLeitura}
          onFechar={onFechar}
        />
      ) : null}
    </Dialog>
  )
}

function Conteudo({
  calc,
  alvo,
  somenteLeitura,
  onFechar
}: Props & { alvo: DependenciaAlvo }): ReactNode {
  const e = calc.entrada!
  const derivada = !!alvo.derivada
  const existente = alvo.id && !derivada ? e.dependencias.find((d) => d.id === alvo.id) : undefined
  const [pred, setPred] = useState(alvo.pred)
  const [succ, setSucc] = useState(alvo.succ)
  const servDe = (id: string): string | null =>
    e.tarefas.find((t) => t.id === id)?.servico_id ?? null
  const nomeServ = (id: string | null): string =>
    e.servicos.find((s) => s.id === id)?.nome ?? 'sem serviço'
  const sp = servDe(pred)
  const ss = servDe(succ)
  const regra =
    sp && ss
      ? e.tiposDependencias.find((r) => r.predecessor_id === sp && r.sucessor_id === ss)
      : undefined
  const [tipo, setTipo] = useState<TipoDependencia>(
    derivada ? 'EST' : (existente?.tipo ?? alvo.tipo)
  )
  const [comoRegra, setComoRegra] = useState(false)
  const podeRegra = !existente && !derivada && tipo === 'EST' && !!sp && !!ss && sp !== ss
  const modoRegra = derivada || (podeRegra && comoRegra)
  const [temMin, setTemMin] = useState(existente ? existente.atraso_min !== null : ultimos.min)
  const [min, setMin] = useState(
    String(
      derivada
        ? (regra?.atraso_dias ?? 0)
        : existente
          ? (existente.atraso_min ?? 0)
          : ultimos.minDias
    )
  )
  const [temMax, setTemMax] = useState(existente ? existente.atraso_max !== null : ultimos.max)
  const [max, setMax] = useState(String(existente ? (existente.atraso_max ?? 0) : ultimos.maxDias))
  const [uteis, setUteis] = useState(existente ? existente.dias_uteis : ultimos.uteis)
  const [erro, setErro] = useState<string | null>(null)
  const comando = useComandoVisao()
  const salvar = useSalvarDependencia()
  const excluir = useExcluirDependencias()
  const salvarRegra = useSalvarRegraServico()
  const excluirRegra = useExcluirRegraServico()
  const ro = somenteLeitura
  const ocupado =
    comando.isPending ||
    salvar.isPending ||
    excluir.isPending ||
    salvarRegra.isPending ||
    excluirRegra.isPending

  // tarefas que estão no cálculo (as dependências só valem entre elas)
  const tarefas = useMemo(
    () =>
      e.tarefas
        .filter((t) => t.tipo_no === 'tarefa' && calc.resultado?.tarefas.has(t.id))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    [e.tarefas, calc.resultado]
  )
  const nome = (id: string): string => e.tarefas.find((t) => t.id === id)?.nome ?? ''
  const cruzam = (a: string, b: string): boolean => {
    const wa = calc.resultado?.tarefas.get(a)?.wps ?? [],
      wb = calc.resultado?.tarefas.get(b)?.wps ?? []
    return wa.some((x) =>
      wb.some(
        (y) =>
          x.trecho_id && x.trecho_id === y.trecho_id && x.inicio_m < y.fim_m && y.inicio_m < x.fim_m
      )
    )
  }

  const confirmar = async (): Promise<void> => {
    setErro(null)
    if (!pred || !succ) return setErro('Escolha as duas tarefas.')
    if (pred === succ) return setErro('A dependência precisa ligar duas tarefas diferentes.')
    if (modoRegra) {
      const atraso = Math.round(Number(min.replace(',', '.')))
      if (!Number.isFinite(atraso)) return setErro('Atraso inválido.')
      if (!sp || !ss || sp === ss)
        return setErro('A regra precisa de duas tarefas de serviços diferentes.')
      try {
        await salvarRegra.mutateAsync({
          planejamentoId: e.plano.id,
          predecessor_id: sp,
          sucessor_id: ss,
          atraso_dias: atraso
        })
        onFechar()
      } catch (x) {
        setErro(traduzirErro(x instanceof Error ? x.message : String(x)))
      }
      return
    }
    const a = temMin ? Math.round(Number(min.replace(',', '.'))) : null
    const b = temMax ? Math.round(Number(max.replace(',', '.'))) : null
    if (temMin && !Number.isFinite(a!)) return setErro('Atraso mínimo inválido.')
    if (temMax && (!Number.isFinite(b!) || b! < 0)) return setErro('Atraso máximo inválido.')
    if (a !== null && b !== null && a > b)
      return setErro('O atraso mínimo não pode passar do máximo.')
    if (tipo === 'EST' && !cruzam(pred, succ))
      return setErro('Dependência por estacas exige tarefas que dividem estacas no mesmo trecho.')
    try {
      if (existente) {
        await salvar.mutateAsync({
          planejamentoId: e.plano.id,
          id: existente.id,
          predecessora_id: pred,
          sucessora_id: succ,
          campos: { tipo, atraso_min: a, atraso_max: b, dias_uteis: uteis }
        })
      } else {
        if (e.dependencias.some((d) => d.predecessora_id === pred && d.sucessora_id === succ))
          return setErro('Já existe uma dependência entre essas tarefas.')
        await comando.mutateAsync({
          planejamentoId: e.plano.id,
          sig: calc.sig,
          comando: {
            tipo: 'dependencia',
            predecessora: pred,
            sucessora: succ,
            dep: tipo,
            atraso_min: a,
            atraso_max: b,
            dias_uteis: uteis
          }
        })
        lembrar({ min: temMin, minDias: a ?? 0, max: temMax, maxDias: b ?? 0, uteis })
      }
      onFechar()
    } catch (x) {
      setErro(traduzirErro(x instanceof Error ? x.message : String(x)))
    }
  }

  const seletor = (
    valor: string,
    mudar: (v: string) => void,
    outro: string,
    travado: boolean
  ): ReactNode =>
    travado ? (
      <div className="flex h-7 items-center truncate rounded border border-border bg-bg px-2 text-xs text-text">
        {nome(valor)}
      </div>
    ) : (
      <Select value={valor} onChange={(x) => mudar(x.target.value)} disabled={ro}>
        <option value="">Escolha a tarefa…</option>
        {tarefas
          .filter((t) => t.id !== outro)
          .map((t) => (
            <option key={t.id} value={t.id}>
              {t.nome}
            </option>
          ))}
      </Select>
    )

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {derivada
            ? 'Regra entre serviços'
            : existente
              ? 'Propriedades da dependência'
              : 'Nova dependência'}
        </DialogTitle>
        <DialogDescription>
          {modoRegra
            ? `Toda tarefa de ${nomeServ(ss)} segue as de ${nomeServ(sp)} em cada estaca que dividem.`
            : 'A sucessora espera a predecessora conforme o tipo e os atrasos.'}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <DialogErrorBanner message={erro} />
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Predecessora">
            {seletor(pred, setPred, succ, !!existente || derivada || !!alvo.pred)}
          </Campo>
          <Campo rotulo="Sucessora">
            {seletor(succ, setSucc, pred, !!existente || derivada || !!alvo.succ)}
          </Campo>
        </div>
        <Campo rotulo="Tipo">
          <Select
            value={tipo}
            onChange={(x) => setTipo(x.target.value as TipoDependencia)}
            disabled={ro || derivada}
          >
            {TIPOS.map((t) => (
              <option key={t} value={t}>
                {t === 'EST'
                  ? 'Por estacas — a sucessora passa em cada estaca depois da predecessora'
                  : `${NOME_TIPO[t]} (${t})`}
              </option>
            ))}
          </Select>
        </Campo>
        {podeRegra ? (
          <Caixa marcado={comoRegra} onMudar={setComoRegra} desabilitado={ro}>
            Valer para todas as tarefas de {nomeServ(ss)} depois de {nomeServ(sp)} (regra entre
            serviços{regra ? `, hoje com ${regra.atraso_dias} dia(s)` : ''})
          </Caixa>
        ) : null}
        {modoRegra ? (
          <div className="space-y-1.5">
            <span className="text-xs text-text">Atraso em cada estaca</span>
            <div className="flex items-center gap-2">
              <Input
                value={min}
                onChange={(x) => setMin(x.target.value)}
                disabled={ro}
                inputMode="numeric"
                aria-label="Atraso em dias"
                className="w-24 text-right"
              />
              <span className="text-xs text-text-muted">dias</span>
            </div>
            <p className="text-2xs text-text-muted">
              Vale para todos os planos da obra. Numa tarefa, a regra pode ser desligada em
              Propriedades › Geral.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Caixa
                  marcado={temMin}
                  onMudar={setTemMin}
                  desabilitado={ro}
                  dica="Sem atraso mínimo, a dependência não segura as datas (só o máximo vale)"
                >
                  Atraso mínimo
                </Caixa>
                <div className="flex items-center gap-2">
                  <Input
                    value={min}
                    onChange={(x) => setMin(x.target.value)}
                    disabled={ro || !temMin}
                    inputMode="numeric"
                    className="w-24 text-right"
                  />
                  <span className="text-xs text-text-dim">dias</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Caixa
                  marcado={temMax}
                  onMudar={setTemMax}
                  desabilitado={ro}
                  dica="Passar do máximo marca uma violação (bandeira) na sucessora"
                >
                  Atraso máximo
                </Caixa>
                <div className="flex items-center gap-2">
                  <Input
                    value={max}
                    onChange={(x) => setMax(x.target.value)}
                    disabled={ro || !temMax}
                    inputMode="numeric"
                    className="w-24 text-right"
                  />
                  <span className="text-xs text-text-dim">dias</span>
                </div>
              </div>
            </div>
            <div className="flex gap-6 text-xs text-text">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  className="accent-[var(--accent)]"
                  checked={!uteis}
                  onChange={() => setUteis(false)}
                  disabled={ro}
                />{' '}
                Dias corridos
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  className="accent-[var(--accent)]"
                  checked={uteis}
                  onChange={() => setUteis(true)}
                  disabled={ro}
                />{' '}
                Dias úteis
              </label>
            </div>
          </>
        )}
      </DialogBody>
      <DialogFooter>
        {derivada && !ro && sp && ss ? (
          <Button
            variant="danger"
            className="mr-auto"
            disabled={ocupado}
            onClick={() =>
              excluirRegra.mutate(
                { planejamentoId: e.plano.id, predecessor_id: sp, sucessor_id: ss },
                { onSuccess: onFechar, onError: (x) => setErro(traduzirErro(x.message)) }
              )
            }
          >
            Remover regra
          </Button>
        ) : null}
        {existente && !ro ? (
          <Button
            variant="danger"
            className="mr-auto"
            disabled={ocupado}
            onClick={() =>
              excluir.mutate(
                { planejamentoId: e.plano.id, ids: [existente.id] },
                { onSuccess: onFechar, onError: (x) => setErro(traduzirErro(x.message)) }
              )
            }
          >
            Remover
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onFechar} disabled={ocupado}>
          {ro ? 'Fechar' : 'Cancelar'}
        </Button>
        {!ro ? (
          <Button onClick={() => void confirmar()} disabled={ocupado}>
            {ocupado ? 'Salvando…' : existente || derivada ? 'Salvar' : 'Criar'}
          </Button>
        ) : null}
      </DialogFooter>
    </>
  )
}
