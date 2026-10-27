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
import { networkInterfaces } from 'node:os';
import { DEFAULT_SERVER, runConnectivityTest, weakKeyCheck } from './bark-service.js';
import { BODY_CHARS_MAX, BODY_CHARS_MIN } from './constants.js';
import { maskKey, maskServer } from './settings-store.js';
/** 本插件路由前缀（与 client 半 fetch 的路径一致）。 */
export const ROUTE_PREFIX = '/plugins/dsh-session-notice';
/** 请求体上限（配置字段都很小）。 */
const BODY_LIMIT = 64 * 1024;
/** 写 JSON 响应。 */
function json(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
    });
    res.end(payload);
}
/** 规范化 IPv6 文本（去方括号、小写）。 */
function normalizeHostname(name) {
    return name.trim().toLowerCase().replace(/^\[|\]$/g, '');
}
/** hostname 是否为本机回环变体。 */
function isLoopbackHostname(hostname) {
    const bare = normalizeHostname(hostname);
    return bare === 'localhost' || bare === '::1' || bare === '0:0:0:0:0:0:0:1' || bare === '127.0.0.1' || /^127\./.test(bare);
}
/** 本机网卡 IP 缓存有效期（DHCP 换 IP 后最多延迟该时长生效）。 */
const LOCAL_IPS_TTL_MS = 5000;
let localIpsCache = null;
/**
 * 取本机全部非回环网卡 IP。
 *
 * 思路与 dsh-remote-mobile 的 `isTrustedHost` 一致：**「本部署自己的网卡 IP」
 * 是局域网/移动端访问时浏览器 Host 里必然出现的取值**，而它不可能是
 * DNS-rebinding 的受害者目标（攻击者无法让 `evil.com` 解析到「受害者本机的
 * 局域网 IP」并同时让 Host 保持 evil.com —— Host 由浏览器按 URL 填写，
 * 想命中本机 IP 就必须把 URL 写成该 IP，那时就不存在「伪造域名」了）。
 *
 * 这样就不必依赖上游 `connection.trustedHosts` 是否注入成功
 * （实测本机 dsh-remote-mobile v1.10.1 的底座鉴权接管未完成，
 * 该名单可能为空，见启动日志警告）。
 *
 * 5s 缓存避免每请求枚举网卡。
 * @returns 本机非回环 IP 集合（小写、去 `::ffff:` 前缀与 zone）。
 */
function localNonLoopbackIps() {
    const now = Date.now();
    if (localIpsCache !== null && now - localIpsCache.at < LOCAL_IPS_TTL_MS)
        return localIpsCache.ips;
    const ips = new Set();
    try {
        for (const entries of Object.values(networkInterfaces())) {
            for (const entry of entries ?? []) {
                const bare = entry.address.toLowerCase().replace(/^::ffff:/, '').split('%')[0] ?? '';
                if (bare.length > 0 && !isLoopbackHostname(bare))
                    ips.add(bare);
            }
        }
    }
    catch {
        // 枚举失败：留空（此时仅回环可用）。
    }
    localIpsCache = { at: now, ips };
    return ips;
}
/**
 * 请求是否可信。
 *
 * **直接对齐 DSH 自身的 `isTrustedApiRequest` 语义**
 * （@deepseek-ai/dsh-client-connection，即 DSH 用来守护 /api RPC 桥的同款判定），
 * 而不是自行发明一套：插件路由是 DSH webserver 上的普通路由，
 * 其可信边界应与 DSH 自己一致。
 *
 * 判据：
 *  1. Host 必须是「我们的」：回环、**本机某个网卡 IP**、或 `trustedHosts` 名单内的权威；
 *  2. 禁止 `Sec-Fetch-Site: cross-site`（跨站）；
 *  3. 若带 Origin，则必须与 Host 同源。
 *
 * ### 为什么旧写法（只判 Host/Origin 是否回环）是错的
 * 局域网 / 移动端经 LAN IP 访问时浏览器发出的 Host 是 `192.168.x.x:3080`，
 * 永远不是回环地址 —— 只判回环会让本插件全部 RPC 在局域网访问下 403，
 * 而 client 半的 ToggleButton 拿不到 /state 就 `return null`，
 * 表现为「局域网访问时本插件按钮不显示」。
 *
 * ### 为什么不能只靠 Origin 判同源
 * 浏览器对**同源 GET** 的 fetch 默认不发送 Origin，因此「Origin 存在且同源」
 * 作为唯一放行条件会让正常请求被拒（实测：真实浏览器 fetch 全部 403）。
 * 正确的做法是像 DSH 那样：先确认 Host 属于本部署，再看 Origin 是否与之一致。
 *
 * ### 身份认证不在这里
 * 真正的设备认证由 DSH 上游完成（dsh-remote-mobile 的 token 门禁、
 * dsh-client-connection 的 Cookie 鉴权），本插件路由在它们之后才被调用，
 * 因此这里只做「跨站 / DNS-rebinding」这一类来源校验，不重复实现设备认证。
 *
 * @param req - 待校验的 HTTP 请求。
 * @param trustedHosts - DSH 部署声明服务的额外非回环权威（可为空；
 *   「本机网卡 IP」已由 localNonLoopbackIps() 自行覆盖，不依赖上游注入是否成功）。
 */
function trustedRequest(req, trustedHosts) {
    const host = req.headers.host;
    if (typeof host !== 'string' || host.length === 0)
        return false;
    // 1. Host 必须属于本部署：回环 / trustedHosts / 监听地址字面量。
    const hostname = normalizeHostname(host.startsWith('[') ? (host.slice(1).split(']')[0] ?? '') : (host.split(':')[0] ?? ''));
    if (hostname.length === 0)
        return false;
    let hostOk = isLoopbackHostname(hostname);
    // 1b. 本机某个网卡 IP：局域网 / 移动端访问时的正常形态。
    if (!hostOk)
        hostOk = localNonLoopbackIps().has(hostname);
    if (!hostOk) {
        for (const entry of trustedHosts) {
            const entryHostname = normalizeHostname(entry.startsWith('[') ? (entry.slice(1).split(']')[0] ?? '') : (entry.split(':')[0] ?? ''));
            if (entryHostname.length > 0 && entryHostname === hostname) {
                hostOk = true;
                break;
            }
        }
    }
    if (!hostOk)
        return false;
    // 2. 跨站请求一律拒绝（浏览器强制填写，页面脚本无法伪造）。
    if (req.headers['sec-fetch-site'] === 'cross-site')
        return false;
    // 3. 带 Origin 时必须与 Host 同源（无 Origin 是浏览器同源 GET 的正常形态）。
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || origin.length === 0)
        return true;
    try {
        return normalizeHostname(new URL(origin).hostname) === hostname;
    }
    catch {
        return false;
    }
}
/** 读取有上限的请求体。 */
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > BODY_LIMIT) {
                reject(new Error('request body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}
/** 解析 JSON 请求体（空体视为 {}）。 */
async function readJson(req) {
    const raw = (await readBody(req)).trim();
    if (raw.length === 0)
        return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('body 必须是 JSON 对象');
    }
    return parsed;
}
/** GET /state */
function handleState(deps, res) {
    const settings = deps.getSettings();
    const mask = maskKey(settings.key);
    const serverVisible = maskServer(settings.server);
    json(res, 200, {
        ok: true,
        value: {
            server: serverVisible,
            serverMasked: serverVisible !== settings.server,
            keyConfigured: mask.configured,
            keyMasked: mask.masked,
            group: settings.group,
            enabledSessions: settings.enabledSessions,
            maxBodyChars: settings.maxBodyChars,
        },
    });
}
/** POST /set */
async function handleSet(deps, req, res) {
    const patch = await readJson(req);
    const next = {};
    if (patch.server !== undefined) {
        if (typeof patch.server !== 'string') {
            json(res, 400, { ok: false, message: 'set: server 必须是字符串' });
            return;
        }
        const trimmed = patch.server.trim().replace(/\/+$/, '');
        next.server = trimmed.length > 0 ? trimmed : DEFAULT_SERVER;
    }
    if (patch.key !== undefined) {
        if (typeof patch.key !== 'string') {
            json(res, 400, { ok: false, message: 'set: key 必须是字符串' });
            return;
        }
        if (patch.key.trim().length === 0) {
            next.key = ''; // 显式清除密钥
        }
        else {
            const invalid = weakKeyCheck(patch.key);
            if (invalid !== undefined) {
                json(res, 400, { ok: false, message: `set: ${invalid}` });
                return;
            }
            next.key = patch.key.trim();
        }
    }
    if (patch.group !== undefined) {
        if (typeof patch.group !== 'string') {
            json(res, 400, { ok: false, message: 'set: group 必须是字符串' });
            return;
        }
        next.group = patch.group;
    }
    if (patch.maxBodyChars !== undefined) {
        const raw = patch.maxBodyChars;
        if (typeof raw !== 'number' || !Number.isFinite(raw)) {
            json(res, 400, { ok: false, message: 'set: maxBodyChars 必须是数字' });
            return;
        }
        const rounded = Math.floor(raw);
        if (rounded < BODY_CHARS_MIN || rounded > BODY_CHARS_MAX) {
            json(res, 400, { ok: false, message: `set: maxBodyChars 需在 ${BODY_CHARS_MIN}–${BODY_CHARS_MAX} 之间` });
            return;
        }
        next.maxBodyChars = rounded;
    }
    if (Object.keys(next).length === 0) {
        json(res, 200, { ok: true, value: { saved: true, noop: true } });
        return;
    }
    await deps.updateSettings(next);
    json(res, 200, { ok: true, value: { saved: true } });
}
/** POST /toggle */
async function handleToggle(deps, req, res) {
    const body = await readJson(req);
    if (typeof body.sessionId !== 'string' || body.sessionId.length === 0) {
        json(res, 400, { ok: false, message: 'toggle: sessionId 缺失' });
        return;
    }
    json(res, 200, { ok: true, value: await deps.toggleSession(body.sessionId) });
}
/** POST /test */
async function handleTest(deps, res) {
    const settings = deps.getSettings();
    if (settings.key.trim().length === 0) {
        json(res, 400, { ok: false, message: '尚未配置 key，请先填写并保存' });
        return;
    }
    const conf = {
        server: settings.server,
        key: settings.key,
        group: settings.group,
        cwd: deps.workspaceCwd?.(),
        maxBodyChars: settings.maxBodyChars,
    };
    json(res, 200, { ok: true, value: await runConnectivityTest(conf) });
}
/**
 * 统一包装一个 handler：校验请求来源与方法，并兜住异常。
 * @param method - 该端点允许的 HTTP 方法。
 * @param run - 实际业务处理。
 * @param trustedHosts - DSH 部署声明的受信非回环权威（决定局域网 Host 是否可信）。
 */
function wrap(method, run, readTrusted) {
    return (req, res) => {
        // 每次请求现读：trustedHosts 可能在上游插件激活后才被注入网卡 IP。
        if (!trustedRequest(req, readTrusted())) {
            json(res, 403, { ok: false, message: 'request-not-trusted' });
            return;
        }
        if (req.method !== method) {
            json(res, 405, { ok: false, message: 'method not allowed' });
            return;
        }
        try {
            const settled = run(req, res);
            if (settled !== undefined) {
                void settled.catch((error) => {
                    json(res, 500, { ok: false, message: error instanceof Error ? error.message : String(error) });
                });
            }
        }
        catch (error) {
            json(res, 500, { ok: false, message: error instanceof Error ? error.message : String(error) });
        }
    };
}
/**
 * 读取 DSH 部署声明的受信非回环权威（`connection.trustedHosts`）。
 *
 * 该数组是 DSH 自己的 Host/Origin 围栏（`isTrustedApiRequest`）所用的同一份名单，
 * 由 web profile 配置与 dsh-remote-mobile（把本机全部网卡 IP 注入进来）共同填充，
 * 因此局域网 IP 正在其中。fail-soft：connection 服务缺席或形状不符时返回空数组，
 * 此时仅回环请求可用（与旧行为一致），不会因读取失败而带崩插件。
 *
 * @param ctx - 插件上下文。
 * @returns 受信权威快照（每次请求读取，跟随上游注入动态变化）。
 */
function readTrustedHosts(ctx) {
    try {
        const connection = ctx.connection;
        const hosts = connection?.trustedHosts;
        if (Array.isArray(hosts))
            return hosts.filter((entry) => typeof entry === 'string');
    }
    catch {
        // 服务尚未就绪或不可读：退回仅回环策略。
    }
    return [];
}
/**
 * 注册四个精确路径路由。
 *
 * 关键：必须在 `ctx.inject(['webServer'], cb)` 的回调 context 里注册——
 * 直接用入口 ctx 访问 webServer 会抛 "without inject"。
 */
export function registerBarkRpc(ctx, deps) {
    ctx.inject(['webServer'], (webCtx) => {
        // 每次请求都重新读，以跟随上游（如 dsh-remote-mobile）后注入的网卡 IP。
        const getTrustedHosts = () => readTrustedHosts(ctx);
        webCtx.effect(() => {
            // 0.1.7 对重复 (kind, path) 路由注册直接 throw：极端 HMR/重载时序下若旧 fiber 的
            // disposer 尚未执行、新注册先到，单个失败不应带崩全部四个路由；首次失败 1s 后
            // 重试一次（旧 fiber 的 disposer 通常在该窗口内完成），仍失败才跳过并告警。
            const register = (route) => {
                try {
                    return webCtx.webServer.register(route);
                }
                catch (error) {
                    webCtx.logger.warn(`[bark-notify] HTTP 路由 ${route.path} 首次注册失败：${error instanceof Error ? error.message : String(error)}；1s 后重试一次`);
                    let retryTimer = null;
                    let retryDisposer = null;
                    retryTimer = setTimeout(() => {
                        try {
                            retryDisposer = webCtx.webServer.register(route);
                        }
                        catch (retryError) {
                            webCtx.logger.warn(`[bark-notify] HTTP 路由 ${route.path} 重试仍失败：${retryError instanceof Error ? retryError.message : String(retryError)}`);
                        }
                    }, 1000);
                    return () => {
                        if (retryTimer !== null)
                            clearTimeout(retryTimer);
                        if (retryDisposer !== null)
                            void retryDisposer;
                    };
                }
            };
            const disposers = [
                register({
                    kind: 'exact',
                    path: `${ROUTE_PREFIX}/state`,
                    handler: wrap('GET', (_req, res) => handleState(deps, res), getTrustedHosts),
                }),
                register({
                    kind: 'exact',
                    path: `${ROUTE_PREFIX}/set`,
                    handler: wrap('POST', (req, res) => handleSet(deps, req, res), getTrustedHosts),
                }),
                register({
                    kind: 'exact',
                    path: `${ROUTE_PREFIX}/toggle`,
                    handler: wrap('POST', (req, res) => handleToggle(deps, req, res), getTrustedHosts),
                }),
                register({
                    kind: 'exact',
                    path: `${ROUTE_PREFIX}/test`,
                    handler: wrap('POST', (req, res) => handleTest(deps, res), getTrustedHosts),
                }),
            ].filter((dispose) => dispose !== null);
            if (disposers.length === 0)
                webCtx.logger.warn('[bark-notify] 全部 HTTP 路由注册失败，设置页/会话按钮将不可用');
            return () => {
                for (const dispose of disposers)
                    void dispose();
            };
        }, 'bark-notify: http routes');
    });
}
//# sourceMappingURL=rpc.js.map