import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// IMPORTANT: replace 'REPO_NAME' below with your actual GitHub repo name
// Example: if your repo is https://github.com/san/99xbet-tracker
// then base should be '/99xbet-tracker/'
export default defineConfig({
  plugins: [react()],
  base: '/99xbet-tracker/',
})
