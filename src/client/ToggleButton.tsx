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

/**
 * 铃铛图标（单色线性，`currentColor` 跟随主题，不用彩色 emoji）。
 * @param enabled - 开启为普通铃铛，关闭为带斜线的静音铃铛。
 */
function BellIcon(enabled: boolean): ReactElement {
  const common = {
    width: 13,
    height: 13,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  if (enabled) {
    return (
      <svg {...common}>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path d="M18 8a6 6 0 0 0-9.3-5.1" />
      <path d="M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h13" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      <path d="m2 2 20 20" />
    </svg>
  )
}

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
        // 与设置卡片同款主题变量（跟随明暗主题）。
        border: `1px solid ${enabled ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)'}`,
        background: enabled ? 'var(--dsw-alias-bg-module-platform)' : 'transparent',
        color: enabled ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
        fontSize: 12,
        fontWeight: 500,
        cursor: busy ? 'default' : 'pointer',
        opacity: busy ? 0.6 : 1,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center' }}>{BellIcon(enabled)}</span>
      <span>{enabled ? '会通知' : '不通知'}</span>
    </button>
  )
}
