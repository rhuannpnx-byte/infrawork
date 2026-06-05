import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const infrawork = {
  platform: process.platform,
  window: {
    openNew: (route: string) => ipcRenderer.invoke('window:open', route),
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChange: (cb: (v: boolean) => void) => {
      const l = (_e: unknown, v: boolean): void => cb(v)
      ipcRenderer.on('window:maximized', l)
      return () => ipcRenderer.removeListener('window:maximized', l)
    }
  },
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value)
  },
  orcamento: {
    escolherArquivo: () => ipcRenderer.invoke('orcamento:escolher-arquivo'),
    parseExcel: (params: { path: string; mapping: unknown }) =>
      ipcRenderer.invoke('orcamento:parse-excel', params),
    parseCpuExcel: (params: { path: string }) =>
      ipcRenderer.invoke('orcamento:parse-cpu-excel', params),
    lerArquivoBytes: (path: string) => ipcRenderer.invoke('orcamento:upload-arquivo-bytes', path)
  },
  medicao: {
    exportXlsx: (payload: unknown) => ipcRenderer.invoke('medicao:export-xlsx', payload)
  },
  updater: {
    check: () => ipcRenderer.invoke('update:check'),
    quitAndInstall: () => ipcRenderer.send('update:quit-and-install'),
    onAvailable: (cb: (info: { version: string }) => void) => {
      const listener = (_e: unknown, info: { version: string }): void => cb(info)
      ipcRenderer.on('update:available', listener)
      return () => ipcRenderer.removeListener('update:available', listener)
    },
    onDownloaded: (cb: (info: { version: string }) => void) => {
      const listener = (_e: unknown, info: { version: string }): void => cb(info)
      ipcRenderer.on('update:downloaded', listener)
      return () => ipcRenderer.removeListener('update:downloaded', listener)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('infrawork', infrawork)
  } catch (error) {
    console.error(error)
  }
} else {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).electron = electronAPI
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).infrawork = infrawork
}
