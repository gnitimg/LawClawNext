/**
 * Preload: exposes a minimal, typed desktop bridge to the renderer. The dsh host
 * owns all agent behavior; this carries the host URL, the RPC/stream proxy, and
 * the plugin marketplace API (proxied through main to avoid renderer CORS).
 */
import { contextBridge, ipcRenderer } from 'electron'

const api = {
  dsh: {
    getUrl: (): Promise<string | undefined> => ipcRenderer.invoke('dsh:url'),
    onHostRestarted: (handler: (url: string) => void): (() => void) => {
      const listener = (_event: unknown, url: string): void => handler(url)
      ipcRenderer.on('dsh:host-restarted', listener)
      return () => ipcRenderer.off('dsh:host-restarted', listener)
    },
    rpc: (method: string, args: unknown): Promise<unknown> => ipcRenderer.invoke('dsh:rpc', method, args),
    stream: {
      open: (endpoint: string, args: unknown): Promise<string | undefined> => ipcRenderer.invoke('dsh:stream:open', endpoint, args),
      cancel: (streamId: string): Promise<void> => ipcRenderer.invoke('dsh:stream:cancel', streamId),
      onFrame: (handler: (frame: unknown) => void): (() => void) => {
        const listener = (_event: unknown, frame: unknown): void => handler(frame)
        ipcRenderer.on('dsh:stream:frame', listener)
        return () => ipcRenderer.off('dsh:stream:frame', listener)
      },
    },
  },
  plugins: {
    list: (): Promise<unknown> => ipcRenderer.invoke('plugins:list'),
    installed: (): Promise<unknown> => ipcRenderer.invoke('plugins:installed'),
    install: (spec: string): Promise<unknown> => ipcRenderer.invoke('plugins:install', spec),
    setEnabled: (name: string, enabled: boolean): Promise<unknown> => ipcRenderer.invoke('plugins:set-enabled', name, enabled),
    uninstall: (name: string): Promise<unknown> => ipcRenderer.invoke('plugins:uninstall', name),
  },
  skills: {
    list: (): Promise<unknown> => ipcRenderer.invoke('skills:list'),
    setEnabled: (id: string, enabled: boolean): Promise<unknown> => ipcRenderer.invoke('skills:set-enabled', id, enabled),
  },
  agents: {
    list: (): Promise<unknown> => ipcRenderer.invoke('agents:list'),
    save: (agents: unknown[]): Promise<unknown> => ipcRenderer.invoke('agents:save', agents),
  },
  mcp: {
    read: (): Promise<unknown> => ipcRenderer.invoke('mcp:read'),
    save: (servers: unknown[]): Promise<unknown> => ipcRenderer.invoke('mcp:save', servers),
    test: (server: unknown): Promise<unknown> => ipcRenderer.invoke('mcp:test', server),
  },
  ocr: {
    read: (): Promise<unknown> => ipcRenderer.invoke('ocr:read'),
    save: (settings: unknown): Promise<unknown> => ipcRenderer.invoke('ocr:save', settings),
    capabilities: (): Promise<unknown> => ipcRenderer.invoke('ocr:capabilities'),
    installGpuAcceleration: (): Promise<unknown> => ipcRenderer.invoke('ocr:install-gpu'),
    provision: (): Promise<unknown> => ipcRenderer.invoke('ocr:provision'),
    chooseBenchmarkFile: (): Promise<string | undefined> => ipcRenderer.invoke('ocr:choose-benchmark-file'),
    benchmark: (filePath: string): Promise<unknown> => ipcRenderer.invoke('ocr:benchmark', filePath),
    chooseCloudFile: (): Promise<string | undefined> => ipcRenderer.invoke('ocr:choose-cloud-file'),
    testCloud: (filePath: string, explicitlyAuthorized: boolean): Promise<unknown> => ipcRenderer.invoke('ocr:cloud-test', filePath, explicitlyAuthorized),
  },
  settings: {
    read: (): Promise<Record<string, string>> => ipcRenderer.invoke('settings:read'),
    write: (env: Record<string, string>): Promise<string> => ipcRenderer.invoke('settings:write', env),
    appearance: (value: 'light' | 'dark' | 'system'): Promise<void> => ipcRenderer.invoke('settings:appearance', value),
  },
  project: {
    chooseDirectory: (): Promise<string | undefined> => ipcRenderer.invoke('project:choose-directory'),
    environment: (path: string): Promise<unknown> => ipcRenderer.invoke('project:environment', path),
    openTerminal: (path: string): Promise<void> => ipcRenderer.invoke('project:open-terminal', path),
  },
  attachments: {
    chooseImages: (): Promise<Array<{ name: string, mediaType: string, data: string }>> => ipcRenderer.invoke('attachments:choose-images'),
  },
  models: {
    fetch: (baseUrl: string, apiKey: string): Promise<string[]> => ipcRenderer.invoke('models:fetch', baseUrl, apiKey),
    providers: {
      read: (): Promise<unknown> => ipcRenderer.invoke('models:providers:read'),
      save: (providers: unknown[]): Promise<unknown> => ipcRenderer.invoke('models:providers:save', providers),
      test: (provider: unknown): Promise<unknown> => ipcRenderer.invoke('models:providers:test', provider),
      testModel: (provider: unknown, modelId: string): Promise<unknown> => ipcRenderer.invoke('models:providers:test-model', provider, modelId),
    },
  },
  runtime: {
    configStatus: (): Promise<unknown> => ipcRenderer.invoke('runtime:config-status'),
    restart: (): Promise<unknown> => ipcRenderer.invoke('runtime:restart'),
    onConfigStatus: (handler: (status: unknown) => void): (() => void) => {
      const listener = (_event: unknown, status: unknown): void => handler(status)
      ipcRenderer.on('runtime:config-status', listener)
      return () => ipcRenderer.off('runtime:config-status', listener)
    },
  },
}

contextBridge.exposeInMainWorld('desktop', api)

export type DesktopApi = typeof api
