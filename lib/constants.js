/**
 * dsh-session-notice —— 定稿常量（调研 t3/t4 实测结论，勿随意改动）。
 *
 * 依据：官方 api.day.app nginx 请求体硬限 8192 字节（实测 8155 过 / 8235 → 413 HTML）；
 * APNs payload 4096 字节（bark-server 声明 PayloadMaximum 但不校验，超限 → HTTP 500
 * push failed: PayloadTooLarge）；APNs payload 骨架按最差 410 字节计
 * （device_key 22B + group 中文 11 字 58B + 各键名/嵌套）。
 * @module dsh-session-notice/constants
 */
/** 整包 JSON 请求体上限（字节）。同时满足 nginx 8192B 与 APNs 4096B 并留余量。 */
export const MAX_REQUEST_BYTES = 3900;
/** body 预算（字节）：MAX_REQUEST_BYTES − 骨架 410 − title 80 − 省略号 3 ≈ 3400。 */
export const BODY_BUDGET_BYTES = 3400;
/**
 * 通知正文的展示上限（码点数），默认 200。
 *
 * 注意与 BODY_BUDGET_BYTES 的区别：3400 字节是**协议安全上限**（防 nginx 413 /
 * APNs PayloadTooLarge），而 iOS 横幅只显示约 4 行（≈80–120 中文字），
 * 因此展示层单独收敛到本值（可在设置页调整）。超过时按「首段 + 末段」摘要。
 */
export const DEFAULT_BODY_CHARS = 200;
/** 正文展示上限的可配置范围（码点数）。 */
export const BODY_CHARS_MIN = 40;
export const BODY_CHARS_MAX = 1000;
/** title 预算（字节）：不做上限校验、不追加省略号，超出由 iOS lineLimit(1) 截尾。 */
export const TITLE_BUDGET_BYTES = 80;
/** group 预算（字节）：超出回退 `<basename> · <sha1 前 6>`。 */
export const GROUP_BUDGET_BYTES = 40;
/** 折叠 id = sha1(sessionId|turn) 前 16 位 hex（≤64B ASCII，apns-collapse-id 头）。 */
export const COLLAPSE_ID_HEX_LEN = 16;
/** 固定 UA（官方 BAN 规则：>5 次错误且 UA 恰为 Mozilla/5.0 (X11; Linux x86_64) 即封 24h）。 */
export const USER_AGENT = 'dsh-bark-notify/0.1.0';
/** 客户端超时（服务端 read/write timeout 默认 3s < APNs 往返；超时=结果不确定、不重试）。 */
export const TIMEOUT_MS = 8000;
/** Bark 官方服务器默认值。 */
export const DEFAULT_SERVER = 'https://api.day.app';
/** level 全集（服务端零校验，未知值静默降级 active —— 插件内部必须枚举化）。 */
export const BARK_LEVELS = ['passive', 'active', 'timeSensitive', 'critical'];
/** 静音唯一写法（无 sound=none/silent 语义）。 */
export const SOUND_SILENCE = 'silence';
//# sourceMappingURL=constants.js.map