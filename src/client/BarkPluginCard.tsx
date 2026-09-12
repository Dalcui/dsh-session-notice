/**
 * dsh-session-notice —— 设置-插件配置卡片（settings.plugin.item, key='bark-notify'）。
 *
 * 样式与 DSH 内置及其它插件卡片保持一致：`li` 卡片 + `--dsw-alias-*` 主题变量
 * （border-l2 / bg-layer-3 / brand-primary / label-* ），header 折叠 + body 字段
 * + footer 保存，圆角 12px、input 34px、字号 13/15（与 dsh-auto-collapse 同款）。
 *
 * 语义（t3/t4 定稿）：
 * - 配置模型 = server + key 两字段（可粘贴 App 测试 URL，Host 侧入库前归一）；
 * - key 是 secret：浏览器只回显「••••••••末4位」，草稿框留空=不修改；
 * - 保存绝不真发；只有「测试推送」按钮允许真发 /push（ping → push → 失败才 register，
 *   三步独立状态，「配置已就绪」只能由 push 成功点亮）。
 */

import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

/** Host RPC 调用形状（与 Host rpc.ts 契约对应）。 */
export type RpcCall = (
  endpoint: string,
  payload: unknown,
) => Promise<{ ok: boolean; value?: any; error?: { message: string } }>

/** `/state` 端点返回的脱敏视图。 */
interface SettingsView {
  server: string
  serverMasked: boolean
  keyConfigured: boolean
  keyMasked: string
  group: string
  enabledSessions: string[]
  maxBodyChars: number
}

/** `/test` 端点返回的三步结果。 */
interface TestView {
  steps: Array<{ step: string; ok: boolean; kind: string; message: string }>
  ready: boolean
  causalHint?: string
}

/** 卡片样式（与 DSH 插件卡片同款：主题变量 + 12px 圆角 + 34px 输入框）。 */
const CARD_CSS = `
.dsn-card {
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-3);
  border-radius: 12px;
  list-style: none;
  transition: border-color .16s, background .16s;
}
.dsn-card:hover { border-color: var(--dsw-alias-label-dimmed); }
.dsn-cardOpen { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-label-dimmed); }
.dsn-header {
  appearance: none; width: 100%; font: inherit; color: inherit; text-align: left;
  cursor: pointer; background: 0 0; border: 0; border-radius: 12px;
  align-items: center; gap: 12px; padding: 14px 16px; display: flex;
}
.dsn-header:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.dsn-headText { flex-direction: column; flex: 1; gap: 4px; min-width: 0; display: flex; }
.dsn-name { color: var(--dsw-alias-label-primary); font-size: 15px; font-weight: 600; line-height: 1.4; }
.dsn-description { color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 1.5; }
.dsn-chevron { color: var(--dsw-alias-label-tertiary); flex: none; transition: transform .16s; }
.dsn-chevronOpen { transform: rotate(180deg); }
.dsn-pending {
  white-space: nowrap; background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary); border-radius: 999px; flex: none;
  padding: 1px 8px; font-size: 11px; font-weight: 500; line-height: 17px;
}
.dsn-body { border-top: 1px solid var(--dsw-alias-border-l2); margin: 0 16px; padding-bottom: 8px; }
.dsn-field { flex-direction: column; gap: 6px; padding: 12px 0; display: flex; }
.dsn-fieldHead { align-items: center; gap: 8px; display: flex; }
.dsn-fieldLabel { min-width: 0; color: var(--dsw-alias-label-primary); flex: 1; font-size: 13px; font-weight: 500; line-height: 1.5; }
.dsn-badges { align-items: center; gap: 8px; display: inline-flex; }
.dsn-badge {
  white-space: nowrap; background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary); border-radius: 999px;
  padding: 1px 8px; font-size: 11px; font-weight: 500; line-height: 17px;
}
.dsn-input {
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-3);
  height: 34px; font: inherit; color: var(--dsw-alias-label-primary);
  border-radius: 8px; padding: 0 12px; font-size: 13px; line-height: 1.5;
  box-sizing: border-box; width: 100%;
}
.dsn-input:focus-visible { border-color: var(--dsw-alias-brand-primary); outline: none; }
.dsn-input:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
.dsn-hint { color: var(--dsw-alias-label-tertiary); margin: 0; font-size: 12px; line-height: 1.5; }
.dsn-footer { border-top: 1px solid var(--dsw-alias-border-l2); justify-content: flex-end; align-items: center; gap: 8px; padding: 12px 0 4px; display: flex; }
.dsn-msg { min-width: 0; flex: 1; margin: 0; font-size: 12px; line-height: 1.5; }
.dsn-msgOk { color: var(--dsw-alias-label-secondary); }
.dsn-msgFailed { color: var(--dsw-alias-label-error); }
.dsn-btn { appearance: none; font: inherit; cursor: pointer; border: 1px solid #0000; border-radius: 8px; padding: 5px 14px; font-size: 13px; line-height: 1.5; }
.dsn-btnSecondary { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); background: 0 0; }
.dsn-btnSecondary:hover:not(:disabled) { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-dimmed); }
.dsn-btnPrimary { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3); }
.dsn-btn:disabled { opacity: .4; cursor: default; }
.dsn-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsn-testResult { flex-direction: column; gap: 4px; margin: 0 0 8px; font-size: 12px; line-height: 1.5; display: flex; }
.dsn-testOk { color: var(--dsw-alias-label-secondary); }
.dsn-testFailed { color: var(--dsw-alias-label-error); }
.dsn-ready { color: var(--dsw-alias-label-primary); font-weight: 600; }
`

const STYLE_ID = 'dsh-session-notice-settings-style'

/** 注入一次卡片样式（幂等）。 */
function injectCardStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CARD_CSS
  document.head.appendChild(style)
}

/** 折叠箭头图标（与内置卡片同款 14×14 chevron）。 */
function ChevronIcon(open: boolean): ReactElement {
  const className = open ? 'dsn-chevron dsn-chevronOpen' : 'dsn-chevron'
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden className={className}>
      <path
        d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function BarkPluginCard({ rpc }: { rpc: RpcCall }): ReactElement {
  const [view, setView] = useState<SettingsView | null>(null)
  const [loadError, setLoadError] = useState('')
  const [server, setServer] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
  const [group, setGroup] = useState('')
  const [bodyChars, setBodyChars] = useState('200')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [testView, setTestView] = useState<(TestView & { error?: string }) | null>(null)
  const [open, setOpen] = useState(false)

  injectCardStyle()

  const load = async (): Promise<void> => {
    const res = await rpc('state', {})
    if (!res.ok) {
      setLoadError(res.error?.message ?? 'RPC failed')
      return
    }
    const value = res.value as SettingsView
    setView(value)
    setServer(value.server)
    setGroup(value.group)
    setBodyChars(String(value.maxBodyChars ?? 200))
    setKeyDraft('')
    setLoadError('')
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveDraft = async (): Promise<boolean> => {
    const patch: Record<string, string | number> = {}
    // 空 server 也提交：Host 侧会归一为默认官方地址（清空 = 恢复默认）。
    if (server.trim() !== (view?.server ?? '')) patch.server = server
    if (keyDraft.length > 0) patch.key = keyDraft
    if (group !== (view?.group ?? '')) patch.group = group
    const charsNumber = Number(bodyChars.trim())
    if (Number.isFinite(charsNumber) && Math.floor(charsNumber) !== (view?.maxBodyChars ?? 200)) {
      ;(patch as Record<string, string | number>).maxBodyChars = Math.floor(charsNumber)
    }
    if (Object.keys(patch).length === 0) return true
    const res = await rpc('set', patch)
    if (!res.ok) {
      setSaveMsg({ ok: false, text: res.error?.message ?? '保存失败' })
      return false
    }
    setKeyDraft('')
    await load()
    return true
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    setSaveMsg(null)
    const landed = await saveDraft()
    if (landed) setSaveMsg({ ok: true, text: '已保存' })
    setSaving(false)
  }

  const test = async (): Promise<void> => {
    setTesting(true)
    setTestView(null)
    setSaveMsg(null)
    const landed = await saveDraft()
    if (!landed) {
      setTesting(false)
      return
    }
    const res = await rpc('test', {})
    setTesting(false)
    if (!res.ok) {
      setTestView({ steps: [], ready: false, error: res.error?.message ?? '测试失败' })
      return
    }
    setTestView(res.value as TestView)
  }

  const dirty =
    server.trim() !== (view?.server ?? '') ||
    keyDraft.length > 0 ||
    group !== (view?.group ?? '') ||
    (Number.isFinite(Number(bodyChars.trim())) && Math.floor(Number(bodyChars.trim())) !== (view?.maxBodyChars ?? 200))
  const cardClass = `dsn-card${open ? ' dsn-cardOpen' : ''}`

  return (
    <li className={cardClass}>
      <button
        type="button"
        className="dsn-header"
        aria-expanded={open}
        aria-label={`${open ? '收起设置' : '展开设置'}: dsh-session-notice`}
        onClick={() => setOpen(!open)}
      >
        <span className="dsn-headText">
          <span className="dsn-name">Bark 会话通知</span>
          <span className="dsn-description">
            会话轮次停止时经 Bark 推送到手机；在会话头部按钮按会话开关
          </span>
        </span>
        {dirty ? <span className="dsn-pending">未保存</span> : null}
        {ChevronIcon(open)}
      </button>

      {open ? (
        <div className="dsn-body">
          {loadError.length > 0 ? (
            <p className="dsn-msg dsn-msgFailed" role="status">
              设置加载失败：{loadError}
            </p>
          ) : null}

          <div className="dsn-field">
            <div className="dsn-fieldHead">
              <label className="dsn-fieldLabel" htmlFor="dsn-server">
                Bark 服务器
              </label>
              {view?.serverMasked === true ? <span className="dsn-badges"><span className="dsn-badge">含凭据</span></span> : null}
            </div>
            <input
              id="dsn-server"
              className="dsn-input"
              type="text"
              value={server}
              placeholder="https://api.day.app"
              disabled={saving || testing}
              onChange={(event) => setServer(event.target.value)}
            />
            <p className="dsn-hint">
              官方 http://api.day.app 或自建服务器；可带路径前缀，Basic Auth 用 user:pass@host 形式
            </p>
          </div>

          <div className="dsn-field">
            <div className="dsn-fieldHead">
              <label className="dsn-fieldLabel" htmlFor="dsn-key">
                设备密钥（key）
              </label>
              <span className="dsn-badges">
                <span className="dsn-badge">
                  {view?.keyConfigured === true ? `已配置 ${view.keyMasked}` : '未配置'}
                </span>
              </span>
            </div>
            <input
              id="dsn-key"
              className="dsn-input"
              type="password"
              value={keyDraft}
              autoComplete="off"
              placeholder={view?.keyConfigured === true ? '留空 = 不修改；输入新值替换' : '粘贴 Bark key'}
              disabled={saving || testing}
              onChange={(event) => setKeyDraft(event.target.value)}
            />
            <p className="dsn-hint">密钥只存 Host 侧，界面仅显示末 4 位，不落浏览器、不进日志</p>
          </div>

          <div className="dsn-field">
            <div className="dsn-fieldHead">
              <label className="dsn-fieldLabel" htmlFor="dsn-group">
                分组（group）
              </label>
            </div>
            <input
              id="dsn-group"
              className="dsn-input"
              type="text"
              value={group}
              placeholder="默认按工作区分组"
              disabled={saving || testing}
              onChange={(event) => setGroup(event.target.value)}
            />
            <p className="dsn-hint">同一分组在手机通知里按项目聚合、支持按分组静音；清空 = 按工作区自动</p>
          </div>

          <div className="dsn-field">
            <div className="dsn-fieldHead">
              <label className="dsn-fieldLabel" htmlFor="dsn-body-chars">
                正文摘要字数
              </label>
              <span className="dsn-badges">
                <span className="dsn-badge">默认 200</span>
              </span>
            </div>
            <input
              id="dsn-body-chars"
              className="dsn-input"
              type="number"
              min={40}
              max={1000}
              value={bodyChars}
              placeholder="200"
              disabled={saving || testing}
              onChange={(event) => setBodyChars(event.target.value)}
            />
            <p className="dsn-hint">
              通知只显示约 4 行，超出按「首段 + 末段」摘要并标注总字数；范围 40–1000
            </p>
          </div>

          {testView !== null && testView.error === undefined ? (
            <div className="dsn-testResult" role="status">
              {testView.steps.map((step) => (
                <span key={step.step} className={step.ok ? 'dsn-testOk' : 'dsn-testFailed'}>
                  {step.ok ? '✓' : '✗'} [{step.step}] {step.message}
                </span>
              ))}
              {testView.ready ? <span className="dsn-ready">配置已就绪 ✓</span> : null}
              {testView.causalHint !== undefined ? <span className="dsn-testFailed">{testView.causalHint}</span> : null}
            </div>
          ) : null}

          {testView?.error !== undefined && testView.error.length > 0 ? (
            <p className="dsn-msg dsn-msgFailed" role="status">
              {testView.error}
            </p>
          ) : null}

          <div className="dsn-footer">
            {saveMsg !== null ? (
              <p className={`dsn-msg ${saveMsg.ok ? 'dsn-msgOk' : 'dsn-msgFailed'}`} role="status">
                {saveMsg.text}
              </p>
            ) : null}
            <button type="button" className="dsn-btn dsn-btnSecondary" disabled={saving || testing || !dirty} onClick={() => void load()}>
              放弃
            </button>
            <button type="button" className="dsn-btn dsn-btnPrimary" disabled={saving || testing || !dirty} onClick={() => void save()}>
              {saving ? '保存中…' : '保存'}
            </button>
            <button type="button" className="dsn-btn dsn-btnSecondary" disabled={saving || testing} onClick={() => void test()}>
              {testing ? '测试中…' : '测试推送'}
            </button>
          </div>
          <p className="dsn-hint">「测试推送」会真发一条通知到手机（ping → push → 失败才 register），请在手机上确认</p>
        </div>
      ) : null}
    </li>
  )
}
