import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { name: 'tickets', include: ['test/**/*.test.ts'] } })
