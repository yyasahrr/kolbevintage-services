import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** CORS کامل برای APIهای کلبه روی پروکسی dev (مشابه vite.config ریشه) */
const KOLBE_CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization, x-publishable-api-key',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-max-age': '600',
}

function kolbeApiCorsPlugin(): Plugin {
  const middleware = (req: any, res: any, next: () => void) => {
    const url = req.url ?? ''
    if (!(url === '/store/kolbe' || url.startsWith('/store/kolbe/') || url.startsWith('/store/kolbe?') || url === '/admin/kolbe' || url.startsWith('/admin/kolbe/') || url.startsWith('/admin/kolbe?'))) {
      return next()
    }
    delete req.headers.origin
    delete req.headers.referer
    if (req.method === 'OPTIONS') {
      res.writeHead(204, KOLBE_CORS_HEADERS)
      res.end()
      return
    }
    for (const [key, value] of Object.entries(KOLBE_CORS_HEADERS)) {
      if (key !== 'access-control-max-age') res.setHeader(key, value)
    }
    next()
  }
  return {
    name: 'kolbe-api-cors',
    configureServer(server) { server.middlewares.use(middleware) },
    configurePreviewServer(server) { server.middlewares.use(middleware) },
  }
}

const kolbeProxy = {
  target: 'http://127.0.0.1:9000',
  changeOrigin: true,
  configure: (proxy: any) => {
    proxy.on('proxyReq', (proxyReq: any) => {
      proxyReq.removeHeader('origin')
      proxyReq.removeHeader('referer')
    })
    proxy.on('proxyRes', (proxyRes: any) => {
      proxyRes.headers['access-control-allow-origin'] = '*'
      proxyRes.headers['access-control-allow-headers'] = KOLBE_CORS_HEADERS['access-control-allow-headers']
      proxyRes.headers['access-control-allow-methods'] = KOLBE_CORS_HEADERS['access-control-allow-methods']
    })
  },
}

export default defineConfig({
  plugins: [react(), kolbeApiCorsPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    allowedHosts: true,
    proxy: {
      '/store/kolbe': kolbeProxy,
      '/admin/kolbe': kolbeProxy,
    },
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/store/kolbe': kolbeProxy,
      '/admin/kolbe': kolbeProxy,
    },
  },
})
