import { create } from 'zustand'
import type { ModelSelection, PendingApproval, SessionJob, SessionProjectionBaseline, View } from './types'

const PINNED_SESSIONS_KEY = 'deepseek-desktop.pinned-sessions.v1'
const ARCHIVED_SESSIONS_KEY = 'deepseek-desktop.archived-sessions.v1'
const APPEARANCE_KEY = 'deepseek-desktop.appearance.v1'
const DEVELOPER_MODE_KEY = 'deepseek-desktop.developer-mode.v1'
export const PROJECT_PREFERENCES_KEY = 'deepseek-desktop.project-preferences.v1'

export type Appearance = 'light' | 'dark' | 'system'

function readDeveloperMode(): boolean {
  return localStorage.getItem(DEVELOPER_MODE_KEY) === 'true'
}

export type ToastKind = 'error' | 'success' | 'info'

export interface AppToast {
  id: number
  kind: ToastKind
  text: string
}

const TOAST_DURATION_MS: Record<ToastKind, number> = { error: 8000, success: 3200, info: 5200 }

let toastSequence = 0
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>()

function readAppearance(): Appearance {
  const value = localStorage.getItem(APPEARANCE_KEY)
  return value === 'dark' || value === 'system' ? value : 'light'
}

function readStoredIds(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function writeStoredIds(key: string, ids: readonly string[]): void {
  localStorage.setItem(key, JSON.stringify(ids))
}

function readHiddenProjectPaths(): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(PROJECT_PREFERENCES_KEY) ?? '{}') as { hidden?: unknown }
    return new Set(Array.isArray(value.hidden) ? value.hidden.filter((item): item is string => typeof item === 'string') : [])
  } catch {
    return new Set()
  }
}

export interface DesktopSession {
  id: string
  title: string
  updatedAt: number
  running: boolean
  blank: boolean
  cwd?: string
  parentId?: string
  subagentMode?: 'one-shot' | 'continuable'
  selectedModel?: ModelSelection
}

interface AppState {
  view: View
  setView: (view: View) => void
  sessions: DesktopSession[]
  subagents: DesktopSession[]
  activeSessionId: string | undefined
  replaceSessions: (sessions: DesktopSession[]) => void
  replaceSubagents: (sessions: DesktopSession[]) => void
  addSession: (session: DesktopSession) => void
  patchSession: (id: string, patch: Partial<DesktopSession>) => void
  removeSession: (id: string) => void
  clearProjectSelection: (path: string) => void
  pinnedSessionIds: string[]
  toggleSessionPin: (id: string) => void
  archivedSessionIds: string[]
  archiveSessionLocally: (id: string) => void
  selectSession: (id: string) => void
  workspaceRoot: string | undefined
  setWorkspaceRoot: (path: string | undefined) => void
  dshUrl: string | undefined
  connectionError: string | undefined
  setConnection: (url: string | undefined, error?: string) => void
  connectionRevision: number
  reconnectDsh: (url: string) => void
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  inspectorOpen: boolean
  toggleInspector: () => void
  agentPreset: string
  setAgentPreset: (preset: string) => void
  appearance: Appearance
  setAppearance: (appearance: Appearance) => void
  developerMode: boolean
  setDeveloperMode: (developerMode: boolean) => void
  projectionBaselines: Record<string, SessionProjectionBaseline>
  controlJobs: Record<string, readonly SessionJob[]>
  controlError: string | undefined
  pendingApprovals: PendingApproval[]
  setControlBaseline: (
    projections: Readonly<Record<string, SessionProjectionBaseline>>,
    jobs: Readonly<Record<string, readonly SessionJob[]>>,
  ) => void
  updateProjection: (sessionId: string, key: string, value: unknown, seq: number) => void
  setControlJobs: (sessionId: string, jobs: readonly SessionJob[]) => void
  setControlError: (error: string | undefined) => void
  upsertPendingApproval: (approval: PendingApproval) => void
  removePendingApproval: (eventId: string) => void
  clearPendingApprovals: () => void
  toasts: AppToast[]
  pushToast: (kind: ToastKind, text: string) => void
  dismissToast: (id: number) => void
}

export const useApp = create<AppState>((set) => ({
  view: 'chat',
  setView: (view) => set({ view }),
  sessions: [],
  subagents: [],
  activeSessionId: undefined,
  replaceSessions: (incoming) => set((state) => {
    const sessions = incoming.filter((session) => !state.archivedSessionIds.includes(session.id))
    const hiddenProjects = readHiddenProjectPaths()
    const selectable = sessions.filter((session) => session.cwd === undefined || !hiddenProjects.has(session.cwd))
    const activeStillExists = selectable.some((session) => session.id === state.activeSessionId)
    const activeSessionId = activeStillExists ? state.activeSessionId : selectable[0]?.id
    const active = sessions.find((session) => session.id === activeSessionId)
    return {
      sessions,
      activeSessionId,
      workspaceRoot: active?.cwd,
    }
  }),
  replaceSubagents: (subagents) => set({ subagents }),
  addSession: (session) => set((state) => ({
    sessions: [session, ...state.sessions.filter((item) => item.id !== session.id)],
    activeSessionId: session.id,
    workspaceRoot: session.cwd,
    view: 'chat',
  })),
  patchSession: (id, patch) => set((state) => ({
    sessions: state.sessions.map((session) => session.id === id ? { ...session, ...patch } : session),
  })),
  removeSession: (id) => set((state) => {
    const sessions = state.sessions.filter((session) => session.id !== id)
    const activeSessionId = state.activeSessionId === id ? sessions[0]?.id : state.activeSessionId
    const active = sessions.find((session) => session.id === activeSessionId)
    return {
      sessions,
      activeSessionId,
      workspaceRoot: active?.cwd,
    }
  }),
  clearProjectSelection: (path) => set((state) => {
    const active = state.sessions.find((session) => session.id === state.activeSessionId)
    return active?.cwd === path ? { activeSessionId: undefined, workspaceRoot: undefined } : {}
  }),
  pinnedSessionIds: readStoredIds(PINNED_SESSIONS_KEY),
  toggleSessionPin: (id) => set((state) => {
    const pinnedSessionIds = state.pinnedSessionIds.includes(id)
      ? state.pinnedSessionIds.filter((item) => item !== id)
      : [...state.pinnedSessionIds, id]
    writeStoredIds(PINNED_SESSIONS_KEY, pinnedSessionIds)
    return { pinnedSessionIds }
  }),
  archivedSessionIds: readStoredIds(ARCHIVED_SESSIONS_KEY),
  archiveSessionLocally: (id) => set((state) => {
    const archivedSessionIds = [...new Set([...state.archivedSessionIds, id])]
    writeStoredIds(ARCHIVED_SESSIONS_KEY, archivedSessionIds)
    const sessions = state.sessions.filter((session) => session.id !== id)
    const activeSessionId = state.activeSessionId === id ? sessions[0]?.id : state.activeSessionId
    const active = sessions.find((session) => session.id === activeSessionId)
    return { archivedSessionIds, sessions, activeSessionId, workspaceRoot: active?.cwd }
  }),
  selectSession: (id) => set((state) => {
    const session = state.sessions.find((item) => item.id === id)
    return { activeSessionId: id, workspaceRoot: session?.cwd, view: 'chat' }
  }),
  workspaceRoot: undefined,
  setWorkspaceRoot: (workspaceRoot) => set({ workspaceRoot }),
  dshUrl: undefined,
  connectionError: undefined,
  setConnection: (dshUrl, connectionError) => set({ dshUrl, connectionError }),
  connectionRevision: 0,
  reconnectDsh: (dshUrl) => set((state) => ({ dshUrl, connectionError: undefined, connectionRevision: state.connectionRevision + 1 })),
  sidebarCollapsed: false,
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  inspectorOpen: false,
  toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
  agentPreset: 'standard',
  setAgentPreset: (agentPreset) => set({ agentPreset }),
  appearance: readAppearance(),
  setAppearance: (appearance) => {
    localStorage.setItem(APPEARANCE_KEY, appearance)
    set({ appearance })
  },
  developerMode: readDeveloperMode(),
  setDeveloperMode: (developerMode) => {
    localStorage.setItem(DEVELOPER_MODE_KEY, String(developerMode))
    set({ developerMode })
  },
  projectionBaselines: {},
  controlJobs: {},
  controlError: undefined,
  pendingApprovals: [],
  setControlBaseline: (projectionBaselines, controlJobs) => set({
    projectionBaselines: { ...projectionBaselines },
    controlJobs: { ...controlJobs },
    controlError: undefined,
  }),
  updateProjection: (sessionId, key, value, seq) => set((state) => {
    const current = state.projectionBaselines[sessionId]
    if (current !== undefined && current.asOfSeq > seq) return state
    return {
      projectionBaselines: {
        ...state.projectionBaselines,
        [sessionId]: {
          asOfSeq: Math.max(current?.asOfSeq ?? -1, seq),
          values: { ...current?.values, [key]: value },
        },
      },
    }
  }),
  setControlJobs: (sessionId, jobs) => set((state) => ({
    controlJobs: { ...state.controlJobs, [sessionId]: jobs },
  })),
  setControlError: (controlError) => set({ controlError }),
  upsertPendingApproval: (approval) => set((state) => ({
    pendingApprovals: [
      ...state.pendingApprovals.filter((item) => item.eventId !== approval.eventId),
      approval,
    ],
  })),
  removePendingApproval: (eventId) => set((state) => ({
    pendingApprovals: state.pendingApprovals.filter((item) => item.eventId !== eventId),
  })),
  clearPendingApprovals: () => set({ pendingApprovals: [] }),
  toasts: [],
  pushToast: (kind, text) => {
    const id = ++toastSequence
    set((state) => ({
      toasts: [...state.toasts.filter((item) => !(item.kind === kind && item.text === text)), { id, kind, text }],
    }))
    toastTimers.set(id, setTimeout(() => useApp.getState().dismissToast(id), TOAST_DURATION_MS[kind]))
  },
  dismissToast: (id) => {
    const timer = toastTimers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      toastTimers.delete(id)
    }
    set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) }))
  },
}))
