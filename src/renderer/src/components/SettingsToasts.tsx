import { useApp } from '../store'
import { Icon } from './Icon'

export function SettingsToasts(): React.ReactElement | null {
  const toasts = useApp((state) => state.toasts)
  const dismissToast = useApp((state) => state.dismissToast)
  if (toasts.length === 0) return null
  return (
    <div aria-label="通知" className="settings-toast-host">
      {toasts.map((toast) => (
        <div className={`settings-toast is-${toast.kind}`} key={toast.id} role={toast.kind === 'error' ? 'alert' : 'status'}>
          <span><Icon name={toast.kind === 'error' ? 'activity' : toast.kind === 'info' ? 'terminal' : 'check'} size={15} /></span>
          <p>{toast.text}</p>
          <button aria-label="关闭通知" onClick={() => dismissToast(toast.id)} type="button"><Icon name="close" size={13} /></button>
        </div>
      ))}
    </div>
  )
}
