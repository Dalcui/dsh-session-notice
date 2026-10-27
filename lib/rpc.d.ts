/**
 * dsh-session-notice —— Host 侧 HTTP RPC（/plugins/dsh-session-notice/*）。
 *
 * 为什么不用 `ctx.connection.rpc.handle`（真机验证）：该 API 内部会用
 * **调用者 fiber** 的 `ctx.webServer.register(...)` 挂 HTTP 路由，在 0.1.5-rc.1
 * 的 web profile 里即使声明 `inject: ['webServer']` 也会抛
 * `cannot get property "webServer" without inject`，导致整个 profile 崩溃循环。
 * 因此改用本机已验证可用的写法（同 dsh-codebuddy-cli）：
 * `ctx.inject(['webServer'], (webCtx) => webCtx.webServer.register({ kind:'exact', ... }))`
 * 自建精确路径路由，client 半直接 fetch 这些路径。
 *
 * 路由（仅本机回环或浏览器同源可信请求；详见 trustedRequest 注释）：
 *   GET  /plugins/dsh-session-notice/state   → 脱敏设置视图（server 掩码 / key 末 4 位）
 *   POST /plugins/dsh-session-notice/set     → 写 server/key/group（key 仅新值）
 *   POST /plugins/dsh-session-notice/toggle  → 翻转某会话「会通知」状态
 *   POST /plugins/dsh-session-notice/test    → ping → push →（失败才）register 三步连通测试
 * @module dsh-session-notice/rpc
 */
import type { IncomingMessage } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import { type BarkSettings } from './settings-store.js';
/** 本插件路由前缀（与 client 半 fetch 的路径一致）。 */
export declare const ROUTE_PREFIX = "/plugins/dsh-session-notice";
/** RPC 层依赖（由插件入口绑定 settings 持久化）。 */
export interface BarkRpcDeps {
    getSettings(): BarkSettings;
    /** merge 写入（Host 侧；绝不整段替换，防浏览器脱敏视图清空密钥）。 */
    updateSettings(patch: {
        server?: string;
        key?: string;
        group?: string;
        enabledSessions?: string[];
        maxBodyChars?: number;
    }): Promise<void>;
    /** 翻转会话开关；返回最新状态与集合。 */
    toggleSession(sessionId: string): Promise<{
        enabled: boolean;
        enabledSessions: string[];
    }>;
    /** 当前工作区（默认 group 来源，可选）。 */
    workspaceCwd?(): string | undefined;
}
/** 规范化主机名（去首尾空白、去 IPv6 方括号、小写）。 */
export declare function normalizeHostname(name: string): string;
/**
 * hostname 是否为本机回环变体。
 *
 * **必须严格判定**：早期写法用 `/^127\./`，会把 `127.evil.com`、
 * `127.0.0.1.nip.io` 这类攻击者可控域名判成回环 —— 由于 Host 判定是
 * 本插件唯一的来源闸门，这等于对任意域名开放（实测可直接读到脱敏设置）。
 * 因此这里只认：localhost、IPv6 回环字面量、以及 127.0.0.0/8 的
 * **合法 4 段 IPv4 字面量**。
 * @param hostname - 已小写、去方括号的主机名。
 */
export declare function isLoopbackHostname(hostname: string): boolean;
/** 解析 authority 为 { hostname, port }（port 缺省为空串）。 */
export declare function parseAuthority(authority: string): {
    hostname: string;
    port: string;
} | undefined;
/**
 * Origin 是否与请求的 Host 同源。
 *
 * **严格对齐 DSH 的 `isSameAuthorityOrigin`**：比较 `host:port` 与协议，
 * 而不是只比主机名。只比主机名会放过 `http://192.168.0.112:9999`
 * 与 `https://192.168.0.112`（协议不同 = 混合内容/降级攻击的判据）。
 *
 * 回环别名（localhost / 127.0.0.1 / ::1）视为等价，避免本机访问的误伤。
 *
 * @param origin - 原始 Origin 头。
 * @param hostname - 请求 Host 的主机名。
 * @param port - 请求 Host 的端口。
 * @returns 同源返回 true。
 */
export declare function isSameAuthorityOrigin(origin: string, hostname: string, port: string): boolean;
/**
 * 请求是否可信。
 *
 * 判据（全部满足才可信）：
 *  1. Host 属于本部署（见 isOwnDeploymentHost）；
 *  2. 不携带 `Sec-Fetch-Site: cross-site`；
 *  3. 若带 Origin，必须与 Host 同源（见 isSameAuthorityOrigin）。
 *
 * ### 为什么旧写法（Host/Origin 均为回环才放行）是错的
 * 局域网 / 移动端经 LAN IP 访问时，浏览器 Host 是 `192.168.x.x:3080`，
 * 永远不是回环 —— 只判回环会让全部 RPC 403，而 client 半的 ToggleButton
 * 拿不到 /state 就 `return null`，表现为「局域网访问时按钮不显示」。
 *
 * ### 为什么不能只靠 Origin
 * 浏览器对**同源 GET** 的 fetch 默认不发 Origin，「Origin 必须存在且同源」
 * 会让正常请求被拒（实测：真实浏览器 fetch 全部 403）。
 *
 * ### 安全边界（重要）
 * 部分部署（如本机 dsh-remote-mobile 的 compat 层）会在**每条 TCP 连接的
 * 首个请求**上把 Origin 改写为 `127.0.0.1`、`Sec-Fetch-Site` 改写为
 * `same-origin`。在这种环境下第 2、3 条会被上游洗白，**真正生效的只有
 * 第 1 条「Host 属于本部署」**。因此 isLoopbackHostname / isOwnDeploymentHost
 * 的严格性就是本插件唯一的安全水位，绝不能用前缀匹配这类宽松判定。
 *
 * ### 身份认证不在这里
 * 设备认证由 DSH 上游负责（dsh-remote-mobile 的 token 门禁、
 * dsh-client-connection 的 Cookie 鉴权）。这里只做来源（跨站 / DNS-rebinding）校验。
 *
 * @param req - 待校验的 HTTP 请求。
 * @param trustedHosts - 额外受信权威名单（可为空，不影响本机与局域网访问）。
 */
export declare function trustedRequest(req: IncomingMessage, trustedHosts: readonly string[]): boolean;
/**
 * 注册四个精确路径路由。
 *
 * 关键：必须在 `ctx.inject(['webServer'], cb)` 的回调 context 里注册——
 * 直接用入口 ctx 访问 webServer 会抛 "without inject"。
 */
export declare function registerBarkRpc(ctx: Context, deps: BarkRpcDeps): void;
//# sourceMappingURL=rpc.d.ts.map