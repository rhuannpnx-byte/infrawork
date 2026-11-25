// Lançamentos do estoque: entrada, saída e leitura. A leitura do tanque é o número da régua; os litros saem da
// tabela de arqueação do tanque (a mesma conta que o banco faz ao gravar), só para mostrar a prévia e a diferença.

import { useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogBody,
  DialogErrorBanner,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { Input } from '@/components/ui/input'
import { Segmentado } from '@/components/ui/segmentado'
import { formatNumber, parseNumero } from '@/lib/format'
import { numeroParaCampo } from '@/lib/mascara/numero'
import { useLancarMovimento, useRegistrarLeitura, useTabelaTanque } from '../hooks/estoque'
import { nivelDaLeitura, volumeNaTabela } from '../lib/tanque'
import type { AtivoEstoque } from '../tipos'

const AREA_TEXTO =
  'w-full rounded border border-border-strong bg-bg-panel px-2.5 py-2 text-sm text-text placeholder:text-text-dim focus-visible:outline-none focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent'

const dois = (n: number): string => String(n).padStart(2, '0')
/** Agora, no formato do campo de data e hora ("2026-11-24T14:30"). */
function agoraLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}T${dois(d.getHours())}:${dois(d.getMinutes())}`
}
/**
 * O instante a gravar. O campo só tem precisão de minuto: se o usuário deixou o "agora" que veio preenchido, vale o
 * instante exato do lançamento, para dois lançamentos seguidos no mesmo minuto ficarem na ordem em que foram feitos.
 */
const instante = (digitado: string, inicial: string): string =>
  (digitado === inicial ? new Date() : new Date(digitado)).toISOString()
const qtd = (v: number, unidade: string): string =>
  `${formatNumber(v, v % 1 === 0 ? 0 : 2)} ${unidade}`

/** Linha de resumo: rótulo à esquerda e valor à direita. */
function Linha({
  rotulo,
  valor,
  tom
}: {
  rotulo: string
  valor: string
  tom?: 'warn' | 'danger'
}): ReactNode {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-text-muted">{rotulo}</span>
      <span
        className={
          tom === 'danger'
            ? 'tabular font-semibold text-danger'
            : tom === 'warn'
              ? 'tabular font-semibold text-warn'
              : 'tabular font-semibold text-text'
        }
      >
        {valor}
      </span>
    </div>
  )
}

interface MovimentoProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ativo: AtivoEstoque
  tipo: 'entrada' | 'saida'
}

/** Entrada (recebimento com nota) ou saída. No tanque a quantidade pode ser digitada em toneladas. */
export function MovimentoDialog({ open, onOpenChange, ativo, tipo }: MovimentoProps): ReactNode {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="md">
      {open ? (
        <FormMovimento
          key={`${ativo.id}-${tipo}`}
          ativo={ativo}
          tipo={tipo}
          fechar={() => onOpenChange(false)}
        />
      ) : null}
    </Dialog>
  )
}

function FormMovimento({
  ativo,
  tipo,
  fechar
}: {
  ativo: AtivoEstoque
  tipo: 'entrada' | 'saida'
  fechar: () => void
}): ReactNode {
  const lancar = useLancarMovimento()
  const ehTanque = ativo.tipo === 'tanque'
  const entrada = tipo === 'entrada'
  const [inicial] = useState(agoraLocal)
  const [momento, setMomento] = useState(inicial)
  const [quantidade, setQuantidade] = useState('')
  const [em, setEm] = useState<'L' | 't'>('L')
  const [densidade, setDensidade] = useState(
    ativo.densidade_kg_l ? numeroParaCampo(ativo.densidade_kg_l, 4) : ''
  )
  const [documento, setDocumento] = useState('')
  const [terceiro, setTerceiro] = useState('')
  const [obs, setObs] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [tentou, setTentou] = useState(false)

  const digitado = parseNumero(quantidade)
  const dens = parseNumero(densidade)
  const emToneladas = ehTanque && em === 't'
  // toneladas viram litros pela densidade: 1 t = 1000 kg ÷ (kg/L)
  const naUnidade =
    digitado == null
      ? null
      : emToneladas
        ? dens && dens > 0
          ? Math.round(((digitado * 1000) / dens) * 100) / 100
          : null
        : digitado
  const saldo = ativo.saldo ?? 0
  const depois = naUnidade == null ? null : saldo + (entrada ? naUnidade : -naUnidade)

  const erros: { quantidade?: string; densidade?: string; momento?: string } = {}
  if (!(digitado != null && digitado > 0)) erros.quantidade = 'Informe a quantidade.'
  if (emToneladas && !(dens != null && dens > 0))
    erros.densidade = 'Informe a densidade para converter toneladas em litros.'
  if (!momento) erros.momento = 'Informe a data e a hora.'

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (Object.keys(erros).length > 0 || naUnidade == null) {
      setTentou(true)
      const form = e.currentTarget
      requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    try {
      await lancar.mutateAsync({
        ativo_id: ativo.id,
        tipo,
        momento: instante(momento, inicial),
        quantidade: naUnidade,
        quantidade_informada: emToneladas ? digitado : null,
        unidade_informada: emToneladas ? 't' : null,
        densidade_kg_l: emToneladas ? dens : null,
        documento: documento.trim() || null,
        terceiro: terceiro.trim() || null,
        obs: obs.trim() || null
      })
      toast.success(`${entrada ? 'Entrada' : 'Saída'} de ${qtd(naUnidade, ativo.unidade)} lançada.`)
      fechar()
    } catch (err) {
      setError(`Não foi possível lançar. ${err instanceof Error ? err.message : 'Tente de novo.'}`)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <DialogHeader>
        <DialogTitle>
          {entrada ? 'Lançar entrada' : 'Lançar saída'} em {ativo.nome}
        </DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <DialogErrorBanner message={error} />
        <Campo rotulo="Data e hora" obrigatorio erro={tentou ? erros.momento : undefined}>
          <Input
            type="datetime-local"
            value={momento}
            onChange={(e) => setMomento(e.target.value)}
          />
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo
            rotulo={`Quantidade (${emToneladas ? 't' : ativo.unidade})`}
            obrigatorio
            erro={tentou ? erros.quantidade : undefined}
          >
            <Input
              mascara="decimal"
              casas={emToneladas ? 3 : 2}
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
              data-foco-inicial
            />
          </Campo>
          {ehTanque ? (
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-text">Informar em</span>
              <Segmentado<'L' | 't'>
                rotulo="Informar a quantidade em"
                valor={em}
                aoMudar={setEm}
                opcoes={[
                  { valor: 'L', rotulo: 'Litros' },
                  { valor: 't', rotulo: 'Toneladas', titulo: 'Converte pela densidade' }
                ]}
              />
            </div>
          ) : null}
        </div>
        {emToneladas ? (
          <Campo
            rotulo="Densidade (kg/L)"
            obrigatorio
            erro={tentou ? erros.densidade : undefined}
            dica="A da nota ou do laudo; vem preenchida com a do cadastro do tanque."
          >
            <Input
              mascara="decimal"
              casas={4}
              value={densidade}
              onChange={(e) => setDensidade(e.target.value)}
            />
          </Campo>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo={entrada ? 'Nota ou ticket' : 'Documento'}>
            <Input
              value={documento}
              onChange={(e) => setDocumento(e.target.value)}
              autoComplete="off"
            />
          </Campo>
          <Campo rotulo={entrada ? 'Fornecedor' : 'Destino'}>
            <Input
              value={terceiro}
              onChange={(e) => setTerceiro(e.target.value)}
              autoComplete="off"
              placeholder={entrada ? '' : 'Ex.: usina, espargidor'}
            />
          </Campo>
        </div>
        <Campo rotulo="Observação">
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={2}
            className={AREA_TEXTO}
          />
        </Campo>
        <div className="space-y-1 rounded border border-border bg-bg-elevated p-3">
          <Linha
            rotulo="Saldo agora"
            valor={ativo.saldo == null ? 'Sem saldo' : qtd(saldo, ativo.unidade)}
          />
          {emToneladas && naUnidade != null ? (
            <Linha rotulo="Em litros" valor={qtd(naUnidade, 'L')} />
          ) : null}
          <Linha
            rotulo="Saldo depois"
            valor={depois == null ? '—' : qtd(depois, ativo.unidade)}
            tom={depois != null && depois < 0 ? 'danger' : undefined}
          />
          {depois != null && depois < 0 ? (
            <p className="text-xs text-danger">
              O saldo fica negativo. Confira se falta lançar uma entrada ou uma leitura.
            </p>
          ) : null}
          {depois != null && depois > ativo.capacidade ? (
            <p className="text-xs text-warn">
              O saldo passa da capacidade ({qtd(ativo.capacidade, ativo.unidade)}).
            </p>
          ) : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={fechar} disabled={lancar.isPending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={lancar.isPending}>
          {lancar.isPending ? 'Lançando…' : entrada ? 'Lançar entrada' : 'Lançar saída'}
        </Button>
      </DialogFooter>
    </form>
  )
}

interface LeituraProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ativo: AtivoEstoque
}

/** Leitura de nível: régua do tanque (cm) ou quantidade medida no depósito, com a diferença para o saldo. */
export function LeituraDialog({ open, onOpenChange, ativo }: LeituraProps): ReactNode {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="md">
      {open ? (
        <FormLeitura key={ativo.id} ativo={ativo} fechar={() => onOpenChange(false)} />
      ) : null}
    </Dialog>
  )
}

function FormLeitura({ ativo, fechar }: { ativo: AtivoEstoque; fechar: () => void }): ReactNode {
  const registrar = useRegistrarLeitura()
  const ehTanque = ativo.tipo === 'tanque'
  const { data: tabela } = useTabelaTanque(ehTanque ? ativo.id : null)
  const [inicial] = useState(agoraLocal)
  const [momento, setMomento] = useState(inicial)
  const [leitura, setLeitura] = useState('')
  const [temperatura, setTemperatura] = useState('')
  const [ajustar, setAjustar] = useState(true)
  const [obs, setObs] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [tentou, setTentou] = useState(false)

  const digitado = parseNumero(leitura)
  const topo = tabela && tabela.length > 1 ? tabela.length - 1 : null
  const nivel =
    ehTanque && digitado != null
      ? ativo.leitura_por === 'vazio'
        ? (ativo.altura_referencia_cm ?? 0) - digitado
        : digitado
      : null
  const foraDaRegua = nivel != null && topo != null && (nivel < 0 || nivel > topo)
  const medido = ehTanque
    ? nivel != null && tabela && !foraDaRegua
      ? volumeNaTabela(
          tabela,
          nivelDaLeitura(digitado!, ativo.leitura_por, ativo.altura_referencia_cm)
        )
      : null
    : digitado
  const saldo = ativo.saldo ?? 0
  const diferenca = medido == null ? null : Math.round((medido - saldo) * 100) / 100

  const erros: { leitura?: string; momento?: string } = {}
  if (digitado == null || digitado < 0)
    erros.leitura = ehTanque ? 'Informe a leitura da régua.' : 'Informe a quantidade medida.'
  else if (foraDaRegua)
    erros.leitura = `Fora da régua: a altura do líquido daria ${formatNumber(nivel!, 1)} cm, e o tanque vai de 0 a ${topo} cm.`
  if (!momento) erros.momento = 'Informe a data e a hora.'

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (Object.keys(erros).length > 0) {
      setTentou(true)
      const form = e.currentTarget
      requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    try {
      await registrar.mutateAsync({
        ativo_id: ativo.id,
        momento: instante(momento, inicial),
        leitura_cm: ehTanque ? digitado : null,
        quantidade: ehTanque ? null : digitado,
        temperatura_c: ehTanque ? (parseNumero(temperatura) ?? null) : null,
        ajusta_saldo: ajustar,
        obs: obs.trim() || null
      })
      toast.success(
        ajustar ? 'Leitura registrada e saldo ajustado.' : 'Leitura de conferência registrada.'
      )
      fechar()
    } catch (err) {
      setError(
        `Não foi possível registrar a leitura. ${err instanceof Error ? err.message : 'Tente de novo.'}`
      )
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <DialogHeader>
        <DialogTitle>Registrar leitura de {ativo.nome}</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <DialogErrorBanner message={error} />
        <Campo rotulo="Data e hora" obrigatorio erro={tentou ? erros.momento : undefined}>
          <Input
            type="datetime-local"
            value={momento}
            onChange={(e) => setMomento(e.target.value)}
          />
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo
            rotulo={
              ehTanque
                ? ativo.leitura_por === 'vazio'
                  ? 'Vazio lido na régua (cm)'
                  : 'Altura lida na régua (cm)'
                : `Quantidade medida (${ativo.unidade})`
            }
            obrigatorio
            erro={tentou ? erros.leitura : undefined}
            dica={
              ehTanque && ativo.leitura_por === 'vazio'
                ? `Da boca de medição até o líquido. Boca a ${formatNumber(ativo.altura_referencia_cm ?? 0, 1)} cm do fundo.`
                : undefined
            }
          >
            <Input
              mascara="decimal"
              casas={ehTanque ? 1 : 2}
              value={leitura}
              onChange={(e) => setLeitura(e.target.value)}
              data-foco-inicial
            />
          </Campo>
          {ehTanque ? (
            <Campo rotulo="Temperatura (°C)" dica="Opcional; fica só anotada.">
              <Input
                mascara="decimal"
                casas={1}
                value={temperatura}
                onChange={(e) => setTemperatura(e.target.value)}
              />
            </Campo>
          ) : null}
        </div>
        <div className="space-y-1 rounded border border-border bg-bg-elevated p-3">
          {ehTanque ? (
            <Linha
              rotulo="Altura do líquido"
              valor={nivel != null && !foraDaRegua ? `${formatNumber(nivel, 1)} cm` : '—'}
            />
          ) : null}
          <Linha rotulo="Medido" valor={medido == null ? '—' : qtd(medido, ativo.unidade)} />
          <Linha
            rotulo="Saldo pelos lançamentos"
            valor={ativo.saldo == null ? 'Sem saldo' : qtd(saldo, ativo.unidade)}
          />
          <Linha
            rotulo="Diferença"
            valor={
              diferenca == null
                ? '—'
                : `${diferenca > 0 ? '+' : ''}${qtd(diferenca, ativo.unidade)}`
            }
            tom={diferenca != null && diferenca !== 0 ? 'warn' : undefined}
          />
        </div>
        <label className="flex items-start gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={ajustar}
            onChange={(e) => setAjustar(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
          />
          <span>
            Ajustar o saldo para o medido
            <span className="block text-xs text-text-muted">
              {ajustar
                ? 'O saldo passa a ser o medido; as entradas e saídas seguintes partem dele.'
                : 'Só conferência: a leitura fica no extrato com a diferença e o saldo não muda.'}
            </span>
          </span>
        </label>
        <Campo rotulo="Observação">
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={2}
            className={AREA_TEXTO}
          />
        </Campo>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={fechar} disabled={registrar.isPending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={registrar.isPending}>
          {registrar.isPending ? 'Registrando…' : 'Registrar leitura'}
        </Button>
      </DialogFooter>
    </form>
  )
}
