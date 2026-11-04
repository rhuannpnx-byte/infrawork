/**
 * Tarefa-resumo (o "Sum Task Properties" do ApeX: nome; o início move o bloco inteiro mantendo as distâncias) e as
 * propriedades do plano ("Project Properties": nome, início, prazo, calendário padrão e modo).
 */
import { useState, type ReactNode } from 'react'
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
  useAtualizarPlano,
  useAtualizarTarefa,
  useAtualizarTarefas,
  useCriarGrupo
} from '../hooks/edicao'
import { getWorkDaysBetween } from '@apex/calendar'
import { Calendar } from '@apex/calendar'
import { segParaData, segParaTimestamp, isoParaSeg } from '../motor/tempo'
import { fmtDataLonga, fmtDias } from '../visoes/formato'
import { Campo } from './campos'

export type AlvoGrupo = { id: string } | { novo: true; pai: string | null }

export function GrupoDialog({
  calc,
  alvo,
  somenteLeitura,
  onFechar
}: {
  calc: CalculoCronograma
  alvo: AlvoGrupo | null
  somenteLeitura: boolean
  onFechar: () => void
}): ReactNode {
  return (
    <Dialog open={!!alvo && !!calc.entrada} onOpenChange={(o) => !o && onFechar()} size="sm">
      {alvo && calc.entrada ? (
        <GrupoConteudo
          key={'id' in alvo ? alvo.id : 'novo'}
          calc={calc}
          alvo={alvo}
          somenteLeitura={somenteLeitura}
          onFechar={onFechar}
        />
      ) : null}
    </Dialog>
  )
}

function GrupoConteudo({
  calc,
  alvo,
  somenteLeitura,
  onFechar
}: {
  calc: CalculoCronograma
  alvo: AlvoGrupo
  somenteLeitura: boolean
  onFechar: () => void
}): ReactNode {
  const e = calc.entrada!
  const g = 'id' in alvo ? e.tarefas.find((t) => t.id === alvo.id) : undefined
  const [nome, setNome] = useState(g?.nome ?? '')
  const [erro, setErro] = useState<string | null>(null)
  const atualizar = useAtualizarTarefa()
  const criar = useCriarGrupo()
  const mover = useAtualizarTarefas()
  // descendentes (tarefas) do resumo e o período delas
  const desc = (id: string): string[] =>
    e.tarefas.filter((t) => t.parent_id === id).flatMap((t) => [t.id, ...desc(t.id)])
  const ids = g ? desc(g.id) : []
  const rs = ids
    .map((id) => calc.resultado?.tarefas.get(id))
    .filter((r): r is NonNullable<typeof r> => !!r)
  const ini = rs.length ? Math.min(...rs.map((r) => r.inicio)) : null
  const fim = rs.length ? Math.max(...rs.map((r) => r.fim)) : null
  const spec = calc.resultado
    ? calc.resultado.calendarios[calc.resultado.calendarioPadraoId]
    : undefined
  const [novoInicio, setNovoInicio] = useState(ini !== null ? segParaData(ini) : '')
  const ro = somenteLeitura

  const salvar = async (): Promise<void> => {
    setErro(null)
    if (!nome.trim()) return setErro('Informe o nome.')
    try {
      if (!g && 'novo' in alvo) {
        let nivel = 1
        for (
          let x: string | null = alvo.pai;
          x;
          x = e.tarefas.find((t) => t.id === x)?.parent_id ?? null
        )
          nivel++
        const irmaos = e.tarefas.filter((t) => (t.parent_id ?? null) === alvo.pai)
        await criar.mutateAsync({
          planejamentoId: e.plano.id,
          nome: nome.trim(),
          parent_id: alvo.pai,
          nivel,
          ordem: irmaos.length ? Math.max(...irmaos.map((t) => t.ordem)) + 1 : 0
        })
      } else if (g) {
        if (nome.trim() !== g.nome)
          await atualizar.mutateAsync({
            planejamentoId: e.plano.id,
            id: g.id,
            campos: { nome_custom: nome.trim() }
          })
        // `SumTask::SetBeginTime` [O]: cada tarefa mantém a distância ao início do bloco em horas de trabalho do
        // próprio calendário; vira o início desejado (não ASAP)
        if (ini !== null && novoInicio && novoInicio !== segParaData(ini) && calc.resultado) {
          const destino = isoParaSeg(novoInicio)
          const itens = ids
            .map((id) => {
              const t = e.tarefas.find((x) => x.id === id)
              const r = calc.resultado!.tarefas.get(id)
              if (!t || !r) return null
              const s = calc.resultado!.calendarios[r.calendario_id] ?? spec
              if (!s) return null
              const cal = new Calendar(s)
              const em = cal.WS2AS(
                cal.AS2WS(destino) + (cal.AS2WS(r.inicio) - cal.AS2WS(ini)),
                true
              )
              return { id, inicio_em: segParaTimestamp(em), asap: false }
            })
            .filter((x): x is NonNullable<typeof x> => !!x)
          if (itens.length) await mover.mutateAsync({ planejamentoId: e.plano.id, itens })
        }
      }
      onFechar()
    } catch (x) {
      setErro(traduzirErro(x instanceof Error ? x.message : String(x)))
    }
  }
  const ocupado = criar.isPending || atualizar.isPending || mover.isPending
  return (
    <>
      <DialogHeader>
        <DialogTitle>{g ? 'Tarefa-resumo' : 'Nova tarefa-resumo'}</DialogTitle>
        <DialogDescription>
          Agrupa tarefas na EAP do plano; a barra cobre as tarefas de dentro.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <DialogErrorBanner message={erro} />
        <Campo rotulo="Nome">
          <Input value={nome} onChange={(x) => setNome(x.target.value)} disabled={ro} autoFocus />
        </Campo>
        {g && ini !== null && fim !== null ? (
          <>
            <Campo
              rotulo="Início do bloco"
              dica="Move todas as tarefas de dentro mantendo as distâncias (elas deixam de ser 'o mais cedo possível')"
            >
              <Input
                type="date"
                value={novoInicio}
                onChange={(x) => setNovoInicio(x.target.value)}
                disabled={ro}
              />
            </Campo>
            <p className="text-2xs text-text-dim">
              {fmtDataLonga(ini)} → {fmtDataLonga(fim - 1)}
              {spec ? ` · ${fmtDias(getWorkDaysBetween(new Calendar(spec), ini, fim))}` : ''} ·{' '}
              {rs.length} tarefa(s)
            </p>
          </>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onFechar} disabled={ocupado}>
          {ro ? 'Fechar' : 'Cancelar'}
        </Button>
        {!ro ? (
          <Button onClick={() => void salvar()} disabled={ocupado}>
            {g ? 'Salvar' : 'Criar'}
          </Button>
        ) : null}
      </DialogFooter>
    </>
  )
}

export function PlanoDialog({
  calc,
  aberto,
  somenteLeitura,
  onFechar
}: {
  calc: CalculoCronograma
  aberto: boolean
  somenteLeitura: boolean
  onFechar: () => void
}): ReactNode {
  return (
    <Dialog open={aberto && !!calc.entrada} onOpenChange={(o) => !o && onFechar()} size="md">
      {aberto && calc.entrada ? (
        <PlanoConteudo calc={calc} somenteLeitura={somenteLeitura} onFechar={onFechar} />
      ) : null}
    </Dialog>
  )
}

function PlanoConteudo({
  calc,
  somenteLeitura,
  onFechar
}: {
  calc: CalculoCronograma
  somenteLeitura: boolean
  onFechar: () => void
}): ReactNode {
  const e = calc.entrada!
  const p = e.plano
  const [nome, setNome] = useState(p.nome)
  const [inicio, setInicio] = useState(p.inicio)
  const [prazo, setPrazo] = useState(p.prazo ?? '')
  const [calendario, setCalendario] = useState(p.calendario_id ?? '')
  const [modo, setModo] = useState(p.modo)
  const [dataControle, setDataControle] = useState(p.data_controle ?? '')
  const [erro, setErro] = useState<string | null>(null)
  const atualizar = useAtualizarPlano()
  const ro = somenteLeitura

  const salvar = async (): Promise<void> => {
    setErro(null)
    if (!nome.trim()) return setErro('Informe o nome do plano.')
    if (!inicio) return setErro('Informe o início do plano.')
    if (prazo && prazo < inicio) return setErro('O prazo não pode ser antes do início.')
    if (modo === 'controle' && dataControle && dataControle < inicio)
      return setErro('A data de controle não pode ser antes do início do plano.')
    try {
      await atualizar.mutateAsync({
        planejamentoId: p.id,
        campos: {
          nome: nome.trim(),
          data_referencia_inicio: inicio,
          prazo: prazo || null,
          calendario_id: calendario || null,
          modo,
          ...(modo === 'controle' ? { data_date: dataControle || null } : {})
        }
      })
      onFechar()
    } catch (x) {
      setErro(traduzirErro(x instanceof Error ? x.message : String(x)))
    }
  }
  const fim = calc.resultado?.fimProjeto
  return (
    <>
      <DialogHeader>
        <DialogTitle>Propriedades do plano</DialogTitle>
        <DialogDescription>
          {p.is_baseline
            ? 'Linha de base travada: somente leitura.'
            : 'Início, prazo e calendário valem para todo o cronograma.'}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <DialogErrorBanner message={erro} />
        <Campo rotulo="Nome">
          <Input value={nome} onChange={(x) => setNome(x.target.value)} disabled={ro} />
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Início" dica="Nenhuma tarefa começa antes do início do plano">
            <Input
              type="date"
              value={inicio}
              onChange={(x) => setInicio(x.target.value)}
              disabled={ro}
            />
          </Campo>
          <Campo
            rotulo="Prazo"
            dica="Tarefas que terminam depois do prazo recebem a bandeira de violação"
          >
            <Input
              type="date"
              value={prazo}
              onChange={(x) => setPrazo(x.target.value)}
              disabled={ro}
            />
          </Campo>
          <Campo rotulo="Calendário padrão">
            <Select
              value={calendario}
              onChange={(x) => setCalendario(x.target.value)}
              disabled={ro}
            >
              <option value="">Padrão da obra</option>
              {e.calendarios.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                  {c.padrao ? ' (padrão da obra)' : ''}
                </option>
              ))}
            </Select>
          </Campo>
          <Campo
            rotulo="Modo"
            dica="Controle: mostra o realizado e a previsão a partir da produção lançada"
          >
            <Select
              value={modo}
              onChange={(x) => setModo(x.target.value as typeof modo)}
              disabled={ro}
            >
              <option value="programacao">Programação</option>
              <option value="controle">Controle</option>
            </Select>
          </Campo>
          {modo === 'controle' ? (
            <Campo
              rotulo="Data de controle"
              dica="O realizado vale até o fim deste dia; a previsão parte dele. Vazio = hoje (uma data futura também vale como hoje)"
            >
              <div className="flex items-center gap-1">
                <Input
                  type="date"
                  value={dataControle}
                  onChange={(x) => setDataControle(x.target.value)}
                  disabled={ro}
                />
                {dataControle && !ro ? (
                  <Button variant="ghost" size="sm" onClick={() => setDataControle('')}>
                    Hoje
                  </Button>
                ) : null}
              </div>
            </Campo>
          ) : null}
        </div>
        {fim ? (
          <p className="text-2xs text-text-dim">
            Término calculado: <span className="text-text-muted">{fmtDataLonga(fim)}</span>
            {prazo && segParaData(fim) > prazo ? (
              <span className="ml-2 text-danger">⚑ depois do prazo</span>
            ) : null}
          </p>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onFechar} disabled={atualizar.isPending}>
          {ro ? 'Fechar' : 'Cancelar'}
        </Button>
        {!ro ? (
          <Button onClick={() => void salvar()} disabled={atualizar.isPending}>
            Salvar
          </Button>
        ) : null}
      </DialogFooter>
    </>
  )
}
