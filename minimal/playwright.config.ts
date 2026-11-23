import { defineConfig, devices } from '@playwright/test'

const port = 4179

/** Serves the production build (`npm run build` first; `npm run test:e2e` does both). */
export default defineConfig({
  testDir: 'tests',
  // CI renders WebGL in software on two cores, several times slower than a laptop: shader
  // compiles and screenshots of the drawing take seconds there, so tests and polls get longer.
  timeout: process.env.CI ? 90_000 : 30_000,
  expect: { timeout: process.env.CI ? 20_000 : 5_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  webServer: {
    command: `npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Software WebGL so the smoke runs on machines and CI runners without a GPU.
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
  ],
})
