import assert from 'node:assert/strict'
import test from 'node:test'

import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createServer as createTlsServer, request as tlsRequest } from 'node:https'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

/**
 * 生成一次性自签证书（测试专用，openssl CLI，127.0.0.1 SAN）。
 * @returns {Promise<{ key: string; cert: string }>}
 */
async function selfSignedCert() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bark-cert-'))
  try {
    const keyFile = join(dir, 'key.pem')
    const csrFile = join(dir, 'csr.pem')
    const certFile = join(dir, 'cert.pem')
    const extFile = join(dir, 'ext.cnf')
    // 生成私钥
    execFileSync('openssl', ['genrsa', '-out', keyFile, '2048'], { stdio: 'ignore' })
    // CSR（OpenSSL 3.6 的 -x509 不允许带 -extfile → 先建 CSR 再用 x509 -req 自签）
    execFileSync('openssl', ['req', '-new', '-key', keyFile, '-out', csrFile, '-subj', '/CN=localhost'], { stdio: 'ignore' })
    // 自签证书（SAN 含 IP:127.0.0.1，Node 校验需要 SAN）
    writeFileSync(extFile, 'subjectAltName=IP:127.0.0.1,DNS:localhost\nextendedKeyUsage=serverAuth')
    execFileSync('openssl', ['x509', '-req', '-in', csrFile, '-signkey', keyFile, '-out', certFile, '-days', '1', '-extfile', extFile], { stdio: 'ignore' })
    return { key: readFileSync(keyFile, 'utf8'), cert: readFileSync(certFile, 'utf8') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** 起一个本地 HTTPS 服务器（自签证书），返回 { server, base, close }。 */
async function localTlsServer(handler) {
  const { key, cert } = await selfSignedCert()
  const server = createTlsServer({ key, cert }, handler)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({
        server,
        base: `https://127.0.0.1:${address.port}`,
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
  const savedFetchFlag = process.env.BARK_USE_FETCH
  delete process.env.BARK_USE_FETCH // 隔离：确保走 directFetch 而非回退 global fetch
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
    if (savedFetchFlag === undefined) delete process.env.BARK_USE_FETCH
    else process.env.BARK_USE_FETCH = savedFetchFlag
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

test('directFetch：HTTPS 直连成功（自签证书，生产主路径 httpsRequest）', async () => {
  const { server, base, close } = await localTlsServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"code":200,"message":"pong"}')
  })
  try {
    // directFetch 默认校验证书（agent:false 用默认校验配置）—— 自签会失败，
    // 因此这里用 NODE_TLS_REJECT_UNAUTHORIZED=0 仅在本用例内放行。
    const saved = process.env.NODE_TLS_REJECT_UNAUTHORIZED
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    try {
      const res = await directFetch(base + '/ping', { method: 'GET', headers: {} })
      assert.equal(res.status, 200)
      assert.equal(await res.text(), '{"code":200,"message":"pong"}')
    } finally {
      if (saved === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = saved
    }
  } finally {
    await close()
  }
})

test('directFetch：HTTPS 未知 CA 证书被拒（默认校验收紧，不静默放行）', async () => {
  const { server, base, close } = await localTlsServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"code":200,"message":"pong"}')
  })
  try {
    // 不设置 NODE_TLS_REJECT_UNAUTHORIZED（保持默认校验）→ 自签证书应被拒
    const saved = process.env.NODE_TLS_REJECT_UNAUTHORIZED
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
    try {
      await assert.rejects(
        directFetch(base + '/ping', { method: 'GET', headers: {} }),
        (error) => error instanceof Error && /certificate|self.signed|unable to verify/i.test(String(error.message)),
      )
    } finally {
      if (saved === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = saved
    }
  } finally {
    await close()
  }
})

test('directFetch：畸形 URL 异步 reject（不同步抛）', async () => {
  let promise
  assert.doesNotThrow(() => { promise = directFetch('not a url', { method: 'GET', headers: {} }) })
  await assert.rejects(promise, /无效的请求地址|Invalid URL/i)
})


