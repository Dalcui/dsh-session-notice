/**
 * dsh-session-notice —— Host 半入口。
 *
 * 挂载三块：
 *   1. `bark-notify` settings namespace（ctx.settings → 持久化、live 生效），
 *      承载 server/key/group 与「会通知」会话集合（enabledSessions，重启后保持）；
 *   2. session/event 监听：turn/end 六种 reason → 检查该会话开关 → 组装并推送 Bark
 *      （Host 侧发送：bark-server 无 CORS，浏览器直连自建必失败）；
 *   3. /bark-notify loopback RPC：设置卡片与会话按钮经此读写（密钥永不过线）。
 *
 * 浏览器半（./client 入口，esbuild 产物 lib/client.js）注册设置卡片与会话切换按钮。
 * @module dsh-session-notice
 */
import type { Context } from '@deepseek-ai/cordis';
import { type BarkSettings } from './settings-store.js';
/** 稳定 cordis 插件名（与 cordis.patch.yml 的 insert id 一致）。 */
export declare const name = "bark-notify";
/** 无硬依赖：settings / connection 均通过 ctx.inject 等待，缺失时其余功能静默降级。 */
export declare const inject: string[];
/**
 * 插件入口。
 * @param ctx - 插件上下文。
 * @param config - 组合层覆盖（entry config），合并进默认值。
 */
export declare function apply(ctx: Context, config?: Partial<BarkSettings>): void;
//# sourceMappingURL=index.d.ts.map