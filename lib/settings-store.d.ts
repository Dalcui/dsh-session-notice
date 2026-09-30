/**
 * dsh-session-notice —— 设置模型：schema、默认值、脱敏视图。
 *
 * 持久化（dsh-settings@0.1.7 引入、0.2.0-rc.2 复核未变的契约）：
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
/** 本插件的 settings namespace / profile patch entry id（与 cordis.patch.yml 的 insert id 一致）。 */
export declare const SETTINGS_NAMESPACE = "bark-notify";
/** 设置模型。 */
export interface BarkSettings {
    /** Bark 服务器基址（官方或自建；可带 url-prefix 或 user:pass@ Basic Auth）。 */
    server: string;
    /** 设备密钥（secret：不落浏览器、不回显、不进日志）。 */
    key: string;
    /** group 覆盖（空串 → 按工作区 basename 自动分组）。 */
    group: string;
    /** 开启「会通知」的会话 id 集合（持久化，服务重启后保持）。 */
    enabledSessions: string[];
    /** 通知正文展示上限（码点数，默认 200；仅正常完成时按「首段 + 末段」摘要，异常停止完整推送错误内容）。 */
    maxBodyChars: number;
}
/** 组合默认值（全新安装的基线）。 */
export declare const DEFAULT_SETTINGS: BarkSettings;
/** settings schema：`key` 是 secret，`enabledSessions` 持久化会话开关。
 * 全部字段标 `volatile()` —— dsh-settings 0.1.7 只允许 volatile 路径写入
 * （`update`/`mutate` 会校验 `isVolatilePath`），且自动生成的设置表单
 * 只展示 volatile 字段。 */
export declare const barkSettingsSchema: z<Schemastery.ObjectS<NoInfer<{
    server: z<string, string, "volatile-defined">;
    key: z<string, string, "volatile-defined">;
    group: z<string, string, "volatile-defined">;
    enabledSessions: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
    maxBodyChars: z<number, number, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    server: z<string, string, "volatile-defined">;
    key: z<string, string, "volatile-defined">;
    group: z<string, string, "volatile-defined">;
    enabledSessions: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
    maxBodyChars: z<number, number, "volatile-defined">;
}>>, "plain">;
/** 浏览器可见的脱敏状态。 */
export interface KeyMask {
    /** 是否已配置密钥。 */
    configured: boolean;
    /** 脱敏回显：`••••••••<末4位>`；未配置为空串。 */
    masked: string;
}
/** 密钥脱敏视图（末 4 位可见；不暴露完整 key）。 */
export declare function maskKey(key: string): KeyMask;
/** server 展示脱敏：带 userinfo（user:pass@）时只回显主机与路径，凭据不落浏览器。 */
export declare function maskServer(server: string): string;
//# sourceMappingURL=settings-store.d.ts.map