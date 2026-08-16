import { createServer, type Server } from 'node:http'

export async function startMockProvider(): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type',
        'cross-origin-resource-policy': 'cross-origin',
      })
      response.end()
      return
    }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
      'cross-origin-resource-policy': 'cross-origin',
    })
    response.write('data: {"choices":[{"delta":{"reasoning_content":"Brief reasoning."}}]}\n\n')
    setTimeout(() => {
      if (response.destroyed) return
      response.write('data: {"choices":[{"delta":{"content":"Mock answer from Dianzhi."}}]}\n\n')
      response.end('data: [DONE]\n\n')
    }, 600)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Mock provider did not bind.')
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1` }
}
