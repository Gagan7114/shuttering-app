import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development (npm run dev) API calls are forwarded to the Django app.
// Port 8000 is used by another project on this computer, so the shop runs on 8001.
// Override with:  BACKEND_URL=http://127.0.0.1:XXXX npm run dev
const backend = process.env.BACKEND_URL || 'http://127.0.0.1:8001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // changeOrigin: false keeps the browser's Host header (e.g. localhost:5174), so
    // Django's CSRF origin check passes whichever port Vite ends up on.
    proxy: Object.fromEntries(
      ['/api', '/admin', '/static'].map((p) => [p, { target: backend, changeOrigin: false }]),
    ),
  },
});
