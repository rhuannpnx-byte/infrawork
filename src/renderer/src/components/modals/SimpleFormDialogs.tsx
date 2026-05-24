import { type ReactNode } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { useUIStore } from '@/stores/ui-store'
import type { ModalKey } from '@/stores/ui-store'

interface SimpleFormProps {
  modalKey: ModalKey
  title: string
  fields: Array<{ id: string; label: string; placeholder?: string; type?: string }>
  successMessage: string
}

function SimpleForm({ modalKey, title, fields, successMessage }: SimpleFormProps): ReactNode {
  const open = useUIStore((s) => s.activeModals.has(modalKey))
  const close = (): void => useUIStore.getState().closeModal(modalKey)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} size="md">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          toast.success(successMessage)
          close()
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {fields.map((f) => (
            <div key={f.id}>
              <Label htmlFor={f.id}>{f.label}</Label>
              <Input id={f.id} type={f.type ?? 'text'} placeholder={f.placeholder} required />
            </div>
          ))}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button type="submit" variant="default">
            Salvar
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

export function NewTaskDialog(): ReactNode {
  return (
    <SimpleForm
      modalKey="newTask"
      title="Nova tarefa do cronograma"
      fields={[
        { id: 'codigo', label: 'Código EAP', placeholder: 'Ex.: 1.4.5' },
        { id: 'nome', label: 'Nome da tarefa', placeholder: 'Ex.: Pavimentação trecho km 442-450' },
        { id: 'inicio', label: 'Início', type: 'date' },
        { id: 'fim', label: 'Fim previsto', type: 'date' },
        { id: 'responsavel', label: 'Responsável', placeholder: 'Eng. responsável' }
      ]}
      successMessage="Tarefa criada."
    />
  )
}

export function NewRDODialog(): ReactNode {
  return (
    <SimpleForm
      modalKey="newRDO"
      title="Novo boletim diário (RDO)"
      fields={[
        { id: 'data', label: 'Data', type: 'date' },
        { id: 'responsavel', label: 'Responsável técnico' },
        { id: 'efetivo', label: 'Efetivo total', type: 'number' },
        { id: 'temperatura', label: 'Temperatura (°C)', type: 'number' }
      ]}
      successMessage="RDO criado e disponível para preenchimento."
    />
  )
}

export function NewBMDialog(): ReactNode {
  return (
    <SimpleForm
      modalKey="newBM"
      title="Novo boletim de medição"
      fields={[
        { id: 'periodoInicio', label: 'Período — início', type: 'date' },
        { id: 'periodoFim', label: 'Período — fim', type: 'date' },
        { id: 'observacoes', label: 'Observações' }
      ]}
      successMessage="Boletim de medição criado em rascunho."
    />
  )
}

export function NewOrderDialog(): ReactNode {
  return (
    <SimpleForm
      modalKey="newOrder"
      title="Novo pedido de compra"
      fields={[
        { id: 'fornecedor', label: 'Fornecedor' },
        { id: 'numero', label: 'Número do PO' },
        { id: 'entrega', label: 'Data de entrega prevista', type: 'date' }
      ]}
      successMessage="Pedido de compra criado."
    />
  )
}

export function NewEmployeeDialog(): ReactNode {
  return (
    <SimpleForm
      modalKey="newEmployee"
      title="Novo colaborador"
      fields={[
        { id: 'nome', label: 'Nome completo' },
        { id: 'cpf', label: 'CPF' },
        { id: 'cargo', label: 'Cargo' },
        { id: 'admissao', label: 'Data de admissão', type: 'date' }
      ]}
      successMessage="Colaborador cadastrado."
    />
  )
}
