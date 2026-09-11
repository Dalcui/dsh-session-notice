# dsh-session-notice

DSH 会话 Bark 通知插件：在会话界面点一个按钮切换「会通知」状态，该会话轮次停止时自动经 [Bark](https://bark.day.app) 推送到手机。

- **正常结束** → 推送最后一条文本消息
- **异常停止**（错误 / 中止 / 阻塞 / Token 上限 / 中断）→ 推送停止原因与必要信息
- 开关按会话独立、持久化（服务重启后保持），随时可切换
- 设置 → 插件配置区配置 Bark `server` / `key`，并提供 ping → push → register 三步连通测试

## 安装

```bash
dsh plugin --profile web add github:<you>/dsh-session-notice
# 或本地路径
dsh plugin --profile web add /path/to/dsh-session-notice
```

## 使用

1. **配置密钥**：设置 → 插件 → 找到本插件卡片，填写 Bark 服务器（默认官方 `https://api.day.app`）与设备密钥（Bark App 内查看）。密钥只存 Host 侧，界面只显示末 4 位，不落浏览器、不进日志。
2. **测试连通**：点「测试推送」，三步独立状态：①服务器可达（`GET /ping`）②测试推送送达（`POST /push`，唯一「就绪」信号）③失败时诊断 key 是否已注册（`GET /register/<key>`，不产生推送）。
3. **开启通知**：回到会话，点头部「🔔 会通知 / 🔕 不通知」按钮切换。开启后该会话每次轮次停止都会推送。

## 实现要点

- **回合结束监听**：Host 侧 `ctx.on('session/event')` 按 `event.type === 'turn/end'` 分派，完整区分六种停止原因（`agent/turn-stopping` 只自然收尾触发、会漏异常路径，故不采用）。
- **Bark 协议**：唯一发送路径 `POST {server}/push` + JSON（`device_key` 在 body、字段名小写）；整包 ≤ **3900 字节**、body 预算 3400 字节（≈1130 个中文字），**按码点累加截断**（不劈 emoji）；`id = sha1(sessionId|turn)` 前 16 位 hex；UA 固定 `dsh-bark-notify/<ver>`；超时 8s 且**默认不自动重试**（服务端 3s timeout < APNs 往返，超时=结果不确定）。
- **失败分类**：网络 / 鉴权（418 纯文本，不按 401 判）/ 体积（413 HTML）/ 密钥错误（`device token`，熔断不重试）/ 上游 5xx / 格式错；403/429 属运维层不归密钥错。
- **`/register` 安全红线**：只允许 `GET {server}/register/<key>`，key 为空禁止发请求、永不带 query/body（裸 `/register` 是写接口，会覆盖设备 token）。
- **group**：默认按工作区自动分组（`aps.thread-id` + 按组静音键），归一化 ≤40 字节、空则省略字段；设置页可覆盖。

## 开发

```bash
npm install --legacy-peer-deps   # 类型检查所需 @deepseek-ai/* 从本机 DSH/profile 链接
npm run build                    # tsc（Host 半）+ esbuild（浏览器半 → lib/client.js）
npm test                         # node:test（64 用例：纯函数 + 有状态 mock + 假接线）
npm run typecheck
```

## 许可

MIT
