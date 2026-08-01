import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      // more specific path first: Vite checks proxy entries in declaration
      // order, so /api/path must be matched before the general /api rule.
      '/api/path': 'http://localhost:3002',
      '/api': 'http://localhost:3001',
    },
  },
});
