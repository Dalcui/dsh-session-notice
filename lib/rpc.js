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
 * 路由（仅 loopback 可信请求）：
 *   GET  /plugins/dsh-session-notice/state   → 脱敏设置视图（server 掩码 / key 末 4 位）
 *   POST /plugins/dsh-session-notice/set     → 写 server/key/group（key 仅新值）
 *   POST /plugins/dsh-session-notice/toggle  → 翻转某会话「会通知」状态
 *   POST /plugins/dsh-session-notice/test    → ping → push →（失败才）register 三步连通测试
 * @module dsh-session-notice/rpc
 */
import { DEFAULT_SERVER, runConnectivityTest, weakKeyCheck } from './bark-service.js';
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
/** host 头是否为回环地址。 */
function hostIsLoopback(host) {
    if (host === undefined)
        return false;
    const bare = host.replace(/^\[|\]$/g, '').split(':')[0] ?? '';
    return bare === '127.0.0.1' || bare === 'localhost' || bare === '::1';
}
/** origin 头是否为回环地址（无 origin 视为同源 fetch）。 */
function originIsLoopback(origin) {
    if (origin === undefined || origin.length === 0)
        return true;
    try {
        const url = new URL(origin);
        return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';
    }
    catch {
        return false;
    }
}
/** 仅接受本机回环请求（与 DSH 其它插件路由一致）。 */
function loopbackRequest(req) {
    return hostIsLoopback(req.headers.host) && originIsLoopback(req.headers.origin);
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
    };
    json(res, 200, { ok: true, value: await runConnectivityTest(conf) });
}
/** 统一包装一个 handler：校验回环来源与方法，并兜住异常。 */
function wrap(method, run) {
    return (req, res) => {
        if (!loopbackRequest(req)) {
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
 * 注册四个精确路径路由。
 *
 * 关键：必须在 `ctx.inject(['webServer'], cb)` 的回调 context 里注册——
 * 直接用入口 ctx 访问 webServer 会抛 "without inject"。
 */
export function registerBarkRpc(ctx, deps) {
    ctx.inject(['webServer'], (webCtx) => {
        webCtx.effect(() => {
            const disposers = [
                webCtx.webServer.register({
                    kind: 'exact',
                    path: `${ROUTE_PREFIX}/state`,
                    handler: wrap('GET', (_req, res) => handleState(deps, res)),
                }),
                webCtx.webServer.register({
                    kind: 'exact',
                    path: `${ROUTE_PREFIX}/set`,
                    handler: wrap('POST', (req, res) => handleSet(deps, req, res)),
                }),
                webCtx.webServer.register({
                    kind: 'exact',
                    path: `${ROUTE_PREFIX}/toggle`,
                    handler: wrap('POST', (req, res) => handleToggle(deps, req, res)),
                }),
                webCtx.webServer.register({
                    kind: 'exact',
                    path: `${ROUTE_PREFIX}/test`,
                    handler: wrap('POST', (req, res) => handleTest(deps, res)),
                }),
            ];
            return () => {
                for (const dispose of disposers)
                    void dispose();
            };
        }, 'bark-notify: http routes');
    });
}
//# sourceMappingURL=rpc.js.map