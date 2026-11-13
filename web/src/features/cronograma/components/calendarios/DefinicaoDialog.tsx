/**
 * Definição do calendário (os diálogos `EditHolidayDlg`, `EditWeekdayDayoffDlg` e `EditWorkTimeSpanDlg` do ApeX):
 * feriado ou período sem trabalho (opcionalmente todo ano), feriados móveis, folga anual num dia da semana e horário
 * excepcional (outra semana num período — vale também sobre feriados).
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
import { cn } from '@/lib/utils'
import { useSalvarDefinicoes, type CalendarioRow, type DefinicaoRow } from '../../hooks/calendarios'
import type { DiaSemana, TipoDefinicao } from '../../motor/tipos'
import { lerNumero } from '../campos-util'
import { Caixa, Campo, enterEnvia, useErroForm } from '../campos'
import { NOME_DIA } from './texto'

export interface AlvoDefinicao {
  calendario: CalendarioRow
  tipo: TipoDefinicao
  def?: DefinicaoRow
}

const TITULO: Record<TipoDefinicao, string> = {
  feriado: 'Feriado ou período sem trabalho',
  pascoa: 'Feriados móveis',
  folga_semana: 'Folga anual num dia da semana',
  horario_excecao: 'Horário excepcional'
}

export function DefinicaoDialog({
  obraId,
  alvo,
  onFechar
}: {
  obraId: string
  alvo: AlvoDefinicao | null
  onFechar: () => void
}): ReactNode {
  return (
    <Dialog
      open={!!alvo}
      onOpenChange={(o) => !o && onFechar()}
      size={alvo?.tipo === 'horario_excecao' ? 'lg' : 'md'}
    >
      {alvo ? (
        <Conteudo key={alvo.def?.id ?? alvo.tipo} obraId={obraId} alvo={alvo} onFechar={onFechar} />
      ) : null}
    </Dialog>
  )
}

function Conteudo({
  obraId,
  alvo,
  onFechar
}: {
  obraId: string
  alvo: AlvoDefinicao
  onFechar: () => void
}): ReactNode {
  const d = alvo.def
  const hoje = new Date().toISOString().slice(0, 10)
  const [nome, setNome] = useState(d?.nome ?? (alvo.tipo === 'pascoa' ? 'Feriados móveis' : ''))
  const [ini, setIni] = useState(d?.data_inicio ?? hoje)
  const [fim, setFim] = useState(d?.data_fim ?? hoje)
  const [todoAno, setTodoAno] = useState(d?.todo_ano ?? alvo.tipo === 'feriado')
  const [diaSemana, setDiaSemana] = useState(d?.dia_semana ?? 0)
  const [semana, setSemana] = useState<DiaSemana[]>(
    d?.semana ?? alvo.calendario.semana.map((x) => ({ inicio: x.inicio, horas: Number(x.horas) }))
  )
  const erro = useErroForm()
  const salvar = useSalvarDefinicoes(obraId)

  const gravar = (): void => {
    erro.limpar()
    const t = alvo.tipo
    if (t !== 'pascoa' && !nome.trim()) return erro.falhar('Informe o nome.', 'nome')
    if (t !== 'pascoa' && !ini)
      return erro.falhar(t === 'folga_semana' ? 'Informe a data.' : 'Informe o início.', 'ini')
    if ((t === 'feriado' || t === 'horario_excecao') && !fim)
      return erro.falhar('Informe o fim do período.', 'fim')
    if ((t === 'feriado' || t === 'horario_excecao') && fim < ini)
      return erro.falhar('O fim do período não pode ser antes do início.', 'fim')
    if (t === 'horario_excecao' && semana.some((x) => !(x.horas >= 0 && x.horas <= 24)))
      return erro.falhar('As horas de cada dia vão de 0 a 24.')
    salvar.mutate(
      [
        {
          id: d?.id ?? null,
          calendario_id: alvo.calendario.id,
          tipo: t,
          nome: nome.trim(),
          data_inicio: t === 'pascoa' ? null : ini,
          data_fim: t === 'feriado' || t === 'horario_excecao' ? fim : null,
          todo_ano: t === 'feriado' ? todoAno : false,
          dia_semana: t === 'folga_semana' ? diaSemana : null,
          semana: t === 'horario_excecao' ? semana : null,
          ordem: d?.ordem ?? alvo.calendario.definicoes.length
        }
      ],
      {
        onSuccess: onFechar,
        onError: (e) => erro.falhar(`Não foi possível salvar. ${e.message}`)
      }
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{TITULO[alvo.tipo]}</DialogTitle>
        <DialogDescription>Calendário {alvo.calendario.nome}</DialogDescription>
      </DialogHeader>
      <DialogBody>
        <div ref={erro.caixa} className="space-y-3" onKeyDown={enterEnvia(gravar)}>
        <DialogErrorBanner message={erro.geral} />
        <Campo rotulo="Nome" erro={erro.de('nome')}>
          <Input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            data-foco-inicial
            placeholder={alvo.tipo === 'feriado' ? 'Ex.: Aniversário da cidade' : ''}
          />
        </Campo>
        {alvo.tipo === 'pascoa' ? (
          <p className="text-xs text-text-muted">
            Calculados pela data da Páscoa de cada ano: segunda e terça de Carnaval, Sexta-feira
            Santa e Corpus Christi. Para trabalhar num deles, inclua um horário excepcional naquele
            dia.
          </p>
        ) : null}
        {alvo.tipo === 'feriado' || alvo.tipo === 'horario_excecao' ? (
          <div className="grid grid-cols-2 items-start gap-3">
            <Campo rotulo="De" erro={erro.de('ini')}>
              <Input type="date" value={ini} onChange={(e) => setIni(e.target.value)} />
            </Campo>
            <Campo rotulo="Até (inclusive)" erro={erro.de('fim')}>
              <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
            </Campo>
          </div>
        ) : null}
        {alvo.tipo === 'feriado' ? (
          <Caixa marcado={todoAno} onMudar={setTodoAno}>
            Repetir todo ano (mesmo dia e mês)
          </Caixa>
        ) : null}
        {alvo.tipo === 'folga_semana' ? (
          <div className="grid grid-cols-2 items-start gap-3">
            <Campo rotulo="Dia da semana">
              <Select
                value={String(diaSemana)}
                onChange={(e) => setDiaSemana(Number(e.target.value))}
              >
                {NOME_DIA.map((n, i) => (
                  <option key={i} value={i}>
                    {n}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo
              rotulo="A partir de (dia e mês)"
              dica="Todo ano, o primeiro dia da semana escolhido a partir desta data"
              erro={erro.de('ini')}
            >
              <Input type="date" value={ini} onChange={(e) => setIni(e.target.value)} />
            </Campo>
          </div>
        ) : null}
        {alvo.tipo === 'horario_excecao' ? (
          <div>
            <div className="mb-1 text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
              Semana no período (vale também sobre feriados)
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {semana.map((x, i) => (
                <div
                  key={i}
                  className={cn(
                    'rounded border p-1.5',
                    x.horas > 0 ? 'border-border-strong bg-bg-elevated' : 'border-border'
                  )}
                >
                  <div className="mb-1 text-xs text-text">{NOME_DIA[i]!.slice(0, 3)}</div>
                  <Input
                    type="time"
                    aria-label={`Início ${NOME_DIA[i]}`}
                    value={x.inicio}
                    onChange={(e) =>
                      setSemana(
                        semana.map((y, j) =>
                          j === i ? { ...y, inicio: e.target.value || '07:00' } : y
                        )
                      )
                    }
                    className="mb-1 h-7 px-1 text-xs [&::-webkit-calendar-picker-indicator]:hidden"
                  />
                  <Input
                    value={String(x.horas).replace('.', ',')}
                    inputMode="decimal"
                    aria-label={`Horas ${NOME_DIA[i]}`}
                    onChange={(e) => {
                      const v = lerNumero(e.target.value)
                      setSemana(
                        semana.map((y, j) =>
                          j === i
                            ? { ...y, horas: v === null ? 0 : Math.max(0, Math.min(24, v)) }
                            : y
                        )
                      )
                    }}
                    className="h-7 px-1 text-right text-xs tabular"
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onFechar} disabled={salvar.isPending}>
          Cancelar
        </Button>
        <Button onClick={gravar} disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : d ? 'Salvar' : 'Incluir'}
        </Button>
      </DialogFooter>
    </>
  )
}
