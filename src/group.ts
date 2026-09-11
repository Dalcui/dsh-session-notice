/**
 * dsh-session-notice —— group 归一化（AC-group 完整性，落在发送层）。
 *
 * App 侧坑（调研 t3/t4 查 App 源码）：
 * - group:"" 空串 ≠ 省略 group：App 把 nil 当「未分组」分支，空串会形成空名分组；
 * - 「按分组静音」按组名精确匹配（[String:Date] 带过期），历史过滤是 Realm
 *   filter("group == %@") ⇒ 改一次名会把同一项目的历史与静音设置分裂成两组；
 * - 易变信息（日期/sessionId/turn/分支）禁止进 group，会话身份放 id 与 url。
 *
 * 归一化：trim → 剔除控制字符/换行/制表 → 限 40 字节；归一后为空则返回
 * undefined（调用方省略该字段）；超 40 字节回退 `<basename> · <sha1 前 6>`。
 * @module dsh-session-notice/group
 */

import { createHash } from 'node:crypto'

import { GROUP_BUDGET_BYTES } from './constants.js'
import { byteLength, truncateByBytes } from './truncate.js'

/** 去掉控制字符（含换行/制表），trim 首尾空白。 */
export function sanitizeGroupText(input: string): string {
  // 剔除 C0/C1 控制字符与换行/制表；保留可见 Unicode（中文合法）。
  return input.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, '').trim()
}

/**
 * 归一化一个 group 候选值。
 * @param input - 设置页填写的 group（可为空串 → 回退工作区名）。
 * @param cwd - 会话工作目录（取 basename 作默认 group）。
 * @returns 归一后的 group；归一后为空返回 undefined（调用方省略字段）。
 */
export function normalizeGroup(input: string, cwd?: string): string | undefined {
  const explicit = sanitizeGroupText(input)
  const candidate = explicit.length > 0 ? explicit : fallbackFromCwd(cwd)
  if (candidate === undefined) return undefined
  if (byteLength(candidate) <= GROUP_BUDGET_BYTES) return candidate
  // 超限：截断到 40B 内，保留可见文本。
  const truncated = truncateByBytes(candidate, GROUP_BUDGET_BYTES, '').text
  return truncated.length > 0 ? truncated : fallbackFromCwd(cwd)
}

/** 工作区默认 group：basename；无法取得时为 undefined（省略字段）。 */
export function fallbackFromCwd(cwd?: string): string | undefined {
  if (cwd === undefined || cwd.length === 0) return undefined
  const parts = cwd.split(/[\\/]+/).filter((part) => part.length > 0)
  const base = parts[parts.length - 1]
  if (base === undefined || base.length === 0) return undefined
  const cleaned = sanitizeGroupText(base)
  if (cleaned.length === 0) return undefined
  return byteLength(cleaned) <= GROUP_BUDGET_BYTES
    ? cleaned
    : `${truncateByBytes(cleaned, GROUP_BUDGET_BYTES - 12, '').text} · ${shortHash(cwd)}`
}

/** 短哈希：sha1 前 6 位 hex（用于重名工作区消歧）。 */
export function shortHash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 6)
}
