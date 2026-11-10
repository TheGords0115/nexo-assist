import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { NextConfig } from 'next'

// Um único .env na raiz do monorepo, compartilhado com o serviço de chamados.
const rootEnv = resolve(import.meta.dirname, '../../.env')
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)

// Aviso logo ao subir, para não descobrir só na primeira mensagem do chat.
const model = process.env.NEXO_MODEL ?? 'google/gemini-3.5-flash-lite'
const keyVar = model.startsWith('google/') ? 'GOOGLE_GENERATIVE_AI_API_KEY' : model.startsWith('openai/') ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'
if (!process.env[keyVar]) {
  console.warn(`
[nexo] ${keyVar} não está no .env: o chat não vai responder até ela ser preenchida (modelo ${model}).
`)
}

const nextConfig: NextConfig = {
  transpilePackages: ['@nexo/domain'],
  serverExternalPackages: ['@mastra/*', '@libsql/client', 'libsql'],
  poweredByHeader: false,
}

export default nextConfig
