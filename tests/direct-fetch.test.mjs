import assert from 'node:assert/strict'
import test from 'node:test'

import { createServer } from 'node:http'

import { directFetch, networkVerdict, sendPush } from '../lib/bark-service.js'

/** 起一个本地 HTTP 服务器，返回 { server, base, close }。 */
function localServer(handler) {
  const server = createServer(handler)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({
        server,
        base: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(done)),
      })
    })
  })
}

test('directFetch：GET /ping 直连成功，status/headers/text 与 fetch 形状一致', async () => {
  const { server, base, close } = await localServer((req, res) => {
    assert.equal(req.method, 'GET')
    assert.equal(req.url, '/ping')
    assert.equal(req.headers['user-agent'], 'dsh-bark-notify/test')
    res.writeHead(200, { 'content-type': 'application/json', 'x-custom': 'yes' })
    res.end('{"code":200,"message":"pong"}')
  })
  try {
    const res = await directFetch(`${base}/ping`, {
      method: 'GET',
      headers: { 'user-agent': 'dsh-bark-notify/test' },
    })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'application/json')
    assert.equal(res.headers.get('X-CUSTOM'), 'yes')
    assert.equal(res.headers.get('missing'), null)
    assert.equal(await res.text(), '{"code":200,"message":"pong"}')
  } finally {
    await close()
  }
})

test('directFetch：POST /push 携带 body 与 content-type', async () => {
  let received = ''
  const { server, base, close } = await localServer((req, res) => {
    assert.equal(req.method, 'POST')
    assert.equal(req.headers['content-type'], 'application/json; charset=utf-8')
    req.on('data', (c) => { received += c })
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"code":200,"message":"success"}')
    })
  })
  try {
    const body = JSON.stringify({ device_key: 'k', title: 't', body: 'b', level: 'active' })
    const res = await directFetch(`${base}/push`, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body })
    assert.equal(res.status, 200)
    assert.equal(await res.text(), '{"code":200,"message":"success"}')
    assert.equal(received, body)
  } finally {
    await close()
  }
})

test('directFetch：非 2xx 状态原样透传（分类逻辑在发送层决定）', async () => {
  const { server, base, close } = await localServer((req, res) => {
    res.writeHead(413, { 'content-type': 'text/html' })
    res.end('<html>413 Request Entity Too Large</html>')
  })
  try {
    const res = await directFetch(`${base}/push`, { method: 'POST', headers: {} })
    assert.equal(res.status, 413)
    assert.equal(res.headers.get('content-type'), 'text/html')
    assert.match(await res.text(), /413 Request Entity Too Large/)
  } finally {
    await close()
  }
})

test('directFetch：连接拒绝 → reject（网络错误路径保持可分类）', async () => {
  await assert.rejects(
    () => directFetch('http://127.0.0.1:1/ping', { method: 'GET', headers: {} }),
    /connect ECONNREFUSED|connect EHOSTUNREACH/i,
  )
})

test('directFetch：path 带查询串与自定义端口正确转发', async () => {
  const { server, base, close } = await localServer((req, res) => {
    assert.equal(req.url, '/register/key123?x=1')
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"code":200,"message":"success"}')
  })
  try {
    const res = await directFetch(`${base}/register/key123?x=1`, { method: 'GET', headers: {} })
    assert.equal(res.status, 200)
    assert.equal(await res.text(), '{"code":200,"message":"success"}')
  } finally {
    await close()
  }
})

import { createServer as createHttpsServer } from 'node:https'
import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('directFetch：GET 同源 3xx 跟随（≤3 跳），最终返回 200', async () => {
  let hits = 0
  const { server, base, close } = await localServer((req, res) => {
    hits += 1
    if (req.url === '/ping') {
      res.writeHead(301, { location: '/pong' })
      res.end('moved')
    } else if (req.url === '/pong') {
      res.writeHead(302, { location: '/final' })
      res.end('moved2')
    } else if (req.url === '/final') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"code":200,"message":"pong"}')
    } else {
      res.writeHead(404); res.end()
    }
  })
  try {
    const res = await directFetch(base + '/ping', { method: 'GET', headers: {} })
    assert.equal(hits, 3)
    assert.equal(res.status, 200)
    assert.equal(await res.text(), '{"code":200,"message":"pong"}')
  } finally {
    await close()
  }
})

test('directFetch：GET 跨源 3xx 不跟随（防凭据泄漏），原样返回 301', async () => {
  let crossHits = 0
  // 第一个服务器返回 301 → 指向 127.0.0.1:1 的异源地址
  const { server, base, close } = await localServer((req, res) => {
    res.writeHead(301, { location: 'http://example.com/cross' })
    res.end('moved')
    crossHits += 1
  })
  try {
    const res = await directFetch(base + '/ping', { method: 'GET', headers: {} })
    assert.equal(res.status, 301)
    assert.equal(crossHits, 1)
    assert.equal(res.headers.get('location'), 'http://example.com/cross')
  } finally {
    await close()
  }
})

test('directFetch：POST /push 3xx 不自动跟随，原样返回（device_key 不重放异源）', async () => {
  const { server, base, close } = await localServer((req, res) => {
    res.writeHead(307, { location: base + '/other' })
    res.end('temp redirect')
  })
  try {
    const res = await directFetch(base + '/push', { method: 'POST', headers: {}, body: '{}' })
    assert.equal(res.status, 307)
    assert.equal(await res.text(), 'temp redirect')
  } finally {
    await close()
  }
})

test('directFetch：默认传输端到端 —— sendPush 不带 fetchImpl 走 directFetch 成功', async () => {
  const { server, base, close } = await localServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      assert.equal(req.method, 'POST')
      assert.ok(req.headers['content-length'] !== undefined, '应有显式 Content-Length')
      assert.ok(Number(req.headers['content-length']) === Buffer.byteLength(body))
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"code":200,"message":"success"}')
    })
  })
  try {
    const verdict = await sendPush(
      { server: base, key: 'k', group: '', maxBodyChars: 200 },
      { device_key: 'k', title: 't', body: 'b', level: 'active' },
      { timeoutMs: 5000 },
    )
    assert.equal(verdict.ok, true)
    assert.equal(verdict.kind, 'success')
  } finally {
    await close()
  }
})

test('directFetch：AbortSignal 超时中止 → reject 且 networkVerdict 归「请求超时」档', async () => {
  // 服务器永远不响应（挂起）
  const { server, base, close } = await localServer(() => { /* 故意不响应 */ })
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 300)
    const start = Date.now()
    await assert.rejects(directFetch(base + '/ping', { method: 'GET', headers: {}, signal: controller.signal }), (error) => {
      clearTimeout(timer)
      const verdict = networkVerdict(error, 8000)
      assert.equal(verdict.kind, 'network')
      assert.ok(verdict.message.includes('请求超时') || verdict.message.includes('abort'), verdict.message)
      return true
    })
    assert.ok(Date.now() - start < 5000, '应在 ~300ms 中止而非悬挂')
  } finally {
    await close()
  }
})

test('directFetch：代理污染回归 —— HTTP_PROXY/NODE_USE_ENV_PROXY 下直连仍成功（本 bug 复现场景）', async () => {
  const saved = {}
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NODE_USE_ENV_PROXY']) {
    saved[k] = process.env[k]
  }
  // 指向必然不可达的代理端口
  process.env.HTTP_PROXY = 'http://127.0.0.1:1'
  process.env.HTTPS_PROXY = 'http://127.0.0.1:1'
  process.env.NODE_USE_ENV_PROXY = '1'
  const { server, base, close } = await localServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"code":200,"message":"pong"}')
  })
  try {
    const res = await directFetch(base + '/ping', { method: 'GET', headers: {} })
    assert.equal(res.status, 200)
  } finally {
    await close()
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
})

test('directFetch：响应正文未读完连接被中止 → 立即 reject（而非悬挂）', async () => {
  // 发送部分 body 后强制 destroy
  const { server, base, close } = await localServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.write('partial')
    res.destroy() // 模拟 RST / 中途断连
  })
  try {
    await assert.rejects(
      directFetch(base + '/ping', { method: 'GET', headers: {} }),
      (error) => error instanceof Error,
    )
  } finally {
    await close()
  }
})

test('directFetch：不支持的 scheme 同步 reject', async () => {
  await assert.rejects(
    () => directFetch('ftp://example.com/x', { method: 'GET', headers: {} }),
    /只支持 http/,
  )
})

