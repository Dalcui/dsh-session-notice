/**
 * dsh-session-notice —— 会话头部「会通知」切换按钮
 * （conversation.session.header.utilities，session 级 standardProps 自带 sessionId）。
 *
 * 状态持久化在 Host settings.enabledSessions（服务重启后保持）；
 * 点击随时切换，按钮文案与图标即时反映当前会话的启用状态。
 */

import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import type { RpcCall } from './BarkPluginCard'

export function ToggleButton({ rpc, sessionId }: { rpc: RpcCall; sessionId: string }): ReactElement | null {
  const [enabled, setEnabled] = useState(false)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    setReady(false)
    void (async () => {
      const res = await rpc('state', {})
      if (!alive || !res.ok) return
      const sessions = (res.value?.enabledSessions ?? []) as string[]
      setEnabled(sessions.includes(sessionId))
      setReady(true)
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const toggle = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const res = await rpc('toggle', { sessionId })
      if (res.ok) setEnabled(Boolean(res.value?.enabled))
    } finally {
      setBusy(false)
    }
  }

  if (!ready) return null

  return (
    <button
      type="button"
      title={enabled ? '回合停止时会 Bark 通知手机；点击取消' : '点击开启：本会话回合停止时 Bark 通知手机'}
      onClick={() => void toggle()}
      disabled={busy}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 28,
        padding: '0 10px',
        borderRadius: 8,
        border: enabled
          ? '1px solid var(--dsw-alias-brand-primary, #4d6bfe)'
          : '1px solid var(--dsw-alias-border-l4, #ccc)',
        background: enabled
          ? 'var(--dsw-alias-brand-primary-soft, rgba(77,107,254,0.12))'
          : 'var(--dsw-alias-bg-layer-3, transparent)',
        color: enabled
          ? 'var(--dsw-alias-brand-primary, #4d6bfe)'
          : 'var(--dsw-alias-label-secondary, #666)',
        fontSize: 12,
        fontWeight: 500,
        cursor: busy ? 'default' : 'pointer',
        opacity: busy ? 0.6 : 1,
      }}
    >
      <span>{enabled ? '🔔' : '🔕'}</span>
      <span>{enabled ? '会通知' : '不通知'}</span>
    </button>
  )
}
