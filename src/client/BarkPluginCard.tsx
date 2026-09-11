/**
 * dsh-session-notice —— 设置-插件配置卡片（settings.plugin.item, key='bark-notify'）。
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

/** `get` 端点返回的脱敏视图。 */
interface SettingsView {
  server: string
  serverMasked: boolean
  keyConfigured: boolean
  keyMasked: string
  group: string
  enabledSessions: string[]
}

/** `test` 端点返回的三步结果。 */
interface TestView {
  steps: Array<{ step: string; ok: boolean; kind: string; message: string }>
  ready: boolean
  causalHint?: string
}

export function BarkPluginCard({ rpc }: { rpc: RpcCall }): ReactElement | null {
  const [view, setView] = useState<SettingsView | null>(null)
  const [loadError, setLoadError] = useState('')
  const [server, setServer] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
  const [group, setGroup] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [testView, setTestView] = useState<(TestView & { error?: string }) | null>(null)

  const load = async (): Promise<void> => {
    const res = await rpc('get', {})
    if (!res.ok) {
      setLoadError(res.error?.message ?? 'RPC failed')
      return
    }
    const value = res.value as SettingsView
    setView(value)
    setServer(value.server)
    setGroup(value.group)
    setKeyDraft('')
    setLoadError('')
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveDraft = async (): Promise<boolean> => {
    const patch: Record<string, string> = {}
    // 空 server 也提交：Host 侧会归一为默认官方地址（清空 = 恢复默认）。
    if (server.trim() !== (view?.server ?? '')) patch.server = server
    if (keyDraft.length > 0) patch.key = keyDraft
    if (group !== (view?.group ?? '')) patch.group = group
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
    // 先保存草稿（测试使用已保存配置），再真发测试推送。
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

  if (loadError.length > 0) {
    return <div style={{ padding: '8px 0', color: 'var(--dsw-alias-label-error)' }}>设置加载失败：{loadError}</div>
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    height: 34,
    borderRadius: 8,
    border: '1px solid var(--dsw-alias-border-l4, #ccc)',
    background: 'var(--dsw-alias-bg-layer-3, transparent)',
    color: 'var(--dsw-alias-label-primary, inherit)',
    padding: '0 12px',
    fontSize: 13,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 0' }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Bark 服务器</div>
        <input
          style={inputStyle}
          value={server}
          placeholder="https://api.day.app"
          onChange={(event) => setServer(event.target.value)}
        />
        <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #888)', marginTop: 4 }}>
          官方或自建 Bark Server（可带路径前缀或 user:pass@ 基本鉴权）
        </div>
      </div>

      <div>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
          密钥
          {view?.keyConfigured === true && (
            <span style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #888)', marginLeft: 8 }}>
              已配置（{view.keyMasked}）
            </span>
          )}
        </div>
        <input
          style={inputStyle}
          type="password"
          value={keyDraft}
          placeholder={view?.keyConfigured === true ? '留空 = 不修改；输入新值替换' : '粘贴 Bark key'}
          autoComplete="off"
          onChange={(event) => setKeyDraft(event.target.value)}
        />
        <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #888)', marginTop: 4 }}>
          密钥只存 Host 侧、界面仅显示末 4 位，不落浏览器、不进日志
        </div>
      </div>

      <div>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>分组（group）</div>
        <input
          style={inputStyle}
          value={group}
          placeholder="默认按工作区分组"
          onChange={(event) => setGroup(event.target.value)}
        />
        <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #888)', marginTop: 4 }}>
          同一分组在手机通知里按项目聚合、支持按分组静音；清空 = 按工作区自动
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
        <button type="button" disabled={saving || testing} onClick={() => void save()}
          style={{ flex: 1, height: 32, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l4, #ccc)', background: 'var(--dsw-alias-bg-layer-3, transparent)', color: 'var(--dsw-alias-label-primary, inherit)', cursor: 'pointer' }}>
          {saving ? '保存中…' : '保存'}
        </button>
        <button type="button" disabled={saving || testing} onClick={() => void test()}
          style={{ flex: 1, height: 32, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l4, #ccc)', background: 'var(--dsw-alias-bg-layer-3, transparent)', color: 'var(--dsw-alias-label-primary, inherit)', cursor: 'pointer' }}>
          {testing ? '测试中…' : '测试推送（请留意手机）'}
        </button>
      </div>

      {saveMsg !== null && (
        <div style={{ fontSize: 12, color: saveMsg.ok ? 'var(--dsw-alias-label-success, #2f9e44)' : 'var(--dsw-alias-label-error, #d64545)' }}>
          {saveMsg.text}
        </div>
      )}

      {testView?.error !== undefined && testView.error.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-error, #d64545)' }}>{testView.error}</div>
      )}

      {testView !== null && testView.error === undefined && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          {testView.steps.map((step) => (
            <div key={step.step} style={{ color: step.ok ? 'var(--dsw-alias-label-success, #2f9e44)' : 'var(--dsw-alias-label-error, #d64545)' }}>
              {step.ok ? '✓' : '✗'} [{step.step}] {step.message}
            </div>
          ))}
          {testView.ready && (
            <div style={{ color: 'var(--dsw-alias-label-success, #2f9e44)', fontWeight: 600 }}>配置已就绪 ✓</div>
          )}
          {testView.causalHint !== undefined && (
            <div style={{ color: 'var(--dsw-alias-label-error, #d64545)' }}>{testView.causalHint}</div>
          )}
        </div>
      )}
    </div>
  )
}
