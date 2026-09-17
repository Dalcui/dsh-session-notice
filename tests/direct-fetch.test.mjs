import assert from 'node:assert/strict'
import test from 'node:test'

import { createServer } from 'node:http'

import { directFetch } from '../lib/bark-service.js'

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

