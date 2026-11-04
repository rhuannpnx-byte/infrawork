import { type ReactNode } from 'react'
import { CommandPalette } from './CommandPalette'
import { ProjectSwitcher } from './ProjectSwitcher'
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog'
import { ConfirmDialog } from './ConfirmDialog'
import { ExportDialog } from './ExportDialog'
import { SettingsDialog } from './SettingsDialog'
import { KeyboardShortcutsOverlay } from './KeyboardShortcutsOverlay'

export function Modals(): ReactNode {
  return (
    <>
      <CommandPalette />
      <ProjectSwitcher />
      <ConfirmDeleteDialog />
      <ConfirmDialog />
      <ExportDialog />
      <SettingsDialog />
      <KeyboardShortcutsOverlay />
    </>
  )
}
