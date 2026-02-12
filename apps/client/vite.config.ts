import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import restart from 'vite-plugin-restart'
import glsl from 'vite-plugin-glsl'
import { resolve } from 'path'

export default defineConfig({
    root: 'src/',
    publicDir: '../public/',
    plugins: [
        restart({ restart: ['../public/**'] }),
        react(),
        glsl({
            include: ['**/*.glsl', '**/*.vert', '**/*.frag'],
        }),
    ],
    resolve: {
        alias: {
            '@shared': resolve(__dirname, '../../packages/shared/src'),
        },
    },
    assetsInclude: ['**/*.glb', '**/*.gltf'],
    server: {
        host: true,
        open: !('SANDBOX_URL' in process.env || 'CODESANDBOX_HOST' in process.env),
    },
    build: {
        outDir: '../dist',
        emptyOutDir: true,
        sourcemap: true,
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'src/index.html'),
                viewer: resolve(__dirname, 'src/viewer.html'),
            },
        },
    },
})
