/**
 * RPC 来源信任判定（src/rpc.ts trustedRequest 及其组件）的表驱动测试。
 *
 * 这些判定是本插件**唯一**的来源安全闸门（历史漏洞：/^127\./ 前缀匹配曾让
 * 127.evil.com 被当成回环，进而可无认证读取脱敏设置）。
 *
 * 部署环境中的上游 compat 层在「外部直连」形态下会把 Origin / Sec-Fetch-Site
 * 洗成回环值，此时只剩「Host 是否属于本部署」一条生效；在本机回环形态下则
 * 三条判据均生效（详见 src/rpc.ts trustedRequest 注释）。
 */
import assert from 'node:assert/strict'
import { networkInterfaces } from 'node:os'
import test from 'node:test'

import {
  isLoopbackHostname,
  isSameAuthorityOrigin,
  normalizeHostname,
  parseAuthority,
  trustedRequest,
} from '../lib/rpc.js'

/** 构造最小 IncomingMessage 形状（只带 headers，其余用不到）。 */
function req(headers) {
  return { headers }
}

test('isLoopbackHostname：合法回环变体为 true', () => {
  for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '127.255.255.255', '::1', '[::1]', '0:0:0:0:0:0:0:1']) {
    assert.equal(isLoopbackHostname(host), true, `${host} 应判为回环`)
  }
})

test('isLoopbackHostname：攻击者可控域名与非法 IPv4 必须为 false（历史漏洞回归）', () => {
  const dangerous = [
    '127.evil.com', // ★ 历史漏洞：曾被判为回环
    '127.0.0.1.nip.io',
    '127.0.0.1.evil.com',
    '127.0.0.1.', // 尾点域名
    '127.0.0.256', // 非法 IPv4
    '127.0.0', // 段数不足
    '127.0.0.1.5', // 段数过多
    '128.0.0.1',
    'evil.com',
    'localhost.evil.com',
  ]
  for (const host of dangerous) {
    assert.equal(isLoopbackHostname(host), false, `${host} 不得判为回环`)
  }
})

test('parseAuthority：主机名与端口解析（IPv4 / IPv6 / 无端口 / 裸 IPv6）', () => {
  assert.deepEqual(parseAuthority('127.0.0.1:3080'), { hostname: '127.0.0.1', port: '3080' })
  assert.deepEqual(parseAuthority('localhost'), { hostname: 'localhost', port: '' })
  assert.deepEqual(parseAuthority('[::1]:3080'), { hostname: '::1', port: '3080' })
  assert.deepEqual(parseAuthority('[::1]'), { hostname: '::1', port: '' })
  assert.deepEqual(parseAuthority('192.168.0.112:3080'), { hostname: '192.168.0.112', port: '3080' })
  // 裸 IPv6（无方括号）整体是主机名，不能按冒号切断
  assert.equal(parseAuthority('::1')?.hostname, '::1')
  assert.equal(parseAuthority(''), undefined)
  assert.equal(parseAuthority('   '), undefined)
})

test('trustedRequest：本机回环访问放行', () => {
  for (const host of ['127.0.0.1:3080', 'localhost:3080', '[::1]:3080', '127.0.0.1']) {
    assert.equal(trustedRequest(req({ host }), []), true, `${host} 应放行`)
  }
})

test('trustedRequest：本机网卡 IP（局域网形态）放行 —— 本次缺陷的修复目标', (t) => {
  // 取真实网卡 IP，避免硬编码
  const localIps = Object.values(networkInterfaces())
    .flat()
    .filter(Boolean)
    .map((e) => (e.address || '').toLowerCase().replace(/^::ffff:/, '').split('%')[0])
    .filter((a) => a && a !== 'localhost' && !isLoopbackHostname(a))
  if (localIps.length === 0) {
    // 显式 skip 而不是静默 return：无网卡的 CI 上应显示为 skipped，
    // 否则「0 断言但记 pass」会让这段覆盖悄悄消失且无人察觉。
    t.skip('当前环境无非回环网卡，跳过局域网 IP 用例')
    return
  }
  for (const ip of localIps) {
    // IPv6 在 Host 头里必须带方括号（RFC 3986），浏览器也只会这么发。
    const host = ip.includes(':') ? `[${ip}]:3080` : `${ip}:3080`
    assert.equal(trustedRequest(req({ host }), []), true, `${host} 应放行`)
  }
})

test('trustedRequest：外部/伪造 Host 必须拒绝（DNS-rebinding 防御）', () => {
  const bad = [
    'evil.com:3080',
    'evil.com',
    '127.evil.com:3080', // ★ 历史漏洞
    '127.0.0.1.nip.io:3080',
    '0.0.0.0:3080',
    '[::]:3080',
    '',
  ]
  for (const host of bad) {
    assert.equal(trustedRequest(req({ host }), []), false, `Host=${host} 必须拒绝`)
  }
  // 完全缺少 Host 头
  assert.equal(trustedRequest(req({}), []), false)
})

test('trustedRequest：Sec-Fetch-Site: cross-site 一律拒绝', () => {
  assert.equal(trustedRequest(req({ host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' }), []), false)
  for (const site of ['same-origin', 'same-site', 'none']) {
    assert.equal(trustedRequest(req({ host: '127.0.0.1:3080', 'sec-fetch-site': site }), []), true)
  }
})

test('trustedRequest：跨站 Origin 拒绝，同源 Origin 放行', () => {
  // 跨站
  assert.equal(
    trustedRequest(req({ host: '127.0.0.1:3080', origin: 'http://evil.com' }), []),
    false,
  )
  assert.equal(trustedRequest(req({ host: '127.0.0.1:3080', origin: 'null' }), []), false)
  // 同源（无 Origin 是浏览器同源 GET 的正常形态）
  assert.equal(trustedRequest(req({ host: '127.0.0.1:3080' }), []), true)
  assert.equal(
    trustedRequest(req({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }), []),
    true,
  )
  // 回环别名互认（localhost 页面 + 127.0.0.1 Host 不应误伤）
  assert.equal(
    trustedRequest(req({ host: 'localhost:3080', origin: 'http://127.0.0.1:3080' }), []),
    true,
  )
})

test('isSameAuthorityOrigin：协议与端口必须严格匹配（非回环）', () => {
  // 端口不同 → 拒绝
  assert.equal(isSameAuthorityOrigin('http://192.168.0.112:9999', '192.168.0.112', '3080'), false)
  // 协议不同（https Origin 配 http 监听）→ 拒绝（混合内容/降级判据）
  assert.equal(isSameAuthorityOrigin('https://192.168.0.112', '192.168.0.112', '3080'), false)
  // 完全一致 → 放行
  assert.equal(isSameAuthorityOrigin('http://192.168.0.112:3080', '192.168.0.112', '3080'), true)
  // 非 http(s) 协议 → 拒绝
  assert.equal(isSameAuthorityOrigin('file://x', '192.168.0.112', '3080'), false)
  // 无法解析 → 拒绝
  assert.equal(isSameAuthorityOrigin('null', '192.168.0.112', '3080'), false)
})

test('trustedRequest：trustedHosts 名单语义（显式端口精确匹配 / 无端口任意端口）', () => {
  const host = 'harness.internal:3080'
  // 无端口条目：任意端口放行
  assert.equal(trustedRequest(req({ host }), ['harness.internal']), true)
  // 显式端口匹配：放行
  assert.equal(trustedRequest(req({ host }), ['harness.internal:3080']), true)
  // 显式端口不匹配：拒绝（端口语义不可丢失）
  assert.equal(trustedRequest(req({ host }), ['harness.internal:9999']), false)
  // 名单为空：自定义域名不可用（安全降级为仅回环 + 网卡 IP）
  assert.equal(trustedRequest(req({ host }), []), false)
})

test('isSameAuthorityOrigin：回环别名互认但端口不放宽（跨端口必须拒绝）', () => {
  // 别名互认：localhost 与 127.0.0.1 指同一服务的同端口（历史回归修复点）
  assert.equal(isSameAuthorityOrigin('http://127.0.0.1:3080', 'localhost', '3080'), true)
  assert.equal(isSameAuthorityOrigin('http://localhost:3080', '127.0.0.1', '3080'), true)
  assert.equal(isSameAuthorityOrigin('http://[::1]:3080', '127.0.0.1', '3080'), true)

  // 跨端口：不同 TCP 端点，必须拒绝
  // （否则本机其他端口上被攻破的服务可跨端口调用 /set 改写 Bark key）
  assert.equal(isSameAuthorityOrigin('http://127.0.0.1:9999', '127.0.0.1', '3080'), false)
  assert.equal(isSameAuthorityOrigin('http://localhost:9999', '127.0.0.1', '3080'), false)
  assert.equal(isSameAuthorityOrigin('http://127.0.0.1:80', '127.0.0.1', '3080'), false)
  assert.equal(isSameAuthorityOrigin('http://127.0.0.1:3080', '127.0.0.1', '9999'), false)
})

test('trustedRequest：回环跨端口 Origin 在整链路上同样被拒绝', () => {
  assert.equal(
    trustedRequest(req({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:9999' }), []),
    false,
  )
  // 同端口别名互认仍放行（不回归）
  assert.equal(
    trustedRequest(req({ host: 'localhost:3080', origin: 'http://127.0.0.1:3080' }), []),
    true,
  )
})

test('trustedRequest：IPv4-mapped IPv6 归一（真回环放行，伪域名拒绝）', () => {
  // ::ffff:127.0.0.1 是回环的映射形式 → 放行
  assert.equal(trustedRequest(req({ host: '[::ffff:127.0.0.1]:3080' }), []), true)
  // ::ffff: 后跟域名：归一后仍须过严格 IPv4 判定 → 拒绝
  assert.equal(trustedRequest(req({ host: '[::ffff:127.evil.com]:3080' }), []), false)
  assert.equal(trustedRequest(req({ host: '[::ffff:127.0.0.1.nip.io]:3080' }), []), false)
  // ::ffff: 后跟公网 IP：不属于本部署 → 拒绝
  assert.equal(trustedRequest(req({ host: '[::ffff:8.8.8.8]:3080' }), []), false)
})

test('trustedRequest：trustedHosts 与 Origin 同源必须联动', () => {
  // 名单放行 Host 且 Origin 同 authority → 放行
  assert.equal(
    trustedRequest(req({ host: 'harness.internal:3080', origin: 'http://harness.internal:3080' }), ['harness.internal']),
    true,
  )
  // Host 受信不能放松 Origin：跨端口 → 拒绝
  assert.equal(
    trustedRequest(req({ host: 'harness.internal:3080', origin: 'http://harness.internal:9999' }), ['harness.internal']),
    false,
  )
  // Host 受信不能放松 Origin：跨域 → 拒绝
  assert.equal(
    trustedRequest(req({ host: 'harness.internal:3080', origin: 'http://evil.com' }), ['harness.internal']),
    false,
  )
})

test('normalizeHostname：剥离 IPv6 zone 与方括号（可用性，防链路本地误 403）', () => {
  assert.equal(normalizeHostname('fe80::1%12'), 'fe80::1')
  assert.equal(normalizeHostname('[fe80::1%12]'), 'fe80::1')
  assert.deepEqual(parseAuthority('[fe80::1%12]:3080'), { hostname: 'fe80::1', port: '3080' })
})
