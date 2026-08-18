import { defineConfig } from 'tsdown'

/**
 * 浏览器模块表里的平台模块（见仓库 packages/client/web/src/platform.ts 的
 * PLATFORM_MODULES）：这些 import 由加载器注入的 require 解析，构建时保持
 * external；其余依赖（pixi.js 等）一律内联进 client.js。
 */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
] as const

export default defineConfig([
  {
    name: 'dsh-office-plugin/host',
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    // 保持 .js 扩展名，与 package.json exports 声明一致
    fixedExtension: false,
    dts: false,
    clean: true,
  },
  {
    name: 'dsh-office-plugin/client',
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...CLIENT_EXTERNALS],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    noExternal: (id: string) => (CLIENT_EXTERNALS as readonly string[]).includes(id) ? undefined : true,
    outputOptions: {
      entryFileNames: 'client.js',
      // 加载器只 serve 单个 /plugins/<id>/client.js，必须打成单文件
      // （pixi 内部有动态 import，需 inline 才不会拆出 chunk）
      inlineDynamicImports: true,
      banner: 'window.__ModuleLoader__.load({ id: "dsh-office-plugin", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
