import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** Carrega o .env da raiz do monorepo (um único arquivo para os dois processos). */
export function loadRootEnv(): void {
  const path = resolve(import.meta.dirname, '../../../.env')
  if (existsSync(path)) process.loadEnvFile(path)
}
