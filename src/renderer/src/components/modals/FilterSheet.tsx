import { type ReactNode } from 'react'
import { Sheet, SheetHeader, SheetTitle, SheetBody, SheetFooter } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useUIStore } from '@/stores/ui-store'

export function FilterSheet(): ReactNode {
  const open = useUIStore((s) => s.activeModals.has('filters'))
  const close = (): void => useUIStore.getState().closeModal('filters')

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetHeader>
        <SheetTitle>Filtros avançados</SheetTitle>
      </SheetHeader>
      <SheetBody className="space-y-3">
        <div>
          <Label>Lógica</Label>
          <Select defaultValue="AND">
            <option value="AND">Todos os critérios (E)</option>
            <option value="OR">Qualquer critério (OU)</option>
          </Select>
        </div>

        <FilterRow campo="Categoria" />
        <FilterRow campo="Fonte" />
        <FilterRow campo="Preço c/ BDI" tipo="number" />

        <Button variant="ghost" size="sm" className="mt-2">
          + Adicionar critério
        </Button>
      </SheetBody>
      <SheetFooter>
        <Button variant="ghost" onClick={close}>
          Limpar
        </Button>
        <Button variant="default" onClick={close}>
          Aplicar filtros
        </Button>
      </SheetFooter>
    </Sheet>
  )
}

function FilterRow({ campo, tipo = 'text' }: { campo: string; tipo?: 'text' | 'number' }): ReactNode {
  return (
    <div className="rounded border border-border bg-bg-elevated p-2 space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <Select defaultValue={campo}>
          <option>{campo}</option>
        </Select>
        <Select defaultValue="contains">
          <option value="contains">contém</option>
          <option value="eq">igual a</option>
          <option value="gt">maior que</option>
          <option value="lt">menor que</option>
        </Select>
        <Input type={tipo} placeholder="Valor…" />
      </div>
    </div>
  )
}
