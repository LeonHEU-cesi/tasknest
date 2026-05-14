import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2022',
        keepClassNames: true,
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
    exclude: ['node_modules/**', 'dist/**', '.turbo/**'],
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
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
