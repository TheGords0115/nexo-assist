import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

// Apaga o banco de conversas (data/app.db). Usado pelo `npm run seed` da raiz junto com o reset
// dos chamados, para começar a demonstração do zero.
const path = resolve(import.meta.dirname, '../../../data/app.db')
for (const file of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(file)) rmSync(file)
console.log('Conversas apagadas.')
