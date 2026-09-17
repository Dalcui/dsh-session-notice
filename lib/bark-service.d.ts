/**
 * dsh-session-notice —— Bark 发送层（Host 侧专用；传输可注入以便测试）。
 *
 * 协议定稿（t3/t4 实测）：
 * - 唯一发送路径 `POST {server}/push` + JSON，key 在 body 的 `device_key`（字段名小写）；
 * - 整包 JSON ≤ MAX_REQUEST_BYTES 字节，按码点截断；
 * - UA 固定 USER_AGENT；超时 8s；超时=结果不确定，默认不自动重试；
 * - 探测 `/ping`、`/register/<key>`（key 空禁止发请求；只拼 encodeURIComponent(key)；
 *   永不带 query/body —— 裸 /register 是写接口，会覆盖设备 token）。
 *
 * 默认传输 = `directFetch`（node:http/https + `agent: false`），**刻意不用全局
 * `globalThis.fetch`**：
 * - Node ≥ 24 在环境变量 `NODE_USE_ENV_PROXY=1` + `HTTP(S)_PROXY` 时会把全局
 *   fetch（undici）劫持到代理（实测：代理不可达时 `fetch failed`，Bark 推送全部
 *   静默失败且无任何日志）；`http.request({ agent: false })` 不读环境代理，
 *   不受其影响；
 * - 自建 Bark 服务器同样只走直连，不依赖用户的代理/网络拓扑。
 * 单测/集成仍可注入 `fetchImpl` 假件（shape 与全局 fetch 一致）。
 * @module dsh-session-notice/bark-service
 */
import { type PingVerdict, type PushVerdict, type RegisterVerdict } from './classify.js';
import { BODY_BUDGET_BYTES, DEFAULT_SERVER, MAX_REQUEST_BYTES, TITLE_BUDGET_BYTES, type BarkLevel } from './constants.js';
import type { NotificationIntent } from './intent.js';
/** 供发送层消费者（event-listener 等）引用的字节常量与类型。 */
export { BODY_BUDGET_BYTES, DEFAULT_SERVER, MAX_REQUEST_BYTES, TITLE_BUDGET_BYTES };
export type { PushVerdict };
/** Bark 配置（发送层视角）。 */
export interface BarkConfig {
    /** 服务器基址（如 https://api.day.app，或带 url-prefix/基本鉴权 userinfo 的自建地址）。 */
    server: string;
    /** 设备密钥。 */
    key: string;
    /** 设置页 group 覆盖（空串 → 按工作区 basename 自动）。 */
    group: string;
    /** 工作目录（默认 group 来源）。 */
    cwd?: string;
    /** 通知正文展示上限（码点）；缺省用 DEFAULT_BODY_CHARS。 */
    maxBodyChars?: number;
}
/** 发送层需要的 payload（全部小写字段）。 */
export interface BarkPushPayload {
    device_key: string;
    title: string;
    body: string;
    group?: string;
    level?: BarkLevel;
    sound?: string;
    url?: string;
    id?: string;
}
/** 可注入的最小 fetch 形状（Node 全局 fetch / undici / 测试假件均可满足）。 */
export interface FetchResponseLike {
    status: number;
    headers: {
        get(name: string): string | null;
    };
    text(): Promise<string>;
}
export type FetchImpl = (url: string | URL, init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
}) => Promise<FetchResponseLike>;
/**
 * 默认传输：node:http(s)/https 直连，`agent: false`。
 *
 * 为什么不用 `globalThis.fetch`（Node ≥ 24 实测）：当进程环境带
 * `NODE_USE_ENV_PROXY=1` 与 `HTTP(S)_PROXY`（如本机 launchd plist 注入
 * Clash Verge 的 127.0.0.1:7897）时，全局 fetch（undici）会被劫持到代理；
 * 代理不可达/无法完成 TLS 时返回 `fetch failed`，Bark 推送静默失败、设置页
 * 三步测试报「不可达：fetch failed」。`http.request({ agent: false })` 建立
 * 独立直连连接、不读取环境代理，行为与用户实测可用的 `curl --noproxy` 一致。
 *
 * 兼容 FetchImpl 形状：返回 { status, headers.get, text }，分类逻辑不感知传输。
 * 注意：不做 keep-alive 复用（每次新连接），推送/探测低频，开销可忽略。
 * 已知契约（与全局 fetch 的差异，均为有意设计）：
 * - 仅支持 http/https scheme（其它协议同步 reject）；
 * - GET 仅跟随**同源** 3xx（≤3 跳）；POST 不自动跟随，3xx 原样返回；
 * - 响应在正文未读完时断开会立即 reject（而非悬挂到超时）。
 * @param url - 完整请求地址（base 已由 extractBasicAuth 剔除 userinfo）。
 * @param init - 与 FetchImpl 相同的请求参数。
 */
export declare function directFetch(url: string | URL, init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
}): Promise<FetchResponseLike>;
/**
 * 选择默认传输：默认 directFetch（直连、免疫环境代理劫持）；
 * 极端环境（内网 Bark 必须走代理才可达）可用 `BARK_USE_FETCH=1` 显式回退全局 fetch。
 */
export declare function defaultFetchImpl(): FetchImpl;
/** 发送/探测的可注入选项。 */
export interface TransportOptions {
    fetchImpl?: FetchImpl;
    timeoutMs?: number;
    userAgent?: string;
    /** 会话 Web 地址（url 字段，点击跳回会话）。 */
    sessionUrl?: string;
    /** 会话 id（折叠 id 输入之一）。 */
    sessionId?: string;
    /** 轮次号（折叠 id 输入之一）。 */
    turn?: number;
    /** 通知正文展示上限（码点）；缺省用 DEFAULT_BODY_CHARS。 */
    maxBodyChars?: number;
}
/** 归一化服务器基址：trim、去尾斜杠、空则回退官方默认。 */
export declare function sanitizeServer(input: string | undefined): string;
/** 拆解后的服务器信息。 */
export interface ServerAuth {
    /** 去掉 userinfo 的基址（保留路径前缀）。 */
    base: string;
    /** 可选 Basic 鉴权头（含 'Basic ' 前缀）；无凭据时为 undefined。 */
    authHeader?: string;
}
/**
 * 拆解 server 的 userinfo → Authorization: Basic 头。
 *
 * Node undici fetch 对含凭据的 URL 直接抛 TypeError
 * （"Request cannot be constructed from a URL that includes credentials"），
 * 因此必须先把 `https://user:pass@host/prefix` 拆成 base + Authorization 头。
 * 带凭据的 URL 不写日志（本模块从不打印 server）。
 */
export declare function extractBasicAuth(server: string): ServerAuth;
/** 折叠 id：sha1(sessionId|turn) 前 16 位 hex（≤64B ASCII）。 */
export declare function collapseId(sessionId: string, turn: number): string;
/** key 弱校验（t3 定稿：非空 + 不含 / ? # 与空白，不按 22 位强校验）。 */
export declare function weakKeyCheck(key: string): string | undefined;
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
export declare function composePushPayload(conf: BarkConfig, intent: NotificationIntent, bodyFull: string, totalChars: number, opts?: TransportOptions): {
    payload: BarkPushPayload | null;
    bytes: number;
};
/** 把异常翻译成 network 档（超时/断连/DNS 等 → 结果不确定）。 */
export declare function networkVerdict(error: unknown, timeoutMs: number): PushVerdict;
/**
 * 发送一条 Bark 推送（唯一真发路径）。
 * @param conf - 配置。
 * @param payload - 完整 payload（由 composePushPayload 产出）。
 * @returns 分类判定（success / auth / too-large / key-error / upstream / format / network）。
 */
export declare function sendPush(conf: BarkConfig, payload: BarkPushPayload, opts?: TransportOptions): Promise<PushVerdict>;
/** GET {server}/ping 探测。 */
export declare function probePing(server: string, opts?: TransportOptions): Promise<PingVerdict>;
/**
 * GET {server}/register/<key> 探测（不产生推送）。
 * 安全红线：key 为空禁止发请求；只拼 /register/${encodeURIComponent(key)}；永不带 query/body。
 */
export declare function probeRegister(server: string, key: string, opts?: TransportOptions): Promise<RegisterVerdict>;
/** 连通性测试的单步结果（设置页三步状态）。 */
export interface TestStep {
    /** 步骤名。 */
    step: 'ping' | 'push' | 'register';
    ok: boolean;
    /** 判定档位（reachable / success / registered / auth / key-error …）。 */
    kind: string;
    /** 人话文案。 */
    message: string;
}
/** 连通性测试总结果。 */
export interface ConnectivityTestResult {
    steps: TestStep[];
    /** 「配置已就绪」只能由 push 成功点亮。 */
    ready: boolean;
    /** push 失败(upstream)后 register 由 200→400 的因果提示（token 已被服务端移除）。 */
    causalHint?: string;
}
/**
 * 三步连通性测试（顺序定稿）：
 *   probe-endpoint(GET /ping) → send(POST /push，唯一「就绪」信号) → 仅失败时 diagnose(GET /register/<key>)。
 * 只有「发送测试推送」按钮调用此函数（保存/启动自检/CI 只跑 ping+register，绝不真发）。
 */
export declare function runConnectivityTest(conf: BarkConfig, opts?: TransportOptions): Promise<ConnectivityTestResult>;
//# sourceMappingURL=bark-service.d.ts.map