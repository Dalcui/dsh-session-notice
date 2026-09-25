/**
 * dsh-session-notice —— Host 半入口。
 *
 * 挂载三块：
 *   1. 插件 Config（settings-store 的 volatile schema）—— dsh-settings 0.1.7
 *      契约：Loader 把 schema 挂进 profile patch，ctx.settings.describe()/update()
 *      读写，值持久化到 patch、live 生效、重启后保持；entry id = 'bark-notify'；
 *   2. session/event 监听：turn/end 六种 reason → 检查该会话开关 → 组装并推送 Bark
 *      （Host 侧发送：bark-server 无 CORS，浏览器直连自建必失败）；
 *   3. /plugins/dsh-session-notice loopback RPC：设置页与会话按钮经此读写（密钥永不过线）。
 *
 * 0.1.5→0.1.7 适配要点（本机 0.1.7-rc.2 源码验证）：
 * - ctx.settings.register(ns, schema, { base, applies }) 已移除；改为导出
 *   Config（含 volatile 字段）+ ctx.settings.describe()/update(ns, patch)；
 * - volatile 字段的值经 cosmokit Volatile<T> 包装，读取需解包；
 * - webServer 仍用 ctx.inject(['webServer'], cb) 回调里注册（见 rpc.ts），
 *   不放进静态 inject。
 *
 * 浏览器半（./client 入口，esbuild 产物 lib/client.js）注册插件配置页与会话切换按钮。
 * @module dsh-session-notice
 */
import { isVolatile } from '@deepseek-ai/cosmokit';
import { sendPush } from './bark-service.js';
import { createTurnEndHandler } from './event-listener.js';
import { registerBarkRpc } from './rpc.js';
import { barkSettingsSchema, DEFAULT_SETTINGS, SETTINGS_NAMESPACE } from './settings-store.js';
/** 稳定 cordis 插件名（与 cordis.patch.yml 的 insert id 一致）。 */
export const name = 'bark-notify';
/**
 * 插件 Config（dsh-settings 0.1.7 契约）：全字段 volatile —— live 可编辑、
 * 写入 profile patch、重启后保持。Loader 读取本导出生成设置表单与读写通道。
 */
export const Config = barkSettingsSchema;
/**
 * 硬依赖：仅 settings（描述/更新 profile patch 中的本插件配置）。
 *
 * webServer 不放进静态 inject：真机验证过 connection.rpc.handle 会以调用者
 * fiber 访问 ctx.webServer 而抛 "without inject" 并导致 profile 崩溃循环，
 * 因此本插件改为自建 HTTP 路由，并在 ctx.inject(['webServer'], cb) 回调里注册
 * （见 rpc.ts）。settings 缺失的 profile（如 headless）本插件不激活。
 */
export const inject = ['settings'];
/** 解开 cosmokit 对 volatile 字段的 Volatile<T> 包装（无包装则原值返回）。 */
function unwrapVolatile(value) {
    if (isVolatile(value))
        return unwrapVolatile(value.get());
    return value;
}
/**
 * 插件入口。
 * @param ctx - 插件上下文。
 * @param config - 组合层覆盖（entry config，含 schema 默认值；volatile 字段为
 *   Volatile 包装，读取前解包）。
 */
export function apply(ctx, config = {}) {
    // 启动兜底：apply 时 Loader/entry 可能尚未进入 ACTIVE，describe 拿不到条目时用
    // 组合层解析值（解包后）；此后每次读写都以 describe 的最新值为准。
    let fallback = {
        ...DEFAULT_SETTINGS,
        ...Object.fromEntries(Object.entries(config)
            .filter(([key]) => key in DEFAULT_SETTINGS)
            .map(([key, value]) => [key, unwrapVolatile(value)])),
    };
    // describe 结果短 TTL 缓存（describe 会对整表做 schema.toJSON/stringify，热路径避免重复扫描）。
    let settingsCache = null;
    /** describe 条目短暂不可见的 TTL（ms）。 */
    const SETTINGS_CACHE_TTL = 300;
    let warnedMissingDescribe = false;
    /** 读取当前设置（Host 侧完整值，含 key；describe 就绪前用启动兜底）。 */
    const current = () => {
        if (settingsCache !== null && Date.now() - settingsCache.at < SETTINGS_CACHE_TTL)
            return settingsCache.value;
        let value;
        try {
            const descriptor = ctx.settings.describe().find((row) => row.ns === SETTINGS_NAMESPACE);
            value = descriptor !== undefined ? descriptor.value : undefined;
        }
        catch {
            // configEditor / Loader 未就绪（apply 早期）：回退启动兜底，绝不向上抛。
            value = undefined;
        }
        if (value !== undefined) {
            settingsCache = { at: Date.now(), value };
            return value;
        }
        // 激活后条目仍不可见时至少告警一次，避免用户以为配置生效了。
        if (!warnedMissingDescribe) {
            warnedMissingDescribe = true;
            ctx.logger.warn('[bark-notify] settings.describe 未返回条目 ' + SETTINGS_NAMESPACE + '，暂用启动配置兜底');
        }
        return fallback;
    };
    /** 写入后失效设置缓存（update 内部已同步完成 profile patch 持久化）。 */
    const invalidateSettingsCache = () => {
        settingsCache = null;
    };
    /** merge 写入 profile patch（dsh-settings 0.1.7；不整段 replace，防清空密钥）。 */
    const persist = async (patch) => {
        await ctx.settings.update(SETTINGS_NAMESPACE, patch);
    };
    /** 当前工作区 cwd（进程 cwd）——测试推送没有会话上下文，用它作为默认 group 来源。 */
    const workspaceCwd = () => {
        const cwd = process.cwd();
        return cwd.length > 0 ? cwd : undefined;
    };
    /** 未配置 key 时返回 null（静默跳过）。 */
    const toConfig = (settings, cwd) => {
        if (settings.key.trim().length === 0)
            return null;
        return {
            server: settings.server,
            key: settings.key,
            group: settings.group,
            cwd,
            maxBodyChars: settings.maxBodyChars,
        };
    };
    // toggle 是「读改写整数组」，进程内用 promise 链串行化，避免并发 toggle 后写覆盖先写。
    let toggleChain = Promise.resolve();
    registerBarkRpc(ctx, {
        getSettings: current,
        updateSettings: async (patch) => {
            await persist(patch);
            invalidateSettingsCache();
        },
        workspaceCwd,
        toggleSession: (sessionId) => {
            const run = toggleChain.then(async () => {
                const settings = current();
                const has = settings.enabledSessions.includes(sessionId);
                const next = has
                    ? settings.enabledSessions.filter((id) => id !== sessionId)
                    : [...settings.enabledSessions, sessionId];
                await persist({ enabledSessions: next });
                invalidateSettingsCache();
                return { enabled: !has, enabledSessions: next };
            });
            toggleChain = run.then(() => undefined, () => undefined);
            return run;
        },
    });
    const handler = createTurnEndHandler({
        isEnabled: (sessionId) => current().enabledSessions.includes(sessionId),
        getConfig: (session) => toConfig(current(), session.header?.cwd),
        deliver: (payload) => {
            const settings = current();
            return sendPush({
                server: settings.server,
                key: settings.key,
                group: settings.group,
                maxBodyChars: settings.maxBodyChars,
            }, payload);
        },
        logger: ctx.logger,
    });
    ctx.on('session/event', handler);
}
//# sourceMappingURL=index.js.map