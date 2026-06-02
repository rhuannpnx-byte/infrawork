// ConstraintPopover — edição inline de constraint MS Project (snet/snlt/fnet/
// fnlt/mso/mfo) + schedule_mode (asap/alap) por tarefa, ancorado na célula.

import { useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  CONSTRAINT_LABEL,
  SCHEDULE_MODE_LABEL,
  type ConstraintType,
  type ScheduleMode
} from '@/types/planejamento'
import { AnchoredPopover } from './AnchoredPopover'

interface Props {
  anchorRect: DOMRect
  currentScheduleMode: ScheduleMode
  currentConstraintType: ConstraintType | null
  currentConstraintDate: string | null
  /** Marco: limita opções a MSO/MFO + sem ALAP (marco não tem folga). */
  isMarco?: boolean
  onSave: (patch: {
    schedule_mode: ScheduleMode
    constraint_type: ConstraintType | null
    constraint_date: string | null
  }) => void
  onClose: () => void
}

export function ConstraintPopover({
  anchorRect,
  currentScheduleMode,
  currentConstraintType,
  currentConstraintDate,
  isMarco,
  onSave,
  onClose
}: Props): ReactNode {
  const [smode, setSmode] = useState<ScheduleMode>(currentScheduleMode)
  const [ctype, setCtype] = useState<'' | ConstraintType>(currentConstraintType ?? '')
  const [cdate, setCdate] = useState(currentConstraintDate ?? '')

  const tiposPermitidos: ConstraintType[] = isMarco
    ? ['mso', 'mfo']
    : (Object.keys(CONSTRAINT_LABEL) as ConstraintType[])

  function handleSave(): void {
    // Constraint só faz sentido com data; se um vier sem outro, salva como NULL.
    const tipoFinal: ConstraintType | null = ctype && cdate ? ctype : null
    onSave({
      schedule_mode: smode,
      constraint_type: tipoFinal,
      constraint_date: tipoFinal ? cdate : null
    })
    onClose()
  }

  function handleClear(): void {
    onSave({
      schedule_mode: 'asap',
      constraint_type: null,
      constraint_date: null
    })
    onClose()
  }

  return (
    <AnchoredPopover anchorRect={anchorRect} onClose={onClose} minWidth={280}>
      <div className="p-3 space-y-2.5">
        {!isMarco ? (
          <div>
            <Label htmlFor="cp-smode">Agendamento</Label>
            <Select
              id="cp-smode"
              value={smode}
              onChange={(e) => setSmode(e.target.value as ScheduleMode)}
            >
              {(Object.keys(SCHEDULE_MODE_LABEL) as ScheduleMode[]).map((m) => (
                <option key={m} value={m}>
                  {SCHEDULE_MODE_LABEL[m]}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        <div>
          <Label htmlFor="cp-ctype">Tipo de restrição</Label>
          <Select
            id="cp-ctype"
            value={ctype}
            onChange={(e) => {
              const novo = e.target.value as '' | ConstraintType
              setCtype(novo)
              if (novo === '') setCdate('')
            }}
          >
            <option value="">— sem restrição —</option>
            {tiposPermitidos.map((t) => (
              <option key={t} value={t}>
                {CONSTRAINT_LABEL[t]}
              </option>
            ))}
          </Select>
        </div>

        {ctype ? (
          <div>
            <Label htmlFor="cp-cdate">Data da restrição</Label>
            <Input
              id="cp-cdate"
              type="date"
              value={cdate}
              onChange={(e) => setCdate(e.target.value)}
              className="font-mono"
              autoFocus
            />
          </div>
        ) : null}

        <p className="text-2xs font-mono text-text-dim leading-relaxed">
          Hard (mso/mfo) força a data; soft (snet/snlt/fnet/fnlt) só modula
          dentro da folga. Violações aparecem como warning no recálculo.
        </p>

        <div className="flex items-center justify-between gap-2 pt-1 border-t border-border">
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex items-center gap-1 text-2xs font-mono text-text-dim hover:text-danger"
            title="Limpar restrição"
          >
            <X size={11} /> Limpar
          </button>
          <div className="flex items-center gap-1.5">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleSave}
              disabled={!!ctype && !cdate}
            >
              Salvar
            </Button>
          </div>
        </div>
      </div>
    </AnchoredPopover>
  )
}
