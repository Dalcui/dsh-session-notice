/**
 * dsh-session-notice —— 设置模型：schema、默认值、脱敏视图。
 *
 * 持久化（dsh-settings@0.1.7-rc.2 重构后的契约）：
 * - 本 schema 作为插件的 `Config` 导出（见 index.ts），Loader 把它挂进 profile
 *   patch；**volatile 字段**即「live 可编辑、写入 profile patch、重启后保持」；
 * - Host 侧读写走 `ctx.settings.describe()/update()`，entry id = 本 namespace；
 * - `key` 标 `role('secret')`：wire 描述自动脱敏，浏览器只回显「末 4 位」，
 *   日志只打 configured:true/false；写 key 走 merge/patch，绝不整段覆盖。
 *
 * 旧版（≤0.1.5）的 `settings.register(ns, schema, { base, applies })` 在 0.1.7
 * 已移除，register 的职责改由「Config 导出 + volatile 字段」承接。
 * @module dsh-session-notice/settings-store
 */
import z from '@deepseek-ai/schemastery';
import { BODY_CHARS_MAX, BODY_CHARS_MIN, DEFAULT_BODY_CHARS, DEFAULT_SERVER } from './constants.js';
/** 本插件的 settings namespace / profile patch entry id（与 cordis.patch.yml 的 insert id 一致）。 */
export const SETTINGS_NAMESPACE = 'bark-notify';
/** 组合默认值（全新安装的基线）。 */
export const DEFAULT_SETTINGS = {
    server: DEFAULT_SERVER,
    key: '',
    group: '',
    enabledSessions: [],
    maxBodyChars: DEFAULT_BODY_CHARS,
};
/** settings schema：`key` 是 secret，`enabledSessions` 持久化会话开关。
 * 全部字段标 `volatile()` —— dsh-settings 0.1.7 只允许 volatile 路径写入
 * （`update`/`mutate` 会校验 `isVolatilePath`），且自动生成的设置表单
 * 只展示 volatile 字段。 */
export const barkSettingsSchema = z.object({
    server: z.string().default(DEFAULT_SERVER).volatile(),
    key: z.string().role('secret').default('').volatile(),
    group: z.string().default('').volatile(),
    enabledSessions: z.array(z.string()).default([]).volatile(),
    maxBodyChars: z.number().min(BODY_CHARS_MIN).max(BODY_CHARS_MAX).default(DEFAULT_BODY_CHARS).volatile(),
});
/** 密钥脱敏视图（末 4 位可见；不暴露完整 key）。 */
export function maskKey(key) {
    const trimmed = key.trim();
    if (trimmed.length === 0)
        return { configured: false, masked: '' };
    return { configured: true, masked: `••••••••${trimmed.slice(-4)}` };
}
/** server 展示脱敏：带 userinfo（user:pass@）时只回显主机与路径，凭据不落浏览器。 */
export function maskServer(server) {
    const trimmed = server.trim();
    try {
        const url = new URL(trimmed);
        if (url.username !== '' || url.password !== '') {
            url.username = '';
            url.password = '';
            return url.toString().replace(/\/+$/, '');
        }
        return trimmed;
    }
    catch {
        // 非法 URL（无协议等）：保守处理 —— 去掉最后一个 @ 之前的部分（userinfo）。
        const at = trimmed.lastIndexOf('@');
        return at >= 0 ? trimmed.slice(at + 1) : trimmed;
    }
}
//# sourceMappingURL=settings-store.js.map