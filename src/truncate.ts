/**
 * dsh-session-notice —— 按 UTF-8 字节、按码点截断（AC-截断正确性）。
 *
 * 现有实现（dsh-notify / dsh-notify-bark / cc-notify-hooks）全部按 UTF-16 code
 * unit 截断（text.length / String.slice）：中文 4000 字符 ≈ 12000 字节必超限，
 * 且 String.slice 会劈开 emoji 代理对与 ZWJ 序列（"👨‍👩‍👧‍👦" 被切成残缺序列）。
 * 本模块只按码点累加字节，绝不用 text.length / String.slice 做截断。
 * @module dsh-session-notice/truncate
 */

/** UTF-8 字节数（等于服务端与 APNs 的计量口径）。 */
export function byteLength(text: string): number {
  // TextEncoder 在 Node ≥ 11 与浏览器均可用；测试环境无需 polyfill。
  return new TextEncoder().encode(text).length
}

/** 截断结果。 */
export interface Truncation {
  /** 截断后的文本。 */
  text: string
  /** 是否发生了截断。 */
  truncated: boolean
}

/**
 * 把文本按码点累加截断到 maxBytes 字节内，超出部分以 suffix（默认「…」）收尾。
 * suffix 本身计入预算；maxBytes 不足以容纳 suffix 时退化为仅 suffix 的部分。
 * @param text - 原文。
 * @param maxBytes - 结果的总字节预算（含 suffix）。
 * @param suffix - 结尾标记，计入预算。
 */
export function truncateByBytes(text: string, maxBytes: number, suffix = '…'): Truncation {
  if (byteLength(text) <= maxBytes) return { text, truncated: false }
  let budget = maxBytes - byteLength(suffix)
  if (budget < 0) return { text: '', truncated: true } // 连省略号都放不下：返回空串，守住字节契约
  let accumulated = ''
  let accumulatedBytes = 0
  for (const cp of text) {
    const cpBytes = byteLength(cp)
    if (accumulatedBytes + cpBytes > budget) break
    accumulated += cp
    accumulatedBytes += cpBytes
  }
  return { text: accumulated + suffix, truncated: true }
}

/**
 * 生成 body 尾部提示并计入预算。返回尾部与剩余可用字节数。
 * @param totalChars - 原文总字符数（码点数），仅用于展示。
 * @param budget - 剩余 body 字节预算（不含尾部）。
 */
export function bodyTail(totalChars: number, budget: number): { tail: string; rest: number } {
  const tail = `…（共 ${totalChars} 字，见 DSH）`
  const tailBytes = byteLength(tail)
  if (tailBytes >= budget) return { tail: '…', rest: Math.max(0, budget - 1) }
  return { tail, rest: budget - tailBytes }
}
