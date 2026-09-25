/**
 * dsh-session-notice —— Host 半入口。
 *
 * 挂载三块：
 *   1. 插件 Config（settings-store 的 volatile schema）—— dsh-settings 0.1.7
 *      契约：Loader 把 schema 挂进 profile patch，ctx.settings.describe()/update()
 *      读写，值持久化到 patch、live 生效、重启后保持；entry id = 'bark-notify'；
 *   2. session/event 监听：turn/end 六种 reason → 检查该会话开关 → 组装并推送 Bark
 *      （Host 侧发送：bark-server 无 CORS，浏览器直连自建必失败）；
 *   3. /plugins/dsh-session-notice loopback RPC：设置页与会话按钮经此读写（密钥永不过线）。
 *
 * 0.1.5→0.1.7 适配要点（本机 0.1.7-rc.2 源码验证）：
 * - ctx.settings.register(ns, schema, { base, applies }) 已移除；改为导出
 *   Config（含 volatile 字段）+ ctx.settings.describe()/update(ns, patch)；
 * - volatile 字段的值经 cosmokit Volatile<T> 包装，读取需解包；
 * - webServer 仍用 ctx.inject(['webServer'], cb) 回调里注册（见 rpc.ts），
 *   不放进静态 inject。
 *
 * 浏览器半（./client 入口，esbuild 产物 lib/client.js）注册插件配置页与会话切换按钮。
 * @module dsh-session-notice
 */
import type { Context } from '@deepseek-ai/cordis';
import { type BarkSettings } from './settings-store.js';
/** 稳定 cordis 插件名（与 cordis.patch.yml 的 insert id 一致）。 */
export declare const name = "bark-notify";
/**
 * 插件 Config（dsh-settings 0.1.7 契约）：全字段 volatile —— live 可编辑、
 * 写入 profile patch、重启后保持。Loader 读取本导出生成设置表单与读写通道。
 */
export declare const Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
    server: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
    key: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
    group: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
    enabledSessions: import("@deepseek-ai/schemastery").default<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
    maxBodyChars: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    server: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
    key: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
    group: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
    enabledSessions: import("@deepseek-ai/schemastery").default<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
    maxBodyChars: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
}>>, "plain">;
/**
 * 硬依赖：仅 settings（描述/更新 profile patch 中的本插件配置）。
 *
 * webServer 不放进静态 inject：真机验证过 connection.rpc.handle 会以调用者
 * fiber 访问 ctx.webServer 而抛 "without inject" 并导致 profile 崩溃循环，
 * 因此本插件改为自建 HTTP 路由，并在 ctx.inject(['webServer'], cb) 回调里注册
 * （见 rpc.ts）。settings 缺失的 profile（如 headless）本插件不激活。
 */
export declare const inject: readonly ["settings"];
/**
 * 插件入口。
 * @param ctx - 插件上下文。
 * @param config - 组合层覆盖（entry config，含 schema 默认值；volatile 字段为
 *   Volatile 包装，读取前解包）。
 */
export declare function apply(ctx: Context, config?: Partial<BarkSettings>): void;
//# sourceMappingURL=index.d.ts.map