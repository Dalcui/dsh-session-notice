# dsh-session-notice

DSH（DeepSeek Harness）会话 Bark 通知插件：在会话界面点一个按钮切换「会通知」状态，该会话轮次停止时自动经 [Bark](https://bark.day.app) 推送到手机。

- **正常结束** → 推送最后一条文本消息（长文按「首段 + 末段」摘要）
- **异常停止**（出错 / 被阻塞 / Token 上限 / 崩溃遗留 / 钩子中止）→ 推送**完整错误内容**（不按正文那样摘要截取）与必要信息
- **你主动点「停止」不通知**（aborted 且 cause 为 user/parent/disposed 等中止链，含主会话停止时级联到 subagent 的 parent 中止）
- **需要你介入时也通知**（独立开关，默认开，**不受会话级开关限制**）：等待工具/沙箱审批、模型 `ask_user_question` 提问、以及 timed 提问超时后仍待回答；第三种会把误导性的「✅ 完成」改写为「⏳ 等待回答」
- 开关**按会话独立**、持久化（服务重启后保持），随时可切换
- 插件管理页本插件详情页配置 Bark `server` / `key`，并提供 ping → push → register 三步连通测试（dsh ≥ 0.1.7；0.1.5 为「设置 → 插件配置区」卡片）

## 安装

> **版本要求**：适配 dsh **0.1.5 – 0.2.2-rc.1**（本机 0.2.2-rc.1 实测通过）。
>
> - dsh **0.2.0** 起（本仓库 0.2.1 起）：插件需在 `peerDependencies` 声明兼容的 dsh 运行时版本，否则启动时被跳过加载（`Plugin ... is incompatible with dsh ...`）。本仓库已声明 `^0.1.5-rc.1 || ^0.1.7-rc.1 || ^0.2.0-rc.1 || ^0.2.2-rc.1`；门禁比较用 `includePrerelease`，故 `^0.2.0-rc.1` 在运行时侧已覆盖整个 0.2.x，追加 `^0.2.2-rc.1` 分支是为了让 `npm install` 把类型包解析到 0.2.2（默认 semver 解析不放行其他 tuple 的预发布版）。dsh 0.2.0 **运行时**取消 cause 收敛为 `user/parent/disposed/hook`；**持久化**联合类型仍保留 `legacy`（无 cause 的 0.1.x 旧记录），本插件照常识别并归入「用户主动停止不通知」静默链。
> - dsh **0.1.7**（0.1.7-rc.2 起可用）：dsh-settings 重构（`settings.register` 移除，改为插件 `Config` 导出 + volatile 字段 + `ctx.settings.describe/update`；客户端设置入口从 `settings.plugin.item` 迁移到 `plugins.bundle.config`）。
> - dsh **0.1.5** 及以下旧版请用本仓库 0.1.5 时代的历史提交。

```bash
# 推荐：link 安装（符号链接，改动源码后无需重装）
dsh plugin --profile web add link:/path/to/dsh-session-notice

# 或从 GitHub 安装
dsh plugin --profile web add github:Dalcui/dsh-session-notice
```

安装后若插件行未自动生效，重启 web profile：`launchctl kickstart -k gui/$(id -u)/io.deepseek.dsh-web`

> **注意**：请使用 `link:` 或 `github:` 协议。`file:` 协议在 pnpm 下是「安装时刻快照」，**新增源文件不会同步**到 `.pnpm` store，会导致 `ERR_MODULE_NOT_FOUND` 并使整个 profile 加载失败。

## 使用

1. **配置密钥**：插件管理 → 已安装 → 查看 dsh-session-notice → 展开设置，填写 Bark 服务器（默认官方 `https://api.day.app`）与设备密钥（Bark App 内查看）。密钥只存 Host 侧，界面仅显示末 4 位，不落浏览器、不进日志。
2. **测试连通**：点「测试推送」，三步独立状态：①服务器可达（`GET /ping`）②测试推送送达（`POST /push`，唯一「就绪」信号）③仅在失败时诊断 key 是否已注册（`GET /register/<key>`，不产生推送）。
3. **开启通知**：回到会话，点头部的铃铛按钮（单色图标，跟随主题，无文字）。鼠标悬浮显示操作说明，点击切换后短暂显示结果反馈；开启后该会话每次轮次停止都会推送。

## 设置项

| 字段 | 默认 | 说明 |
|---|---|---|
| Bark 服务器 | `https://api.day.app` | 官方或自建；可带路径前缀；Basic Auth 用 `user:pass@host` 形式 |
| 设备密钥 | 空 | Bark App 内查看；`role('secret')`，只回显末 4 位 |
| 分组（group） | 空 = 按工作区 | 手机通知按项目聚合、支持按分组静音 |
| 正文摘要字数 | 200 | 通知只显示约 4 行，超出按「首段 + 末段」摘要并标注总字数；范围 40–1000 |
| 人工介入提醒 | 开 | 等待工具/沙箱审批、模型 `ask_user_question` 提问、提问超时后仍待回答时也推送；**独立于**会话头部的「会通知」开关（需要你介入时通常已离开屏幕，这类提醒对所有会话生效） |

## 实现要点

- **回合结束监听**：Host 侧 `ctx.on('session/event')` 按 `event.type === 'turn/end'` 分派，完整区分六种停止原因（`agent/turn-stopping` 只自然收尾触发、会漏异常路径，故不采用）。**主会话等待 subagent 返回时不会误通知**——subagent 调用是未完成的工具调用，回合不结束即不写 `turn/end`；只有真正收尾才推一条汇总。
- **用户主动停止不通知**：`aborted` 且 cause 属 user/parent/disposed（含 cause 缺失的历史事件）保持沉默——停止是用户自己按的，通知只会打扰；主会话被停时其 subagent 收到的是 parent 级联中止，同样静默（防一次点击多条轰炸）。`hook`（自动化策略终止，附 reason 文案）保留推送。
- **人工介入提醒（与回合结束通知互补的三条通道）**——有些需要人介入的时刻回合并没有结束，`turn/end` 永远不会发出，必须另找监听面：
  - **等待审批**：监听 `session/event` 的 `approval/asked`（log-only audit 事件；`dsh-user-approval` 在请求发出时先 append、随后才 `await decide()` 阻塞等批准，且**无等待超时**）。按会话日志里最后一次 `approval/policy` 判定策略：`never` 会话里审批会被自动拒绝、无人等待，不推（避免「假批准」误导）。
  - **等待回答**：监听 cordis waterfall `user-questions/request`（每次 `ask_user_question` 必经；legacy 阻塞式与 timed 首次发问都走它）。**只旁观、绝不认领**——无论发生什么都 `next()` 交还决策，自身异常一律吞掉，不干扰真正的答案器。
  - **提问超时兜底**：timed 模式超时会以 `{pending:true}` 正常工具结果收尾、回合照常结束并写 `turn/end completed`（原本会推误导性的「✅ 完成」）。两处协同：① `turn/end` 时倒序折叠会话事件检测未答问题，把意图改写为「⏳ 等待回答」；② 订阅 `sessionProjections` 的 `userQuestions` 投影，`state === 'continued'` 且**回合已结束**时兜底提醒（覆盖崩溃恢复后 repair 合成的 unknown-outcome 结果）。两者共用同一 `session:callId` 账本，同一问题只提醒一次。
  - 三条通道的推送**不受** `enabledSessions` 限制，由独立设置 `interventionNotify`（默认开）统一控制；key 未配置时静默。
- **正文双层预算**：
  - *展示层* —— 仅**正常完成**时对正文做默认 200 字摘要（方案 C：首段 + 末段，跳过代码块，按码点不劈 emoji），超出缀「（共 N 字）」。因为 iOS 横幅约 4 行（≈80–120 中文字），全量塞入既看不全又笨重。**异常停止**不做展示层摘要，错误内容完整保留（仅协议层字节闸门兜底）。
  - *协议层* —— 整包 JSON ≤ **3900 字节**（同时满足 nginx 8192B 与 APNs 4096B），`truncateByBytes` 按码点兜底。
- **折叠 id**：`id = sha1(sessionId|turn)` 前 16 位 hex（≤64B ASCII，服务端当 `apns-collapse-id`）；UA 固定 `dsh-bark-notify/<ver>`；超时 8s 且**默认不自动重试**（服务端 3s timeout < APNs 往返，超时=结果不确定）。
- **失败分类**：网络 / 鉴权（418 纯文本，不按 401 判）/ 体积（413 HTML）/ 密钥错误（`device token`，熔断不重试）/ 上游 5xx / 格式错；403/429 属运维层，不归密钥错。
- **`/register` 安全红线**：只允许 `GET {server}/register/<key>`，key 为空禁止发请求、永不带 query/body（裸 `/register` 是写接口，会覆盖设备 token）。
- **直连传输（绕开环境代理劫持）**：发送/探测默认走 `directFetch`（`node:http/https` + `agent:false`，不读取 `HTTP(S)_PROXY` / `NODE_USE_ENV_PROXY`）。原因：Node ≥ 24 在进程环境携带 `NODE_USE_ENV_PROXY=1` 与代理变量（如 launchd plist 注入 Clash Verge 的 `127.0.0.1:7897`）时，全局 `fetch` 会被劫持到代理，代理不可达时推送全部 `fetch failed`、无任何日志。若自建 Bark 服务器必须在代理网络内才可达（罕见），可用环境变量 `BARK_USE_FETCH=1` 显式回退全局 fetch。
- **HTTP 路由而非 connection.rpc**：`ctx.connection.rpc.handle` 在本机 0.1.5-rc.1 上会用调用者 fiber 访问 `ctx.webServer` 而抛 `cannot get property "webServer" without inject`，导致整个 profile 崩溃循环。因此改用与 `dsh-codebuddy-cli` 相同的写法：`ctx.inject(['webServer'], webCtx => webCtx.webServer.register({ kind: 'exact', path: '/plugins/dsh-session-notice/*' }))`，客户端直接 `fetch`。4 个路由逐个 try/catch（dsh 0.1.7 起对重复路由注册直接 throw，防止极端 HMR 时序下全部路由丢失）。
- **卡片样式**：`dsh-client-ui-settings-plugins` 不导出 `PluginCard`（跨插件值导入被纯度门禁禁止），故自写 CSS 复刻原生观感（`--dsw-alias-*` 主题变量、12px 圆角、34px 输入框、15/13 字号）。
- **group 归一化**：trim + 去控制字符 + ≤40 字节；归一后为空则**省略字段**（`group:""` 会形成空名分组），超限回退 `<basename> · <sha1(cwd) 前 6>`。

## 0.2.2 适配

dsh 0.2.2-rc.1（本机实测，2026-11-08）。**结论：0.2.1/0.2.2 没有改动本插件 Host 侧用到的任何接缝，Host 逻辑零改动**；本版 = 验证性适配（依赖范围 + 文档 + 构建脚本修复）+ **client 侧三项修正**（下方第三条，属宿主侧缺陷与死声明，非 0.2.2 行为回归）。

- **逐点复核（均与 0.2.0 一致）**：
  - `ctx.settings.describe()` 不传 `redactSecrets` 时 `value` 仍是 Host 侧完整值（脱敏只在带参时发生）；`update(ns, patch)` 省略 `expectedRevision` 仍是无 CAS 的 merge 写入 profile patch，不抛 `SETTINGS_CONFLICT`；`ns` 仍是 profile entry id（`bark-notify`）。
  - `webServer.register({ kind:'exact', path, handler })` 仍返回 disposer，重复 `(kind, path)` 仍抛错；匹配顺序 exact → 最长 prefix → fallback，本插件的 exact 路由不会被内置 `/plugins` 相关路由抢先。
  - `session/event(session, event)`、`turn/end` 的 reason 全集（`completed/aborted/blocked/error/max-tokens/interrupted/forked`）与取消 cause（`user/parent/hook/disposed` + 持久化侧 `legacy`）未变，`assistant/message` 的 text block 形状未变。
  - `Session.snapshotEvents()` 在 0.2.2 被标注 `@deprecated`（平台内部在收敛「同步读事件」写法），**运行时仍在且行为不变**；本插件只在 `turn/end` 后一次性倒序取末条助手文本，代价可控，且 0.2.2 生态里的活跃插件（dsh-notifier 0.2.11、dsh-better-sidebar 0.30.1）同样仍在用它，故保持不改。
  - 客户端两个入口未变：`plugins.bundle.config`（keyed，key = npm 包名）与 `conversation.session.header.utilities`（list，standardProps 自带 `sessionId`）；`window.__ModuleLoader__.load({id, factory})` 懒 CJS 仍由 dsh-client-modules 支持。
  - `dsh.client` 新增 `external` 字段（模块表的**精确**请求，即产物里真实 `require` 的包名；`package-manifest` 的注释把 `inject` 称信息性，但 `dsh-client-modules` 的 `arriveGraphRow` 实际会按 `inject` 里已存在的 graph 行先行到达 —— 所以 `inject` 是「到达顺序声明」，命中才生效、未命中静默跳过）。本产物实际只 `require('react')` 与 `require('react/jsx-runtime')`，两者都是 0.2.2 的 seed word，**无需新增 `external` 声明**。
  - 兼容性门禁 `evaluatePluginCompatibility` 只看 `engines.dsh`（若有）或 `@deepseek-ai/dsh*` peer，比较带 `includePrerelease` —— 故 `^0.2.0-rc.1` 已覆盖 0.2.2-rc.1；本次追加 `^0.2.2-rc.1` 分支只为让 `npm install` 把类型包解析到 0.2.2（npm 默认解析不放行别的 tuple 的预发布版）。
- **依赖范围**：`@deepseek-ai/cosmokit` 放宽为 `~1.8.5 || ~1.9.0`（0.2.2 运行时携带 1.9.0；本插件只用 `isVolatile`，契约未变）。cordis `^4.0.2` / schemastery `^3.18.2` 天然覆盖运行时的 4.1.0 / 3.19.0，无需改动。
- **构建脚本修复**：`build.mjs` 不再经 `npx.cmd` 跑 tsc —— Node ≥ 24 在 Windows 上 `spawnSync('.cmd')` 直接 `EINVAL`（要求 shell），`npm run build` 因此整条断掉；改为解析本地 `typescript/bin/tsc` 后交给当前 node 执行，跨平台一致。
- **client 侧三项修正（源码审计 + 运行时证据）**：
  - **主题变量真 bug（与版本无关）**：`--dsw-alias-label-error` 在 0.2.2 主题里**不存在**（`dsh-client-ui-theme/lib/client.js` 的 216 条 alias 定义全文 0 命中），而卡片里两处失败文案（`.dsn-msgFailed` / `.dsn-testFailed`）一直在用它 —— 实际效果是继承常规色、不是红色。改为已存在的 `--dsw-alias-state-error-primary`（light/dark 各定义，指向 `static-red-600/400`）。
  - **`dsh.client.inject` 死引用**：`@deepseek-ai/dsh-client-ui-slots` 在 0.2.2 已不是 boot graph 的运行时行（它变成 shell 的 seed word，`slots` 服务的提供方是 `@deepseek-ai/dsh-client-ui-renderer`；实测 `window.__DSH_BOOT__.entries` 74 行里有 ui-renderer / client-connection / client-modules，**没有** ui-slots）。未知名在 `arriveGraphRow` 里被静默跳过，所以此前只是白写；改为 `["@deepseek-ai/dsh-client-ui-renderer"]`，让「提供 slots 服务的 bundle 先到位」这条顺序声明真正生效。 `@deepseek-ai/dsh-client-connection` 我们从不在产物里 require（`lib/client.js` 只 require `react` 与 `react/jsx-runtime`，两者都是 0.2.2 的 seed word），一并删掉这层多余耦合。
  - **卡片根元素**：宿主 0.2.2 把本槽渲染进 `section[data-plugin-config]`、外面**没有** `ul`，故根由 `<li>` 改为 `<div>`（语义修正，浏览器原本容错），并去掉随之无意义的 `list-style: none`。
- **保持不动的一处（有意识的取舍）**：RPC 仍用 `/plugins/dsh-session-notice/*`。0.2.2 里 `/plugins` 是 dsh-client-modules 的 `PLUGIN_ROUTE`（**prefix** 路由，服务 `plugins/??<pkg>/client.js&rev=…`），与本插件 4 条 **exact** 路由同前缀共存；`dsh-host-webserver` 的匹配顺序是 exact → 最长 prefix → fallback，实测互不抢占。迁到自有顶层命名空间（如 profile 里 `dsh-service-status` 的做法）只在**上游把 `/plugins/dsh-session-notice/test` 这类路径也注册成同名 exact** 时才需要（改子路径前缀不影响 —— exact 恒胜 prefix），本轮先不动，避免引入未经真机回归的行为变更 —— 边界条件已写进 `src/rpc.ts` 与 `src/client/index.tsx` 的 `ROUTE_PREFIX` 注释。
- **信任链水位（0.2.2 复核后写清，免得误读）**：本插件 `trustedRequest` 只是纵深防御的一层。若上游装了会改写请求头的插件（本机是 dsh-remote-mobile），它用宽松 `/^127\./` 判「本地变体」，`Host: 127.evil.com` 会先被洗成 `127.0.0.1` 再交给本插件 —— 插件侧拦不住（上游缺陷，已建议上报）；而真实的局域网 / 移动端访问由它的设备认证把关（未配对设备 401，到不了本插件路由）。因此「装了什么上游」决定实际水位，路由挪不挪出 `/plugins` 都不改变这一点。
- **未采纳的增强**：再注册 `plugins.row.config`（key = `dsh-session-notice#bark-notify`）让用户从 bundle 页点进 **row** 详情页也能看到配置入口。这个槽 0.2.0-rc.2 起就已存在（我复核了该版本的 `dsh-client-ui-plugin-manager` 产物，`plugins.row.config` 一直在槽清单里），我们从未注册 —— 属**可选增强**，不是任何版本破坏面，本轮不做。
- **验证方法（隔离实例，真机）**：独立 `DSH_HOME` + `--from-default-profile web` 建 `notice-test` profile，`dsh plugin add link:` 本仓库，起在 3081 端口：
  1. `GET /state` 返回 schema 默认值（证明 `Config` 导出 + `describe()` 通道可用）；
  2. `POST /toggle` → profile patch 里 `bark-notify.config.enabledSessions` 落盘；
  3. `Sec-Fetch-Site: cross-site` → 403；错误方法 → 405；
  4. 浏览器插件管理页 → 本插件详情页卡片渲染并正确回填（`group=probe-group`、`maxBodyChars=300`、key 只回显末 4 位），控制台零报错；
  5. 会话头部铃铛渲染 + 点击开启（`aria-pressed=true`，`/state` 随即包含该会话 id）；
  6. 真实失败回合（无模型凭据 → `turn/end reason.kind=error`）→ 本地 Bark 桩收到 `POST /push`，body 含完整错误原因与 `code=MISSING_CREDENTIAL`，即事件 → 组装 → 发送全链路可用。
  7. client 修正后复验：卡片渲染进 `section[data-plugin-config]`、失败文案计算色为红色、铃铛 toggle 与 `/state` 一致、控制台零报错。
  另：`npm test` **115/115 全绿**（把 `C:\Program Files\Git\usr\bin` 加进 PATH 让 `openssl` 可用后整跑一次，含 direct-fetch 的 16 例）；`npm run typecheck`（Host 半）与 **`npm run typecheck:client`（浏览器半，本轮新增）双双通过**。
- **client 半 typecheck 首次闭环（本轮补的盲区）**：`tsconfig.json` 一直 `exclude` 了 `src/client`，浏览器半此前**从未被类型检查过**。新增 `tsconfig.client.json`（Bundler 解析 + DOM lib）与 `npm run typecheck:client`。首跑暴露两点：① 旧写法 `import type {} from 'dsh-client-ui-slots'` 是**无效占位** —— 该包全套 `.d.ts` 里没有 `declare module '@deepseek-ai/cordis'`，`ctx.slots` 根本不会由此获得；② `SlotMap` 的 key 由各宿主包用 `declare module` 逐个合并，本插件用到的两个 slot 名分属 `dsh-client-ui-plugin-manager`（`plugins.bundle.config`）与 `dsh-client-ui-conversation`（`conversation.session.header.utilities`），必须把这几个宿主的 `./client` 子路径 type-import 进来 SlotMap 才完整。现已全绿，且 `ctx.slots` 类型真的到位了。
- **已知环境性缺口（不是代码问题）**：`tests/direct-fetch.test.mjs` 的两个 HTTPS 用例要用 `openssl` 现生成自签证书。本机默认 `PATH` 里没有它 → `spawnSync openssl ENOENT`、`npm test` 报 113/115；把 Git 自带的 `C:\Program Files\Git\usr\bin` 加进 `PATH` 后 16/16 通过、整跑 115/115 全绿（已实测）。CI/新机器同样按这条处理。

## 0.2.0 适配说明

dsh 0.2.0-rc.2（本机实测，2026-09-30）：

- **插件 peerDependencies 版本门禁（唯一破坏面）**：dsh-app-boot 新增 `evaluatePluginCompatibility`，逐项检查插件 `peerDependencies` 中 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 是否 semver 满足运行时版本（`includePrerelease`；`workspace:^|~|*` 视为当前运行时）。不满足的插件**整体跳过加载**（组合树缺失、patch 报 entry not found、HTTP 路由 404）。解法：peerDeps 增加 `^0.2.0-rc.1` 分支（或用 `workspace:*`，但二者不可混用——`workspace:` 前缀会使整条 range 恒不满足）。
- **复核未变**：`ctx.settings.describe()/update()` 契约、`webServer.register({ kind:'exact' })`、`session/event` 的 `turn/end` 六种 live reason 形状（`blocked`/`max-tokens`/`interrupted`/`error`/`completed`/`aborted`；0.2.0 另有 `forked` 种子标记，仅 fork 种子构建写入、运行时不发出，插件按未知 kind 沉默）、`Session.snapshotEvents()`、客户端 slots `plugins.bundle.config`（keyed，key=包名）与 `conversation.session.header.utilities`（list，standardProps 带 sessionId）、浏览器半 `window.__ModuleLoader__.load({id, factory})` 懒 CJS 格式、schemastery `.volatile()`/`.role('secret')`。

## 0.1.7 适配

dsh-settings 0.1.7 重构了插件设置契约（本机 0.1.7-rc.2 实测）：

- **旧**：`ctx.settings.register(ns, schema, { base, applies })` → scope 的 `get()/update()`
- **新**：插件导出 `Config`（schemastery schema，字段标 `.volatile()` 才允许写入且 live 生效），读写走 `ctx.settings.describe()`（Host 侧不带 `redactSecrets` 时 `value` 含完整 secret）与 `ctx.settings.update(ns, patch, expectedRevision?)`（merge 写入 **profile patch**，`cordis.patch.yml` 可见 `config:` 节）
- 客户端设置入口从 `settings.plugin.item`（0.1.7 已删除）迁移到 `plugins.bundle.config`（keyed，key = npm 包名 `dsh-session-notice`，owner 以 `view: 'page'` 渲染）
- volatile 字段经 cosmokit `Volatile<T>` 包装，读取需解包；启动时用组合层解析值兜底，激活后以 describe 为准（300ms TTL 缓存）
- 会话开关 `enabledSessions` 持久化在 profile patch；toggle 进程内串行化防并发覆盖

切换到 0.1.7 后**首次需重新填写 Bark key**（旧 0.1.5 设置存储不自动迁移；dsh 0.1.7 只迁移旧 `settings.yaml` 的已知 section，第三方 namespace 不在其列）。

## 开发

```bash
npm install                    # 根 peerDependencies 会被自动装上，类型检查所需 @deepseek-ai/* 即来自这里（0.2.2 运行时对齐 0.2.2-rc.1 / cordis 4.1.0 / cosmokit 1.9.0 / schemastery 3.19.0）
npm run build                    # tsc（Host 半）+ esbuild（浏览器半 → lib/client.js）
npm test                         # node:test（115 用例：纯函数 + 有状态 mock + 假接线；HTTPS 两例需 PATH 上有 openssl，Git 自带于 C:\Program Files\Git\usr\bin）
npm run typecheck                # Host 半（tsconfig.json；exclude src/client）
npm run typecheck:client         # 浏览器半（tsconfig.client.json；Bundler 解析 + DOM lib）
```

> 本地 typecheck 需把 `@deepseek-ai/*` 类型包软链进 `node_modules`（它们随 DSH 安装提供，不在公共 registry）。

## 许可

MIT
