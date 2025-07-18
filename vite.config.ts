import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path' // Node.jsのpathモジュールをインポート

export default defineConfig({
  plugins: [vue()],
  // ★★★ resolve.alias設定を追加 ★★★
  resolve: {
    alias: {
      // '@' というエイリアスが、'./src' ディレクトリを指すように設定
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
