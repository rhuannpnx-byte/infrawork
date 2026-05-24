import { type ReactNode } from 'react'
import { CommandPalette } from './CommandPalette'
import { ProjectSwitcher } from './ProjectSwitcher'
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog'
import { ExportDialog } from './ExportDialog'
import { ShareDialog } from './ShareDialog'
import { SettingsDialog } from './SettingsDialog'
import { FilterSheet } from './FilterSheet'
import { KeyboardShortcutsOverlay } from './KeyboardShortcutsOverlay'
import {
  NewTaskDialog,
  NewRDODialog,
  NewBMDialog,
  NewOrderDialog,
  NewEmployeeDialog
} from './SimpleFormDialogs'

export function Modals(): ReactNode {
  return (
    <>
      <CommandPalette />
      <ProjectSwitcher />
      <NewTaskDialog />
      <NewRDODialog />
      <NewBMDialog />
      <NewOrderDialog />
      <NewEmployeeDialog />
      <ConfirmDeleteDialog />
      <ExportDialog />
      <ShareDialog />
      <SettingsDialog />
      <FilterSheet />
      <KeyboardShortcutsOverlay />
    </>
  )
}
