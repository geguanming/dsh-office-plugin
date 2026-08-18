# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 这是什么

`dsh-office-plugin`：deepseek-harness 的「实景办公室」浏览器 UI 插件——把多 agent 会话活动渲染成 pixi.js 办公室（牛马员工搬砖/摸鱼），以 Web UI 侧边栏面板呈现。它是独立于仓库主 workspace 的插件包（根目录 `pnpm-workspace.yaml` 写 `packages: []`，阻止 pnpm 向上找到仓库根的 workspace）。

仓库根的 [AGENTS.md](../AGENTS.md) 管主仓库规范；本文件只管本目录。

## 命令

```sh
pnpm -C office-plugin install
pnpm -C office-plugin build       # tsdown 双配置：host -> lib/index.js，client -> lib/client.js
pnpm -C office-plugin watch
pnpm -C office-plugin typecheck   # tsc --noEmit
```

开发闭环：`build` → 重启 `pnpm dsh web`（bundle rev 在激活时读取，不重启不更新）→ `curl http://<host>/plugins/dsh-office-plugin/client.js` 验证产物。

激活双半插件只有一条路：`dsh plugin --profile web add ./office-plugin`。`--patch` + file:/// URL 只加载 host 半部，浏览器代码不会被发现。

## 架构：双半插件

- **host 半部** `src/index.ts`：无宿主侧逻辑，仅让插件出现在 host 的 cordis 加载表里（`cordis.patch.yml` 向 web profile insert `id: office`）。
- **client 半部** `src/client/`：经 package.json 的 `dsh.client` 声明（`platform: "web"` + `inject` runtime/ui-conversation）被浏览器加载器发现。

### client 内部数据流

`index.ts`（在 `shell.overlay` 全局层注册入口，inject `slots`/`layout`/`sessions`）
→ `OfficeLauncher.tsx`（右上角入口，经 `ctx.sessions` 自订阅会话列表/快照）
→ `OfficeDock.tsx`（右侧侧边栏面板，对话留中栏）
→ `OfficeCanvas.tsx`（React 壳 + 会话选择，持有 pixi 场景）
→ `officeStore.ts`（会话状态 → 员工名单：老板 = 当前会话，员工 = 其余会话；`MAX_EMPLOYEES = 16`；轨迹只扫尾部 `LATEST_NODE_SCAN` 条防卡）
→ `pixi/`（`officeScene` 场景编排、`employee` 员工状态机、`pathfinding` 寻路、`officeLayout` 工位布局、`textures`/`palette`/`ambient` 视觉）。

### 类型面约定

本包不链接仓库内包。`src/client/runtimeTypes.ts` 是与 `@deepseek-ai/dsh-client-runtime` 真实导出逐字段对齐的本地类型面：只保留用到的一层字段，深层用 `unknown` 兜底。改动 runtime 的契约时要同步手改这里。

## 构建硬约束（tsdown.config.ts）

- client 必须是**单文件 CJS**：`format: 'cjs'`、`platform: 'browser'`、`inlineDynamicImports: true`（pixi.js 含动态 import，不 inline 会拆 chunk，而加载器只 serve 单个 `/plugins/<id>/client.js`，拆出的 chunk 会 404）。
- `banner`/`footer`/`intro` 三件套包裹 `window.__ModuleLoader__.load(...)`，照抄 `packages/client/tsdown.client.ts`。
- `external` 列表 = 仓库 `packages/client/web/src/platform.ts` 的 `PLATFORM_MODULES`（react 等，由浏览器模块表经注入的 require 提供）；上游列表变动时这里要跟着改。其余依赖（pixi.js 等）一律 `noExternal` 内联。
- host 半部 `fixedExtension: false`，否则产物是 `index.mjs` 而 package.json exports 声明的是 `lib/index.js`，加载器报 ERR_MODULE_NOT_FOUND。
