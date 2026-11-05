import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['packages/domain', 'services/tickets', 'apps/web'],
  },
})
