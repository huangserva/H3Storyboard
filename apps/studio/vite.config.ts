import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: true,
    proxy: {
      '/api': process.env.H3_STORYBOARD_API_ORIGIN ?? 'http://127.0.0.1:4187',
    },
  },
});
