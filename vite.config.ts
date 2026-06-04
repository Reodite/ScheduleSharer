import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base must match the GitHub repo name for GitHub Pages deploys.
export default defineConfig({
  base: '/ScheduleSharer/',
  plugins: [react()],
});
