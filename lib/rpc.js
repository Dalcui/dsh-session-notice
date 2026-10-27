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
/** 规范化主机名（去首尾空白、去 IPv6 方括号、小写）。 */
export function normalizeHostname(name) {
    return name.trim().toLowerCase().replace(/^\[|\]$/g, '');
}
/** 严格 4 段点分十进制 IPv4 判定（不接受域名、不做前缀猜测）。 */
function isIpv4Literal(text) {
    const parts = text.split('.');
    if (parts.length !== 4)
        return false;
    return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
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
export function isLoopbackHostname(hostname) {
    const bare = normalizeHostname(hostname);
    if (bare === 'localhost')
        return true;
    if (bare === '::1' || bare === '0:0:0:0:0:0:0:1')
        return true;
    return isIpv4Literal(bare) && bare.split('.')[0] === '127';
}
/** 回环别名等价：localhost / 127.0.0.0/8 / ::1 视为同一台本机。 */
function isLoopbackEquivalent(left, right) {
    if (left === right)
        return true;
    return isLoopbackHostname(left) && isLoopbackHostname(right);
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
/** 解析 authority 为 { hostname, port }（port 缺省为空串）。 */
export function parseAuthority(authority) {
    const trimmed = authority.trim();
    if (trimmed.length === 0)
        return undefined;
    let hostname;
    let port = '';
    if (trimmed.startsWith('[')) {
        const close = trimmed.indexOf(']');
        if (close === -1)
            return undefined;
        hostname = trimmed.slice(1, close);
        const rest = trimmed.slice(close + 1);
        if (rest.startsWith(':'))
            port = rest.slice(1);
        else if (rest.length > 0)
            return undefined;
    }
    else {
        const colonAt = trimmed.lastIndexOf(':');
        // 多于一个冒号且无方括号 → 裸 IPv6 字面量，整串都是主机名。
        if (colonAt === -1 || trimmed.indexOf(':') !== colonAt) {
            hostname = trimmed;
        }
        else {
            hostname = trimmed.slice(0, colonAt);
            port = trimmed.slice(colonAt + 1);
        }
    }
    const normalized = normalizeHostname(hostname);
    if (normalized.length === 0)
        return undefined;
    return { hostname: normalized, port };
}
/**
 * Host 是否属于「本部署」。
 *
 * 三类可信来源：
 *  1. 回环（localhost / 127.0.0.0/8 字面量 / ::1）及其 IPv4-mapped 形式；
 *  2. **本机某个网卡 IP** —— 局域网 / 移动端访问时浏览器 Host 的正常形态；
 *  3. `trustedHosts` 名单：显式端口则精确匹配 `host:port`，无端口则任意端口
 *     （与 DSH `isTrustedAuthority` 语义一致）。
 *
 * 第 2 类是本次修复的关键，也是唯一真正生效的闸门（见 trustedRequest 注释）。
 * 它之所以安全：浏览器 Host 由 URL 决定，攻击者的域名无法同时做到
 * 「Host 等于受害者本机 IP」和「页面来自攻击者域」——想做前者就必须把 URL
 * 写成 IP，那就不再是 DNS-rebinding 了。
 *
 * @param hostname - Host 的主机名部分（已规范化）。
 * @param port - Host 的端口部分（可为空）。
 * @param trustedHosts - 额外受信权威名单。
 */
function isOwnDeploymentHost(hostname, port, trustedHosts) {
    if (isLoopbackHostname(hostname))
        return true;
    // IPv4-mapped IPv6 回环/字面量（::ffff:a.b.c.d）：归一后按 IPv4 再判一次。
    const mapped = hostname.replace(/^::ffff:/, '');
    if (mapped !== hostname && isLoopbackHostname(mapped))
        return true;
    const localIps = localNonLoopbackIps();
    if (localIps.has(hostname))
        return true;
    if (mapped !== hostname && localIps.has(mapped))
        return true;
    for (const entry of trustedHosts) {
        const parsed = parseAuthority(entry);
        if (parsed === undefined)
            continue;
        if (parsed.hostname !== hostname)
            continue;
        // 显式端口 = 精确匹配该 authority；无端口 = 任意端口。
        if (parsed.port.length === 0 || parsed.port === port)
            return true;
    }
    return false;
}
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
export function isSameAuthorityOrigin(origin, hostname, port) {
    let originUrl;
    try {
        originUrl = new URL(origin);
    }
    catch {
        return false;
    }
    const protocol = originUrl.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:')
        return false;
    const originHostname = normalizeHostname(originUrl.hostname);
    if (originHostname.length === 0)
        return false;
    if (!isLoopbackEquivalent(originHostname, hostname))
        return false;
    // 回环别名之间不比较端口（127.0.0.1:3080 与 localhost:3080 指同一服务）；
    // 非回环则要求 host:port 完全一致（默认端口按协议归一）。
    if (isLoopbackHostname(originHostname))
        return true;
    const originPort = originUrl.port.length > 0 ? originUrl.port : protocol === 'https:' ? '443' : '80';
    const requestPort = port.length > 0 ? port : '80';
    return originPort === requestPort;
}
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
export function trustedRequest(req, trustedHosts) {
    const rawHost = req.headers.host;
    if (typeof rawHost !== 'string' || rawHost.length === 0)
        return false;
    const authority = parseAuthority(rawHost);
    if (authority === undefined)
        return false;
    // 1. Host 必须属于本部署。
    if (!isOwnDeploymentHost(authority.hostname, authority.port, trustedHosts))
        return false;
    // 2. 跨站请求一律拒绝。
    if (req.headers['sec-fetch-site'] === 'cross-site')
        return false;
    // 3. 带 Origin 时必须同源（无 Origin 是浏览器同源 GET 的正常形态）。
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || origin.length === 0)
        return true;
    return isSameAuthorityOrigin(origin, authority.hostname, authority.port);
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
 * @param readTrusted - 每请求现读的额外受信权威名单（上游插件可能晚于本插件注入）。
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
 * 从 `connection.trustedHosts` 取受信权威名单。
 *
 * ### 为什么必须传入已 resolve 的服务对象
 * Cordis 的 Context 是 Proxy：**未在 `inject` 中声明的服务，读 `ctx.connection`
 * 会直接抛** `cannot get property "connection" without inject`（实测）。
 * 早期实现直接在入口 ctx 上读并 try/catch，异常被吞 → 永远返回 `[]`，
 * 「trustedHosts 分支」成了死代码。因此这里只接受**已经由
 * `ctx.inject(['connection'], ...)` 解析出来的服务对象**（见 registerBarkRpc）。
 *
 * @param connection - 已解析的 connection 服务（可为 undefined，表示该服务缺席）。
 * @returns 受信权威名单；服务缺席或形状不符时返回空数组（此时仅回环 + 网卡 IP 可用）。
 */
function trustedHostsOf(connection) {
    const hosts = connection?.trustedHosts;
    if (!Array.isArray(hosts))
        return [];
    return hosts.filter((entry) => typeof entry === 'string');
}
/**
 * 注册四个精确路径路由。
 *
 * 关键：必须在 `ctx.inject(['webServer'], cb)` 的回调 context 里注册——
 * 直接用入口 ctx 访问 webServer 会抛 "without inject"。
 */
export function registerBarkRpc(ctx, deps) {
    ctx.inject(['webServer'], (webCtx) => {
        // 「每请求现读」的受信权威来源。
        //
        // connection 是**可选**依赖：本机/局域网访问不依赖它（见 isOwnDeploymentHost），
        // 但自定义域名（trustedHosts 声明）依赖它。这里用闭包捕获解析后的服务对象，
        // 而不是在入口 ctx 上读 —— Cordis 未 inject 时读服务会抛
        // "cannot get property \"connection\" without inject"，被 catch 吞掉后名单恒为空，
        // 分支成为死代码（上一版的真实缺陷）。嵌套 inject 让该服务缺席时路由照常可用。
        let connection;
        webCtx.inject(['connection'], (connCtx) => {
            connection = connCtx.connection;
        });
        const getTrustedHosts = () => trustedHostsOf(connection);
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