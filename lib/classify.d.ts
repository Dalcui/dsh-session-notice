/**
 * dsh-session-notice —— Bark 响应分类（纯函数，零依赖，可直接单测）。
 *
 * 分类顺序与档位来自调研 t3/t4 定稿（bark-server v2.3.5 源码 + 对官方端点的
 * 实测）。要点：
 * - 413（nginx HTML）与 418（纯文本 I'm a teapot）不是 JSON，必须先按
 *   status + content-type 分流再 JSON.parse；
 * - 批量 device_keys 外层恒 200、真结果在 data[]（本插件只用单发，仍保留判定）；
 * - 403/429 在 bark-server 源码中不存在，出现即运维层，不归为密钥错误；
 * - message 含 `device token` 是密钥错误（熔断不重试：服务端遇 APNs 410/
 *   BadDeviceToken 会删 token，此后该 key 永远 400）。
 * @module dsh-session-notice/classify
 */
/** Bark 统一信封（单发）。 */
export interface BarkEnvelope {
    code?: number;
    message?: string;
    data?: unknown;
}
/** 推送结果判定。 */
export type PushVerdict = {
    ok: true;
    kind: 'success';
} | {
    ok: false;
    kind: 'network';
    message: string;
} | {
    ok: false;
    kind: 'auth';
    message: string;
} | {
    ok: false;
    kind: 'too-large';
    message: string;
} | {
    ok: false;
    kind: 'not-json';
    message: string;
} | {
    ok: false;
    kind: 'key-error';
    message: string;
} | {
    ok: false;
    kind: 'upstream';
    message: string;
} | {
    ok: false;
    kind: 'format';
    message: string;
};
/** ping 探测判定：reachable / wrong-prefix / intercepted / unreachable。 */
export type PingVerdict = {
    ok: true;
    kind: 'reachable';
} | {
    ok: false;
    kind: 'wrong-prefix';
    message: string;
} | {
    ok: false;
    kind: 'intercepted';
    message: string;
} | {
    ok: false;
    kind: 'unreachable';
    message: string;
};
/** register 探测判定：registered / missing / empty-key / other。 */
export type RegisterVerdict = {
    ok: true;
    kind: 'registered';
} | {
    ok: false;
    kind: 'missing';
    message: string;
} | {
    ok: false;
    kind: 'empty-key';
    message: string;
} | {
    ok: false;
    kind: 'other';
    message: string;
};
/** 判定响应体是否可当作 JSON 解析（status 413/418 一定不是；按 content-type 兜底）。 */
export declare function isJsonBody(status: number, contentType: string): boolean;
/** 解析 JSON 信封；失败返回 null。 */
export declare function parseEnvelope(text: string): BarkEnvelope | null;
/** 信封 message 是否表明密钥错误（/push 前缀 `failed to get device token: …`）。 */
export declare function isKeyErrorMessage(message: string | undefined): boolean;
/**
 * 分类一次 POST /push 的响应。
 * @param status - HTTP status。
 * @param contentType - Content-Type 头（可能为空）。
 * @param bodyText - 响应正文。
 */
export declare function classifyPush(status: number, contentType: string, bodyText: string): PushVerdict;
/**
 * 分类一次 GET /ping 的响应（三档，别都叫「不可达」）。
 * 契约：成功 `{"code":200,"message":"pong","timestamp":<秒>}`；
 * 404 JSON 信封 ⇒ 打到了 bark-server 但缺 url-prefix；非 JSON ⇒ 被拦截。
 */
export declare function classifyPing(status: number, contentType: string, bodyText: string): PingVerdict;
/**
 * 分类一次 GET /register/<key> 的响应。
 * 契约：存在 `{"code":200,"message":"success"}`；
 * 不存在 `{"code":400,"message":"failed to get [<key>] device token from database"}`；
 * 空 key `{"code":400,"message":"device key is empty"}`。
 * ⚠ 与 /push 的失败 message 前缀差一层，不能共用正则（本模块按「含 device token」判定即可）。
 */
export declare function classifyRegister(status: number, contentType: string, bodyText: string): RegisterVerdict;
//# sourceMappingURL=classify.d.ts.map