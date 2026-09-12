/**
 * dsh-session-notice —— 正文摘要（方案 C：首段 + 末段）。
 *
 * 为什么需要：iOS 通知横幅只显示约 4 行（调研确认 App 侧 body 用
 * `.lineLimit(4)` + `.truncationMode(.tail)`），把 1000+ 字全量塞进通知既看不全、
 * 又让通知变笨重。而 `BODY_BUDGET_BYTES = 3400` 是**协议安全上限**（防 413 /
 * APNs PayloadTooLarge），不是展示上限。所以展示层单独收敛到 maxBodyChars。
 *
 * 策略：按空行分段 → 优选「首段 + 末段」（结论通常在首尾）→ 总长 ≤ limit；
 * 代码块（``` 围栏）与超长单段有保护，避免摘要被一整块代码吃掉。
 * 全部按**码点**处理，绝不劈开 emoji 代理对 / ZWJ 序列。
 * @module dsh-session-notice/summarize
 */
/** 按码点数截断（摘要层用字符数，最终字节闸门仍由发送层按 UTF-8 字节兜底）。 */
function sliceChars(text, limit) {
    if (limit <= 0)
        return '';
    const cps = [...text];
    return cps.length <= limit ? text : cps.slice(0, limit).join('');
}
/** 码点长度。 */
export function charLength(text) {
    return [...text].length;
}
/** 一段是否为代码围栏块（``` 开头）。 */
function isFenced(block) {
    return /^```/.test(block.trimStart());
}
/**
 * 把正文切成段落（按空行优先，退化按单换行）。
 * @param text - 原始正文。
 */
export function splitParagraphs(text) {
    const byBlank = text
        .split(/\n\s*\n+/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    if (byBlank.length > 1)
        return byBlank;
    // 无空行：按单换行切，便于「首行 + 末行」取信息。
    const byLine = text
        .split(/\n+/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    return byLine.length > 0 ? byLine : [text.trim()];
}
/** 从候选段里挑「最适合代表全文」的段：跳过代码块，优先第一个非代码段。 */
function pickRepresentative(blocks) {
    if (blocks.length === 0)
        return undefined;
    const nonFenced = blocks.filter((block) => !isFenced(block));
    const pool = nonFenced.length > 0 ? nonFenced : blocks;
    // 结论通常在第一段：优先首个独立成段者（长度足以承载信息），
    // 只有首段是代码块时才顺延到后面的非代码段。
    const first = pool[0];
    if (first !== undefined && !isFenced(first))
        return first;
    return pool.find((block) => !isFenced(block)) ?? pool[0];
}
/**
 * 生成通知正文摘要（方案 C：首段 + 末段）。
 * @param text - 完整正文。
 * @param limitChars - 摘要上限（码点数），默认由调用方给 BODY_DISPLAY_CHARS。
 * @returns 摘要文本与是否截断。
 */
export function summarizeBody(text, limitChars) {
    const trimmed = text.trim();
    if (trimmed.length === 0)
        return { text: '', truncated: false };
    if (charLength(trimmed) <= limitChars)
        return { text: trimmed, truncated: false };
    const blocks = splitParagraphs(trimmed);
    const first = pickRepresentative(blocks) ?? blocks[0] ?? trimmed;
    const last = blocks.length > 1 ? blocks[blocks.length - 1] : undefined;
    const SEPARATOR = '\n…\n';
    const separatorChars = charLength(SEPARATOR);
    // 只有一段（或首末同段）：直接截断并保留尾部提示位。
    if (last === undefined || last === first) {
        return { text: sliceChars(first, limitChars), truncated: true };
    }
    const budget = limitChars - separatorChars;
    if (budget <= 0)
        return { text: sliceChars(first, limitChars), truncated: true };
    // 首末各占一半；一方较短时把余量让给另一方。
    let headLimit = Math.floor(budget / 2);
    let tailLimit = budget - headLimit;
    const firstLen = charLength(first);
    const lastLen = charLength(last);
    if (firstLen < headLimit) {
        tailLimit += headLimit - firstLen;
        headLimit = firstLen;
    }
    else if (lastLen < tailLimit) {
        headLimit += tailLimit - lastLen;
        tailLimit = lastLen;
    }
    const head = sliceChars(first, headLimit);
    const tail = sliceChars(last, tailLimit);
    const combined = `${head}${SEPARATOR}${tail}`;
    // 双保险：合计不超过 limit（sliceChars 已按码点，故不会劈字符）。
    return { text: charLength(combined) <= limitChars ? combined : sliceChars(combined, limitChars), truncated: true };
}
/**
 * 组装最终 body：摘要 + 长度提示。
 * @param summary - summarizeBody 的结果。
 * @param totalChars - 原文字符数（供提示展示）。
 * @param unknownText - 无正文时的兜底文案（如「会话轮次已结束」）。
 */
export function decorateSummary(summary, totalChars, unknownText) {
    if (summary.text.length === 0)
        return unknownText;
    return summary.truncated ? `${summary.text}\n（共 ${totalChars} 字）` : summary.text;
}
//# sourceMappingURL=summarize.js.map