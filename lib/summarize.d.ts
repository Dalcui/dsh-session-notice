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
/** 摘要结果。 */
export interface Summary {
    /** 摘要正文（≤ limitChars 个码点）。 */
    text: string;
    /** 是否发生了摘要/截断。 */
    truncated: boolean;
}
/** 码点长度。 */
export declare function charLength(text: string): number;
/**
 * 把正文切成段落（按空行优先，退化按单换行）。
 * @param text - 原始正文。
 */
export declare function splitParagraphs(text: string): string[];
/**
 * 生成通知正文摘要（方案 C：首段 + 末段）。
 * @param text - 完整正文。
 * @param limitChars - 摘要上限（码点数），默认由调用方给 BODY_DISPLAY_CHARS。
 * @returns 摘要文本与是否截断。
 */
export declare function summarizeBody(text: string, limitChars: number): Summary;
/**
 * 组装最终 body：摘要 + 长度提示。
 * @param summary - summarizeBody 的结果。
 * @param totalChars - 原文字符数（供提示展示）。
 * @param unknownText - 无正文时的兜底文案（如「会话轮次已结束」）。
 */
export declare function decorateSummary(summary: Summary, totalChars: number, unknownText: string): string;
//# sourceMappingURL=summarize.d.ts.map