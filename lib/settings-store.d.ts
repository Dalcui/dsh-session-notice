/**
 * dsh-session-notice —— 设置模型：schema、默认值、脱敏视图。
 *
 * namespace 注册在 Host 侧 `ctx.settings`（值持久化到 settings 存储、live 生效）。
 * 注意（t4 本机验证）：dsh-settings@0.1.5-rc.1 **没有** `settingsNamespace()` 导出，
 * register 的 ns 直接传小写连字符字面量即可（运行时只校验该正则）。
 *
 * 密钥安全共识（三家现有插件独立收敛）：
 * - `key` 标 `role('secret')`，wire 上的 describe 自动脱敏；
 * - 浏览器只回显「•••••••• + 末 4 位」，日志只打 configured:true/false；
 * - 写密钥走 merge/patch（`update`/`mutate`），绝不用 `replace` 整段覆盖——
 *   浏览器只持脱敏视图，整段覆盖会把脱敏值写回、清空真密钥。
 * @module dsh-session-notice/settings-store
 */
import z from '@deepseek-ai/schemastery';
/** 本插件的 settings namespace（同时是 settings.plugin.item 卡片的 key）。 */
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
    /** 通知正文展示上限（码点数，默认 200；超出按「首段 + 末段」摘要）。 */
    maxBodyChars: number;
}
/** 组合默认值（全新安装的基线）。 */
export declare const DEFAULT_SETTINGS: BarkSettings;
/** settings schema：`key` 是 secret，`enabledSessions` 持久化会话开关。 */
export declare const barkSettingsSchema: z<Schemastery.ObjectS<{
    server: z<string, string>;
    key: z<string, string>;
    group: z<string, string>;
    enabledSessions: z<string[], string[]>;
    maxBodyChars: z<number, number>;
}>, Schemastery.ObjectT<{
    server: z<string, string>;
    key: z<string, string>;
    group: z<string, string>;
    enabledSessions: z<string[], string[]>;
    maxBodyChars: z<number, number>;
}>>;
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