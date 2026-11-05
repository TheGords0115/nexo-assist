import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { NextConfig } from 'next'

// Um único .env na raiz do monorepo, compartilhado com o serviço de chamados.
const rootEnv = resolve(import.meta.dirname, '../../.env')
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)

const nextConfig: NextConfig = {
  transpilePackages: ['@nexo/domain'],
  serverExternalPackages: ['@mastra/*', '@libsql/client', 'libsql'],
  poweredByHeader: false,
}

export default nextConfig
