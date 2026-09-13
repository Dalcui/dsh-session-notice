/**
 * dsh-session-notice —— 会话头部「会通知」切换按钮
 * （conversation.session.header.utilities，session 级 standardProps 自带 sessionId）。
 *
 * 状态持久化在 Host settings.enabledSessions（服务重启后保持）；
 * 点击随时切换，图标即时反映当前会话的启用状态。
 *
 * 仅保留铃铛图标（去掉常驻文字），提示信息改为：鼠标悬浮显示操作说明、
 * 点击切换后短暂显示结果反馈（自绘 tooltip，不用原生 title —— 原生 title
 * 有延迟、无法在点击时展示、也无法跟随主题）。
 */

import { useEffect, useRef, useState } from 'react'
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

/** tooltip 样式（自绘，跟随主题变量；绝对定位在按钮下方、右对齐）。 */
const TOOLTIP_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  right: 0,
  zIndex: 100,
  maxWidth: 260,
  padding: '6px 10px',
  borderRadius: 6,
  background: 'var(--dsw-alias-bg-module-platform)',
  color: 'var(--dsw-alias-label-primary)',
  border: '1px solid var(--dsw-alias-border-l2)',
  boxShadow: '0 2px 10px rgba(0, 0, 0, 0.16)',
  fontSize: 12,
  fontWeight: 500,
  lineHeight: 1.5,
  whiteSpace: 'normal',
  wordBreak: 'break-word',
  pointerEvents: 'none',
}

/** 点击反馈提示的停留时长（ms）。 */
const TOAST_MS = 2200

export function ToggleButton({ rpc, sessionId }: { rpc: RpcCall; sessionId: string }): ReactElement | null {
  const [enabled, setEnabled] = useState(false)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // 卸载时清理未触发的 toast 定时器。
  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) clearTimeout(toastTimer.current)
    }
  }, [])

  const showToast = (text: string): void => {
    setToast(text)
    if (toastTimer.current !== null) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
  }

  const toggle = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const res = await rpc('toggle', { sessionId })
      if (res.ok) {
        const next = Boolean(res.value?.enabled)
        setEnabled(next)
        showToast(next ? '已开启：本会话回合停止时 Bark 通知手机' : '已关闭本会话通知')
      }
    } finally {
      setBusy(false)
    }
  }

  if (!ready) return null

  const hoverHint = enabled ? '回合停止时会 Bark 通知手机；点击取消' : '点击开启：本会话回合停止时 Bark 通知手机'
  // 点击反馈优先于悬浮说明；两者都为空时不渲染 tooltip。
  const tip = toast ?? (hovered ? hoverHint : null)

  return (
    <button
      type="button"
      aria-label={hoverHint}
      aria-pressed={enabled}
      onClick={() => void toggle()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      disabled={busy}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        padding: 0,
        borderRadius: 8,
        // 与设置卡片同款主题变量（跟随明暗主题）。
        border: `1px solid ${enabled ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)'}`,
        background: enabled ? 'var(--dsw-alias-bg-module-platform)' : 'transparent',
        color: enabled ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
        cursor: busy ? 'default' : 'pointer',
        opacity: busy ? 0.6 : 1,
      }}
    >
      {BellIcon(enabled)}
      {tip !== null ? <span style={TOOLTIP_STYLE}>{tip}</span> : null}
    </button>
  )
}
