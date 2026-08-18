/**
 * 实景办公室 host 半部：无宿主侧逻辑，仅让插件出现在 host 的 cordis 加载表里。
 * 浏览器半部见 src/client/index.ts（经 package.json 的 dsh.client 声明被发现）。
 */
export const name = 'office-plugin'

export function apply(): void {}
