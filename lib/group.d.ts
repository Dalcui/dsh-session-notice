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
/** 去掉控制字符（含换行/制表），trim 首尾空白。 */
export declare function sanitizeGroupText(input: string): string;
/**
 * 归一化一个 group 候选值。
 * @param input - 设置页填写的 group（可为空串 → 回退工作区名）。
 * @param cwd - 会话工作目录（取 basename 作默认 group）。
 * @returns 归一后的 group；归一后为空返回 undefined（调用方省略字段）。
 */
export declare function normalizeGroup(input: string, cwd?: string): string | undefined;
/** 工作区默认 group：basename；无法取得时为 undefined（省略字段）。 */
export declare function fallbackFromCwd(cwd?: string): string | undefined;
/** 短哈希：sha1 前 6 位 hex（用于重名工作区消歧）。 */
export declare function shortHash(input: string): string;
//# sourceMappingURL=group.d.ts.map