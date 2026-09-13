/**
 * dsh-session-notice —— Bark 发送层（Host 侧专用；fetch 可注入以便测试）。
 *
 * 协议定稿（t3/t4 实测）：
 * - 唯一发送路径 `POST {server}/push` + JSON，key 在 body 的 `device_key`（字段名小写）；
 * - 整包 JSON ≤ MAX_REQUEST_BYTES 字节，按码点截断；
 * - UA 固定 USER_AGENT；超时 8s；超时=结果不确定，默认不自动重试；
 * - 探测 `/ping`、`/register/<key>`（key 空禁止发请求；只拼 encodeURIComponent(key)；
 *   永不带 query/body —— 裸 /register 是写接口，会覆盖设备 token）。
 * @module dsh-session-notice/bark-service
 */
import { createHash } from 'node:crypto';
import { classifyPing, classifyPush, classifyRegister } from './classify.js';
import { BODY_BUDGET_BYTES, BODY_CHARS_MAX, BODY_CHARS_MIN, DEFAULT_BODY_CHARS, DEFAULT_SERVER, MAX_REQUEST_BYTES, TIMEOUT_MS, TITLE_BUDGET_BYTES, USER_AGENT, } from './constants.js';
import { normalizeGroup } from './group.js';
import { decorateSummary, summarizeBody } from './summarize.js';
import { byteLength, truncateByBytes } from './truncate.js';
/** 供发送层消费者（event-listener 等）引用的字节常量与类型。 */
export { BODY_BUDGET_BYTES, DEFAULT_SERVER, MAX_REQUEST_BYTES, TITLE_BUDGET_BYTES };
/** 归一化服务器基址：trim、去尾斜杠、空则回退官方默认。 */
export function sanitizeServer(input) {
    const trimmed = (input ?? '').trim().replace(/\/+$/, '');
    return trimmed.length > 0 ? trimmed : DEFAULT_SERVER;
}
/**
 * 拆解 server 的 userinfo → Authorization: Basic 头。
 *
 * Node undici fetch 对含凭据的 URL 直接抛 TypeError
 * （"Request cannot be constructed from a URL that includes credentials"），
 * 因此必须先把 `https://user:pass@host/prefix` 拆成 base + Authorization 头。
 * 带凭据的 URL 不写日志（本模块从不打印 server）。
 */
export function extractBasicAuth(server) {
    const trimmed = (server ?? '').trim();
    let url = null;
    try {
        url = new URL(trimmed);
    }
    catch {
        url = null;
    }
    if (url === null)
        return { base: sanitizeServer(trimmed) };
    if (url.username !== '' || url.password !== '') {
        // 畸形百分号（user%ZZ）会让 decodeURIComponent 抛 URIError：回退原值，
        // 避免被 sendPush 的 catch 误报成网络错误。
        const safeDecode = (part) => {
            try {
                return decodeURIComponent(part);
            }
            catch {
                return part;
            }
        };
        const user = safeDecode(url.username);
        const pass = safeDecode(url.password);
        url.username = '';
        url.password = '';
        const base = url.toString().replace(/\/+$/, '');
        return {
            base,
            authHeader: `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`,
        };
    }
    return { base: sanitizeServer(trimmed) };
}
/** 折叠 id：sha1(sessionId|turn) 前 16 位 hex（≤64B ASCII）。 */
export function collapseId(sessionId, turn) {
    return createHash('sha1').update(`${sessionId}|${turn}`).digest('hex').slice(0, 16);
}
/** key 弱校验（t3 定稿：非空 + 不含 / ? # 与空白，不按 22 位强校验）。 */
export function weakKeyCheck(key) {
    const trimmed = key.trim();
    if (trimmed.length === 0)
        return 'key 不能为空';
    if (/[/?#\s]/.test(trimmed))
        return 'key 不能包含 / ? # 或空白字符';
    return undefined;
}
/**
 * 组装一条推送的完整 payload 并做双层预算：
 * - title 硬截 TITLE_BUDGET_BYTES（不追加省略号）；
 * - body 按停止类型分支：
 *   · completed（正常完成）→ **展示层摘要**（方案 C：首段 + 末段，≤ maxBodyChars
 *     码点，超出缀「（共 N 字）」）—— iOS 横幅只显示约 4 行，长文全量塞进去既看不全又笨重；
 *   · 其余（异常停止）→ **不做展示层摘要**，intent.headline（错误原因）完整保留，
 *     仅把剩余协议预算让给末尾正文；
 * - body **协议层字节闸门**：上述结果仍按码点截到 BODY_BUDGET_BYTES 内（防 413/PayloadTooLarge）；
 * - group 归一化（≤40B，空则省略字段）；
 * - 整包校验 > MAX_REQUEST_BYTES 视为插件缺陷（调用方拒绝发送）。
 * @param bodyFull - 完整正文（未摘要）。
 * @param totalChars - 原文字符数（供长度提示；仅 completed 路径使用）。
 * @param opts - 折叠 id / 会话地址 / 展示上限等。
 * @returns payload 与字节数；payload 为 null 表示整包超限。
 */
export function composePushPayload(conf, intent, bodyFull, totalChars, opts = {}) {
    const title = truncateByBytes(intent.title, TITLE_BUDGET_BYTES, '').text;
    let body;
    if (intent.kind === 'completed') {
        // 正常完成：展示层摘要（首段 + 末段），未知上限时退回默认 200 字。
        const limitChars = Math.max(BODY_CHARS_MIN, Math.min(BODY_CHARS_MAX, opts.maxBodyChars ?? conf.maxBodyChars ?? DEFAULT_BODY_CHARS));
        const summary = summarizeBody(bodyFull, limitChars);
        const summarized = decorateSummary(summary, totalChars, '会话轮次已结束');
        // 协议层字节闸门（双保险；摘要通常远小于预算）。
        body = truncateByBytes(summarized, BODY_BUDGET_BYTES, '…').text;
    }
    else {
        // 异常停止：错误原因（intent.headline）完整通知，不做展示层摘要。
        // bodyFull 由 composeBody 拼成 `${headline}\n\n${text}`（无正文时仅 headline），
        // 因此这里单独保留整条 headline，只把剩余协议预算让给末尾正文：
        //  - headline ≤ 预算：headline 完整 + 正文按剩余字节截断（错误内容 100% 保留）；
        //  - headline > 预算（极端，错误串本身超 3400B）：物理上限无解，按字节硬截到预算内，
        //    仅保留错误信息头部主体（code/status 等尾随元数据可能丢失）。
        const headline = intent.headline;
        if (byteLength(headline) > BODY_BUDGET_BYTES) {
            body = truncateByBytes(headline, BODY_BUDGET_BYTES, '…').text;
        }
        else {
            const tail = bodyFull.startsWith(headline) ? bodyFull.slice(headline.length) : '';
            body = headline + truncateByBytes(tail, BODY_BUDGET_BYTES - byteLength(headline), '…').text;
        }
    }
    const group = normalizeGroup(conf.group, conf.cwd);
    const payload = {
        device_key: conf.key,
        title,
        body,
        level: intent.level,
    };
    if (opts.sessionId !== undefined && opts.sessionId.length > 0 && opts.turn !== undefined) {
        payload.id = collapseId(opts.sessionId, opts.turn);
    }
    if (group !== undefined)
        payload.group = group;
    if (opts.sessionUrl !== undefined && opts.sessionUrl.length > 0)
        payload.url = opts.sessionUrl;
    const bytes = byteLength(JSON.stringify(payload));
    if (bytes > MAX_REQUEST_BYTES)
        return { payload: null, bytes };
    return { payload, bytes };
}
/** 构造一个带超时与固定 UA 的 AbortController。 */
function transport(fetchImpl, timeoutMs, userAgent, authHeader) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = { 'user-agent': userAgent, accept: 'application/json' };
    if (authHeader !== undefined)
        headers.authorization = authHeader;
    return { controller, timer, headers };
}
/** 把异常翻译成 network 档（超时/断连/DNS 等 → 结果不确定）。 */
export function networkVerdict(error, timeoutMs) {
    const detail = error instanceof Error ? error.message : String(error);
    if (error instanceof Error && error.name === 'AbortError') {
        return { ok: false, kind: 'network', message: `请求超时（${timeoutMs}ms）：结果不确定，不自动重试` };
    }
    return { ok: false, kind: 'network', message: `网络错误：${detail}` };
}
/**
 * 发送一条 Bark 推送（唯一真发路径）。
 * @param conf - 配置。
 * @param payload - 完整 payload（由 composePushPayload 产出）。
 * @returns 分类判定（success / auth / too-large / key-error / upstream / format / network）。
 */
export async function sendPush(conf, payload, opts = {}) {
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
    const userAgent = opts.userAgent ?? USER_AGENT;
    const { base, authHeader } = extractBasicAuth(conf.server);
    const { controller, timer, headers } = transport(fetchImpl, timeoutMs, userAgent, authHeader);
    try {
        const response = await fetchImpl(`${base}/push`, {
            method: 'POST',
            headers: { ...headers, 'content-type': 'application/json; charset=utf-8' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
        const bodyText = await response.text();
        return classifyPush(response.status, response.headers.get('content-type') ?? '', bodyText);
    }
    catch (error) {
        return networkVerdict(error, timeoutMs);
    }
    finally {
        clearTimeout(timer);
    }
}
/** GET {server}/ping 探测。 */
export async function probePing(server, opts = {}) {
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
    const userAgent = opts.userAgent ?? USER_AGENT;
    const { base, authHeader } = extractBasicAuth(server);
    const { controller, timer, headers } = transport(fetchImpl, timeoutMs, userAgent, authHeader);
    try {
        const response = await fetchImpl(`${base}/ping`, {
            method: 'GET',
            headers,
            signal: controller.signal,
        });
        const bodyText = await response.text();
        return classifyPing(response.status, response.headers.get('content-type') ?? '', bodyText);
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { ok: false, kind: 'unreachable', message: `不可达：${detail}` };
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * GET {server}/register/<key> 探测（不产生推送）。
 * 安全红线：key 为空禁止发请求；只拼 /register/${encodeURIComponent(key)}；永不带 query/body。
 */
export async function probeRegister(server, key, opts = {}) {
    const invalid = weakKeyCheck(key);
    if (invalid !== undefined) {
        return { ok: false, kind: 'empty-key', message: invalid };
    }
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
    const userAgent = opts.userAgent ?? USER_AGENT;
    const { base, authHeader } = extractBasicAuth(server);
    const { controller, timer, headers } = transport(fetchImpl, timeoutMs, userAgent, authHeader);
    try {
        const response = await fetchImpl(`${base}/register/${encodeURIComponent(key)}`, {
            method: 'GET',
            headers,
            signal: controller.signal,
        });
        const bodyText = await response.text();
        return classifyRegister(response.status, response.headers.get('content-type') ?? '', bodyText);
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { ok: false, kind: 'other', message: `注册探测失败：${detail}` };
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * 三步连通性测试（顺序定稿）：
 *   probe-endpoint(GET /ping) → send(POST /push，唯一「就绪」信号) → 仅失败时 diagnose(GET /register/<key>)。
 * 只有「发送测试推送」按钮调用此函数（保存/启动自检/CI 只跑 ping+register，绝不真发）。
 */
export async function runConnectivityTest(conf, opts = {}) {
    const steps = [];
    const ping = await probePing(conf.server, opts);
    steps.push({ step: 'ping', ok: ping.ok, kind: ping.kind, message: ping.ok ? '服务器可达（pong）' : ping.message });
    if (!ping.ok) {
        // ping 失败即短路到诊断（有意设计）：ping 都到不了（不可达/前缀错/被拦截），
        // push 必然失败且可能产生无谓请求（如 wrong-prefix 时打到错误路径计入 4xx）。
        // 注意：带 Basic Auth 的自建上 /ping 免鉴权（strings.HasPrefix 无边界），
        // 前一步绿不代表推送能成 —— 总态只能由 push 点亮。
        const register = await probeRegister(conf.server, conf.key, opts);
        steps.push({
            step: 'register',
            ok: register.ok,
            kind: register.kind,
            message: register.ok ? 'key 已注册' : register.message,
        });
        return { steps, ready: false };
    }
    const testPayload = {
        device_key: conf.key,
        title: '✅ Bark 已连通',
        body: '这是一条来自 DSH 的测试推送，请在手机上确认收到。',
        level: 'active',
    };
    const group = normalizeGroup(conf.group, conf.cwd);
    if (group !== undefined)
        testPayload.group = group;
    const push = await sendPush(conf, testPayload, opts);
    steps.push({
        step: 'push',
        ok: push.ok,
        kind: push.kind,
        message: push.ok ? '测试推送已发送，请在手机上确认' : push.message,
    });
    if (push.ok)
        return { steps, ready: true };
    // 仅失败时诊断；418 也能干净分离「凭据问题」与「密钥问题」（/register 免鉴权）。
    const register = await probeRegister(conf.server, conf.key, opts);
    const step = {
        step: 'register',
        ok: register.ok,
        kind: register.kind,
        message: register.ok ? 'key 已注册（推送失败与密钥无关）' : register.message,
    };
    steps.push(step);
    // 因果：push 500（upstream）后 register 显示 missing ⇒ 服务端已删该 key 的 device token。
    let causalHint;
    if (push.kind === 'upstream' && register.kind === 'missing') {
        causalHint = '设备 token 已被服务器移除（APNs BadDeviceToken）：请在手机上重新打开 Bark 或重置 key';
    }
    return { steps, ready: false, causalHint };
}
//# sourceMappingURL=bark-service.js.map