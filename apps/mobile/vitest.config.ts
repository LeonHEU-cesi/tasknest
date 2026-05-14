import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    exclude: ['node_modules/**', '.expo/**', 'android/**', 'ios/**', '.turbo/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: 'coverage',
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
