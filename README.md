# dsh-session-notice

DSH（DeepSeek Harness）会话 Bark 通知插件：在会话界面点一个按钮切换「会通知」状态，该会话轮次停止时自动经 [Bark](https://bark.day.app) 推送到手机。

- **正常结束** → 推送最后一条文本消息（长文按「首段 + 末段」摘要）
- **异常停止**（出错 / 中止 / 被阻塞 / Token 上限 / 中断）→ 推送**完整错误内容**（不按正文那样摘要截取）与必要信息
- 开关**按会话独立**、持久化（服务重启后保持），随时可切换
- 设置 → 插件配置区配置 Bark `server` / `key`，并提供 ping → push → register 三步连通测试

## 安装

```bash
# 推荐：link 安装（符号链接，改动源码后无需重装）
dsh plugin --profile web add link:/path/to/dsh-session-notice

# 或从 GitHub 安装
dsh plugin --profile web add github:Dalcui/dsh-session-notice
```

安装后若插件行未自动生效，重启 web profile：`launchctl kickstart -k gui/$(id -u)/io.deepseek.dsh-web`

> **注意**：请使用 `link:` 或 `github:` 协议。`file:` 协议在 pnpm 下是「安装时刻快照」，**新增源文件不会同步**到 `.pnpm` store，会导致 `ERR_MODULE_NOT_FOUND` 并使整个 profile 加载失败。

## 使用

1. **配置密钥**：设置 → 插件 → 找到本插件卡片，填写 Bark 服务器（默认官方 `https://api.day.app`）与设备密钥（Bark App 内查看）。密钥只存 Host 侧，界面仅显示末 4 位，不落浏览器、不进日志。
2. **测试连通**：点「测试推送」，三步独立状态：①服务器可达（`GET /ping`）②测试推送送达（`POST /push`，唯一「就绪」信号）③仅在失败时诊断 key 是否已注册（`GET /register/<key>`，不产生推送）。
3. **开启通知**：回到会话，点头部的铃铛按钮（单色图标，跟随主题，无文字）。鼠标悬浮显示操作说明，点击切换后短暂显示结果反馈；开启后该会话每次轮次停止都会推送。

## 设置项

| 字段 | 默认 | 说明 |
|---|---|---|
| Bark 服务器 | `https://api.day.app` | 官方或自建；可带路径前缀；Basic Auth 用 `user:pass@host` 形式 |
| 设备密钥 | 空 | Bark App 内查看；`role('secret')`，只回显末 4 位 |
| 分组（group） | 空 = 按工作区 | 手机通知按项目聚合、支持按分组静音 |
| 正文摘要字数 | 200 | 通知只显示约 4 行，超出按「首段 + 末段」摘要并标注总字数；范围 40–1000 |

## 实现要点

- **回合结束监听**：Host 侧 `ctx.on('session/event')` 按 `event.type === 'turn/end'` 分派，完整区分六种停止原因（`agent/turn-stopping` 只自然收尾触发、会漏异常路径，故不采用）。**主会话等待 subagent 返回时不会误通知**——subagent 调用是未完成的工具调用，回合不结束即不写 `turn/end`；只有真正收尾才推一条汇总。
- **正文双层预算**：
  - *展示层* —— 仅**正常完成**时对正文做默认 200 字摘要（方案 C：首段 + 末段，跳过代码块，按码点不劈 emoji），超出缀「（共 N 字）」。因为 iOS 横幅约 4 行（≈80–120 中文字），全量塞入既看不全又笨重。**异常停止**不做展示层摘要，错误内容完整保留（仅协议层字节闸门兜底）。
  - *协议层* —— 整包 JSON ≤ **3900 字节**（同时满足 nginx 8192B 与 APNs 4096B），`truncateByBytes` 按码点兜底。
- **折叠 id**：`id = sha1(sessionId|turn)` 前 16 位 hex（≤64B ASCII，服务端当 `apns-collapse-id`）；UA 固定 `dsh-bark-notify/<ver>`；超时 8s 且**默认不自动重试**（服务端 3s timeout < APNs 往返，超时=结果不确定）。
- **失败分类**：网络 / 鉴权（418 纯文本，不按 401 判）/ 体积（413 HTML）/ 密钥错误（`device token`，熔断不重试）/ 上游 5xx / 格式错；403/429 属运维层，不归密钥错。
- **`/register` 安全红线**：只允许 `GET {server}/register/<key>`，key 为空禁止发请求、永不带 query/body（裸 `/register` 是写接口，会覆盖设备 token）。
- **HTTP 路由而非 connection.rpc**：`ctx.connection.rpc.handle` 在本机 0.1.5-rc.1 上会用调用者 fiber 访问 `ctx.webServer` 而抛 `cannot get property "webServer" without inject`，导致整个 profile 崩溃循环。因此改用与 `dsh-codebuddy-cli` 相同的写法：`ctx.inject(['webServer'], webCtx => webCtx.webServer.register({ kind: 'exact', path: '/plugins/dsh-session-notice/*' }))`，客户端直接 `fetch`。
- **卡片样式**：`dsh-client-ui-settings-plugins` 不导出 `PluginCard`（跨插件值导入被纯度门禁禁止），故自写 CSS 复刻原生观感（`--dsw-alias-*` 主题变量、12px 圆角、34px 输入框、15/13 字号）。
- **group 归一化**：trim + 去控制字符 + ≤40 字节；归一后为空则**省略字段**（`group:""` 会形成空名分组），超限回退 `<basename> · <sha1(cwd) 前 6>`。

## 开发

```bash
npm install --legacy-peer-deps   # 类型检查所需 @deepseek-ai/* 从本机 DSH/profile 链接
npm run build                    # tsc（Host 半）+ esbuild（浏览器半 → lib/client.js）
npm test                         # node:test（81 用例：纯函数 + 有状态 mock + 假接线）
npm run typecheck
```

> 本地 typecheck 需把 `@deepseek-ai/*` 类型包软链进 `node_modules`（它们随 DSH 安装提供，不在公共 registry）。

## 许可

MIT
