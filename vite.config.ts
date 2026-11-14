import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',   // GitHub Pages 하위 주소(/gyeote/)에서도 파일을 찾게 상대 경로로
  server: { port: 5173, strictPort: true },
})
