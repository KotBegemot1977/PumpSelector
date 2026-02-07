import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
    root: '.', // root is frontend/
    base: './',
    server: {
        port: 8081,
        proxy: {
            '/api': {
                target: 'http://localhost:8000',
                changeOrigin: true
            },
            '/uploads': {
                target: 'http://localhost:8000',
                changeOrigin: true
            }
        }
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src')
        }
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        sourcemap: false
    }
});
