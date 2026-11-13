/**
 * Planos da obra dentro do cronograma: o seletor (plano em edição + linhas de base), a trava como linha de base e,
 * com uma linha de base aberta, a faixa de somente leitura com as ações dela.
 */
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CopyPlus,
  GitCompare,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  RotateCcw,
  Star,
  StarOff,
  Trash2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover } from '@/components/ui/popover'
import {
  Dialog,
  DialogBody,
  DialogErrorBanner,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { cn } from '@/lib/utils'
import { fmtBRL, fmtQtd } from '@/lib/money'
import { contar } from '@/lib/rotulos'
import { fmtDataBR } from '@/features/planejamento/lib/dates'
import {
  useCadeiaTrava,
  useCopiarPlanejamento,
  useDeletePlanejamento,
  useDesmarcarVigente,
  useLbPremissasDiff,
  useMarcarVigente,
  useRestaurarLinhaBase,
  type PremissasDiff
} from '@/features/planejamento/hooks/planejamentos'
import { NewPlanejamentoDialog } from '@/features/planejamento/modals/NewPlanejamentoDialog'
import { PromoverBaselineDialog } from '@/features/planejamento/modals/PromoverBaselineDialog'
import type { Planejamento } from '@/types/planejamento'

export const MAX_LB = 20

const travadaEm = (p: Planejamento): string =>
  p.travada_em ? fmtDataBR(p.travada_em.slice(0, 10)) : '—'

/** Sem vigente, a última linha de base que foi vigente segue como régua provisória. */
function referenciaProvisoria(lbs: Planejamento[]): string | null {
  if (lbs.some((p) => p.vigente)) return null
  const com = lbs
    .filter((p) => p.vigente_em)
    .sort((a, b) => (b.vigente_em! > a.vigente_em! ? 1 : -1))
  return com[0]?.id ?? null
}

interface SeletorProps {
  obraId: string
  planos: Planejamento[]
  plano: Planejamento
  podeGerir: boolean
  onEscolher: (id: string) => void
}

/** Botão do plano aberto + lista: plano em edição em cima, linhas de base abaixo (vigente com ★). */
export function SeletorPlano({
  obraId,
  planos,
  plano,
  podeGerir,
  onEscolher
}: SeletorProps): ReactNode {
  const navigate = useNavigate()
  const [aberto, setAberto] = useState(false)
  const [novo, setNovo] = useState(false)
  const [travar, setTravar] = useState(false)
  const { data: trava } = useCadeiaTrava(obraId)
  const edicao = planos.find((p) => !p.is_baseline) ?? null
  const lbs = planos.filter((p) => p.is_baseline)
  const provisoria = referenciaProvisoria(lbs)
  const confirm = useConfirm()
  const excluir = useDeletePlanejamento()
  const escolher = (id: string): void => {
    onEscolher(id)
    setAberto(false)
  }
  const excluirEdicao = async (p: Planejamento): Promise<void> => {
    setAberto(false)
    const ok = await confirm({
      title: `Excluir "${p.nome}"?`,
      description: 'Sem volta. As tarefas e dependências do plano em edição são removidas.',
      confirmLabel: 'Excluir',
      variant: 'danger'
    })
    if (!ok) return
    excluir.mutate(
      { id: p.id, obra_id: obraId },
      {
        onSuccess: () => {
          toast.success('Plano em edição excluído.')
          const lb = lbs.find((x) => x.vigente) ?? lbs[0]
          if (lb) onEscolher(lb.id)
        },
        onError: (e) => void toast.error(`Não foi possível excluir o plano. ${e.message}`)
      }
    )
  }

  return (
    <>
      <Popover
        open={aberto}
        onOpenChange={setAberto}
        align="end"
        className="w-[380px] p-0"
        trigger={
          <button
            type="button"
            aria-label={`Plano: ${plano.nome} ${plano.is_baseline ? (plano.vigente ? 'linha de base vigente' : 'linha de base') : 'em edição'}`}
            aria-expanded={aberto}
            title="Escolher o plano aberto"
            data-testid="seletor-plano"
            onClick={() => setAberto((o) => !o)}
            className={cn(
              'flex h-7 max-w-[320px] items-center gap-1.5 rounded border px-2 text-xs',
              'border-border-strong bg-bg-elevated text-text hover:border-accent-line hover:bg-bg-hover'
            )}
          >
            {plano.is_baseline ? (
              <Lock size={12} className={plano.vigente ? 'text-warn' : 'text-text-dim'} />
            ) : (
              <Pencil size={12} className="text-accent" />
            )}
            <span className="truncate">{plano.nome}</span>
            <span className="shrink-0 text-xs text-text-muted">
              {plano.is_baseline
                ? plano.vigente
                  ? 'linha de base vigente'
                  : 'linha de base'
                : 'em edição'}
            </span>
            <ChevronDown size={12} className="shrink-0 text-text-dim" />
          </button>
        }
      >
        <div className="max-h-[70vh] overflow-auto py-1">
          <Titulo>Plano em edição</Titulo>
          {edicao ? (
            <ItemPlano
              p={edicao}
              atual={edicao.id === plano.id}
              onClick={() => escolher(edicao.id)}
            >
              <span className="text-xs text-text-muted">
                início {fmtDataBR(edicao.data_referencia_inicio)}
              </span>
            </ItemPlano>
          ) : (
            <div className="px-3 py-1.5 text-xs text-text-muted">
              Nenhum. Para replanejar, abra uma linha de base e use “Editar a partir desta”.
            </div>
          )}
          {podeGerir && !edicao ? (
            <button
              type="button"
              onClick={() => {
                setAberto(false)
                setNovo(true)
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-accent hover:bg-bg-hover"
            >
              <Plus size={12} /> Novo plano em edição
            </button>
          ) : null}
          {podeGerir && edicao ? (
            <button
              type="button"
              onClick={() => void excluirEdicao(edicao)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-dim hover:bg-bg-hover hover:text-danger"
            >
              <Trash2 size={12} /> Excluir plano em edição
            </button>
          ) : null}

          <Titulo>
            Linhas de base ({lbs.length}/{MAX_LB})
          </Titulo>
          {lbs.length === 0 ? (
            <div className="px-3 py-1.5 text-xs text-text-muted">
              Nenhuma. Trave o plano em edição quando ele for aprovado.
            </div>
          ) : (
            lbs.map((p) => (
              <ItemPlano key={p.id} p={p} atual={p.id === plano.id} onClick={() => escolher(p.id)}>
                <span className="text-xs text-text-muted">travada {travadaEm(p)}</span>
                {p.vigente ? <Badge variant="accent">vigente</Badge> : null}
                {p.id === provisoria ? <Badge variant="warn">provisória</Badge> : null}
              </ItemPlano>
            ))
          )}

          <div className="mt-1 border-t border-border px-3 pt-2 pb-1">
            <div
              className={cn(
                'flex items-start gap-1.5 text-xs',
                trava ? 'text-warn' : 'text-success'
              )}
            >
              {trava ? (
                <Lock size={12} className="mt-px shrink-0" />
              ) : (
                <LockOpen size={12} className="mt-px shrink-0" />
              )}
              <span>
                {trava
                  ? `Orçamento, composições e recursos travados: ${trava}.`
                  : 'Orçamento, composições e recursos editáveis.'}
              </span>
            </div>
            {lbs.length > 0 ? (
              <button
                type="button"
                onClick={() => void navigate({ to: '/planejamento/comparar' })}
                className="mt-1.5 flex h-6 items-center gap-1.5 text-xs text-text-muted hover:text-accent"
              >
                <GitCompare size={12} /> Comparar planos
              </button>
            ) : null}
          </div>
        </div>
      </Popover>

      {podeGerir && !plano.is_baseline ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setTravar(true)}
          disabled={lbs.length >= MAX_LB}
          title={
            lbs.length >= MAX_LB
              ? `Limite de ${MAX_LB} linhas de base`
              : 'Congela o plano como linha de base'
          }
        >
          <Lock size={12} /> Travar como linha de base
        </Button>
      ) : null}

      <NewPlanejamentoDialog
        open={novo}
        onOpenChange={setNovo}
        obraId={obraId}
        onCreated={(id) => onEscolher(id)}
      />
      <PromoverBaselineDialog
        open={travar}
        onOpenChange={setTravar}
        planejamento={travar ? plano : null}
        obraId={obraId}
        temVigente={lbs.some((p) => p.vigente)}
        totalLinhasBase={lbs.length}
      />
    </>
  )
}

function Titulo({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="px-3 pt-2 pb-1 text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
      {children}
    </div>
  )
}

function ItemPlano({
  p,
  atual,
  onClick,
  children
}: {
  p: Planejamento
  atual: boolean
  onClick: () => void
  children: ReactNode
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-bg-hover',
        atual && 'bg-bg-hover'
      )}
    >
      <span className="w-3 shrink-0">
        {atual ? <Check size={12} className="text-accent" /> : null}
      </span>
      {p.is_baseline ? (
        <Star
          size={12}
          className={cn('shrink-0', p.vigente ? 'fill-warn text-warn' : 'text-text-dim/40')}
        />
      ) : (
        <Pencil size={12} className="shrink-0 text-accent" />
      )}
      <span className={cn('min-w-0 flex-1 truncate', p.vigente && 'font-semibold text-accent')}>
        {p.nome}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">{children}</span>
    </button>
  )
}

interface FaixaProps {
  obraId: string
  plano: Planejamento
  planos: Planejamento[]
  podeGerir: boolean
  onEscolher: (id: string) => void
}

/** Linha de base aberta: avisa que é somente leitura e reúne as ações dela. */
export function FaixaLinhaBase({
  obraId,
  plano,
  planos,
  podeGerir,
  onEscolher
}: FaixaProps): ReactNode {
  const confirm = useConfirm()
  const { data: diff } = useLbPremissasDiff(plano.id)
  const copiar = useCopiarPlanejamento()
  const marcar = useMarcarVigente()
  const desmarcar = useDesmarcarVigente()
  const restaurar = useRestaurarLinhaBase()
  const excluir = useDeletePlanejamento()
  const [verDiff, setVerDiff] = useState(false)
  const [nomeDe, setNomeDe] = useState<'editar' | 'restaurar' | null>(null)
  const edicao = planos.find((p) => !p.is_baseline) ?? null
  const lbs = planos.filter((p) => p.is_baseline)
  const mudou = !!diff?.mudou
  const provisoria = referenciaProvisoria(lbs) === plano.id
  const falha = (e: unknown): void =>
    void toast.error(
      `Não foi possível concluir a operação na linha de base.${e instanceof Error ? ` ${e.message}` : ''}`
    )

  const tornarVigente = async (): Promise<void> => {
    const ok = await confirm({
      title: `Tornar "${plano.nome}" a linha de base vigente?`,
      description:
        'Ela passa a ser a régua do acompanhamento. Enquanto houver vigente, orçamento, composições e recursos ficam travados (aditivos e reajustes continuam permitidos).',
      confirmLabel: 'Tornar vigente'
    })
    if (!ok) return
    marcar.mutate(
      { planejamento_id: plano.id, obra_id: obraId },
      { onSuccess: () => void toast.success('Linha de base vigente atualizada.'), onError: falha }
    )
  }
  const desmarcarVigente = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Desmarcar a vigente para replanejar?',
      description:
        'O orçamento, as composições e os recursos voltam a ser editáveis pelo plano em edição. Até marcar outra vigente, o acompanhamento segue usando esta como referência provisória.',
      confirmLabel: 'Desmarcar'
    })
    if (!ok) return
    desmarcar.mutate(
      { obra_id: obraId },
      {
        onSuccess: () => void toast.success('Sem vigente: replanejamento liberado.'),
        onError: falha
      }
    )
  }
  const remover = async (): Promise<void> => {
    const ok = await confirm({
      title: `Excluir "${plano.nome}"?`,
      description: 'Sem volta. A linha de base e suas premissas são removidas.',
      confirmLabel: 'Excluir',
      variant: 'danger'
    })
    if (!ok) return
    excluir.mutate(
      { id: plano.id, obra_id: obraId },
      {
        onSuccess: () => {
          toast.success('Linha de base excluída.')
          const outro = edicao ?? lbs.find((p) => p.id !== plano.id)
          if (outro) onEscolher(outro.id)
        },
        onError: falha
      }
    )
  }
  const criar = async (nome: string): Promise<void> => {
    if (nomeDe === 'editar') {
      const r = await copiar.mutateAsync({ origem_id: plano.id, nome_novo: nome, obra_id: obraId })
      toast.success(
        r.tarefas_ajustadas > 0
          ? `Plano em edição criado: ${contar(r.tarefas_ajustadas, 'tarefa ajustada', 'tarefas ajustadas')} à quantidade atual do orçamento.`
          : 'Plano em edição criado.'
      )
      onEscolher(r.novo_id)
    } else {
      const r = await restaurar.mutateAsync({
        planejamento_id: plano.id,
        nome_novo: nome,
        obra_id: obraId
      })
      toast.success(`Nova linha de base criada. "${plano.nome}" ficou intacta.`)
      onEscolher(r.novo_id)
    }
  }

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-warn/40 bg-warn/10 px-4 py-1.5 text-xs"
      data-testid="faixa-linha-base"
    >
      <Lock size={13} className="shrink-0 text-warn" />
      <span className="text-text">
        <strong>Linha de base{plano.vigente ? ' vigente' : ''}</strong> · travada em{' '}
        {travadaEm(plano)} · somente leitura
        {provisoria ? (
          <span className="text-warn"> · referência provisória do acompanhamento</span>
        ) : null}
      </span>
      {mudou ? (
        <button
          type="button"
          onClick={() => setVerDiff(true)}
          className="flex h-6 items-center gap-1 text-warn hover:underline"
          title="Ver o que mudou no orçamento e no calendário desde a trava"
        >
          <AlertTriangle size={12} /> Premissas mudaram
        </button>
      ) : null}

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        {edicao ? (
          <Button size="sm" variant="ghost" onClick={() => onEscolher(edicao.id)}>
            <Pencil size={12} /> Ir para o plano em edição
          </Button>
        ) : podeGerir ? (
          <Button size="sm" variant="secondary" onClick={() => setNomeDe('editar')}>
            <CopyPlus size={12} /> Editar a partir desta
          </Button>
        ) : null}
        {podeGerir ? (
          <>
            {plano.vigente ? (
              <Button size="sm" variant="ghost" onClick={() => void desmarcarVigente()}>
                <StarOff size={12} /> Desmarcar vigente
              </Button>
            ) : !mudou ? (
              <Button size="sm" variant="ghost" onClick={() => void tornarVigente()}>
                <Star size={12} /> Tornar vigente
              </Button>
            ) : null}
            {mudou ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setNomeDe('restaurar')}
                disabled={!!edicao || restaurar.isPending}
                title={
                  edicao
                    ? 'Exclua ou trave o plano em edição antes de restaurar'
                    : 'Cria uma nova linha de base com as premissas atuais; esta fica intacta'
                }
              >
                <RotateCcw size={12} /> Restaurar com premissas atuais
              </Button>
            ) : null}
            {!plano.vigente ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void remover()}
                className="hover:text-danger"
                aria-label="Excluir linha de base"
                title="Excluir linha de base"
              >
                <Trash2 size={12} />
              </Button>
            ) : null}
          </>
        ) : null}
      </div>

      {diff && verDiff ? (
        <PremissasDialog nome={plano.nome} diff={diff} onClose={() => setVerDiff(false)} />
      ) : null}
      {nomeDe ? (
        <NomeDialog
          titulo={
            nomeDe === 'editar' ? 'Novo plano em edição' : 'Restaurar como nova linha de base'
          }
          texto={
            nomeDe === 'editar'
              ? `O plano em edição começa como cópia de "${plano.nome}", com as tarefas ajustadas à quantidade atual do orçamento. A linha de base não muda.`
              : `Uma cópia de "${plano.nome}" é recalculada com as premissas atuais e travada como nova linha de base. A original fica intacta.`
          }
          padrao={nomeDe === 'editar' ? `${plano.nome} — rev.` : `${plano.nome} — restaurada`}
          rotulo={nomeDe === 'editar' ? 'Criar plano em edição' : 'Restaurar'}
          onConfirmar={criar}
          onClose={() => setNomeDe(null)}
        />
      ) : null}
    </div>
  )
}

function NomeDialog({
  titulo,
  texto,
  padrao,
  rotulo,
  onConfirmar,
  onClose
}: {
  titulo: string
  texto: string
  padrao: string
  rotulo: string
  onConfirmar: (nome: string) => Promise<void>
  onClose: () => void
}): ReactNode {
  const [nome, setNome] = useState(padrao)
  const [erro, setErro] = useState<string | null>(null)
  const [semNome, setSemNome] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const enviar = async (): Promise<void> => {
    if (!nome.trim()) {
      setSemNome(true)
      document.getElementById('nome-plano')?.focus()
      return
    }
    setSemNome(false)
    setErro(null)
    setEnviando(true)
    try {
      await onConfirmar(nome.trim())
      onClose()
    } catch (e) {
      setErro(
        `Não foi possível criar o plano.${e instanceof Error ? ` ${e.message}` : ''}`
      )
    } finally {
      setEnviando(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="md" disableDismiss={enviando}>
      <DialogHeader>
        <DialogTitle>{titulo}</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <DialogErrorBanner message={erro} />
        <p className="text-xs text-text-muted">{texto}</p>
        <div className="space-y-1">
          <Label htmlFor="nome-plano">Nome</Label>
          <Input
            id="nome-plano"
            value={nome}
            data-foco-inicial
            aria-invalid={semNome ? true : undefined}
            aria-describedby={semNome ? 'nome-plano-erro' : undefined}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void enviar()}
          />
          {semNome ? (
            <span id="nome-plano-erro" role="alert" className="text-xs font-medium text-danger">
              Informe o nome do plano.
            </span>
          ) : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={enviando}>
          Cancelar
        </Button>
        <Button onClick={() => void enviar()} disabled={enviando}>
          {enviando ? 'Criando…' : rotulo}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function par(v: [number, number] | null, fmt: (n: number) => string): ReactNode {
  if (!v) return <span className="text-text-dim">—</span>
  return (
    <span>
      {fmt(Number(v[0] ?? 0))} → <strong className="text-warn">{fmt(Number(v[1] ?? 0))}</strong>
    </span>
  )
}

function PremissasDialog({
  nome,
  diff,
  onClose
}: {
  nome: string
  diff: PremissasDiff
  onClose: () => void
}): ReactNode {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="lg">
      <DialogHeader>
        <DialogTitle>Premissas que mudaram: {nome}</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3 text-left">
        <p className="text-xs text-text-muted">
          A linha de base continua com os valores da época em que foi travada. Para usar as
          premissas atuais, restaure-a como nova linha de base (a original fica intacta).
        </p>
        {diff.calendario ? (
          <div className="text-xs text-warn">
            Calendário da obra mudou (dias úteis, feriados ou fatores de produtividade).
          </div>
        ) : null}
        {diff.itens.length > 0 ? (
          <div
            className="max-h-[50vh] overflow-auto rounded border border-border"
            tabIndex={0}
            role="region"
            aria-label="Serviços com premissa alterada"
          >
            <table className="w-full text-xs tabular">
              <thead className="sticky top-0 bg-bg-elevated text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
                <tr className="border-b border-border">
                  <th className="px-2 py-1 text-left">Serviço</th>
                  <th className="px-2 py-1 text-right">Quantidade</th>
                  <th className="px-2 py-1 text-right">Venda</th>
                  <th className="px-2 py-1 text-right">Custo unit.</th>
                  <th className="px-2 py-1 text-right">Produção/dia</th>
                </tr>
              </thead>
              <tbody>
                {diff.itens.map((it) => (
                  <tr key={it.item_orcamentario_id} className="border-b border-border">
                    <td className="px-2 py-1 text-text">
                      {it.codigo} · {it.descricao}
                    </td>
                    <td className="px-2 py-1 text-right">{par(it.quantidade, fmtQtd)}</td>
                    <td className="px-2 py-1 text-right">{par(it.venda, fmtBRL)}</td>
                    <td className="px-2 py-1 text-right">{par(it.custo_unit, fmtBRL)}</td>
                    <td className="px-2 py-1 text-right">{par(it.producao, fmtQtd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
