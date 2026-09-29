# 认证页小燕在减弱档仍有动画：情绪规则特异性压过 `.xz-auth *`，0ms 过渡带 delay 仍生成 transition

> 2026-09-29 · ADR-0034 · REQ-UI-043

## 症状

- e2e 用 `reducedMotion: 'reduce'` 打开 `/login`，`document.querySelector('.xz-auth-art').getAnimations({ subtree: true })` 返回 3 个 `xz-leaf-fall`。落叶本应只在丰富档出现，而且此时还是 `display: none`。
- 把外壳 `data-mood` 改成 `error`，仍有 3 个动画：两只翅膀与错开节奏元素的 transition（`transition-delay` 写死毫秒）。

## 复现

1. `CLIENT_PORT=3041 API_PORT=8042 COLLAB_PORT=8043 pnpm dev:verify`
2. 用 Playwright 新建 context 并设 `reducedMotion: 'reduce'`，打开 `/login`，枚举 `getAnimations({ subtree: true })`，打印每项的 `animationName` / `transitionProperty` 和目标类名。

## 根因

1. 减弱档的兜底写的是 `@media (prefers-reduced-motion: reduce) { .xz-auth * { animation: none } }`，特异性 (0,1,0)。以下规则都高于它，写在后面也压不住：
   - `.xz-falling path { animation }`：(0,1,1)
   - `[data-mood="error"] .xz-bird-head-fx { animation }` 这类情绪规则：(0,2,0)
2. 时长 token 在减弱档归零，但 `.xz-bird-wing-r { transition-delay: 50ms }` 这类写死的 delay 不归零。transition 是否生成看的是「时长 + 延迟」，0ms + 50ms > 0，所以照样生成。

## 修复

- 媒体查询里的兜底改为 `:root .xz-auth *`，特异性 (0,2,0)，与情绪规则相同。规则放在 `auth.css` 末尾，靠源码顺序胜出。`:root[data-motion="reduce"] .xz-auth *` 本身是 (0,3,0)，不用改。
- 落叶的动画声明只写在 `:root[data-motion="rich"] .xz-falling path` 下。系统减弱时再用 `:root[data-motion="rich"] .xz-auth .xz-falling { display: none }`（0,4,0）收起。
- 错开用的 delay 改成随 token 计算：`calc(var(--xz-dur-fast) * 0.4)`，减弱档自然归零。
- 通则：给装饰组件写减弱档兜底时，先数清组件里最高的动画规则特异性，并把兜底放在文件最后。**任何 delay 都不要写死毫秒。**

## 验证

- `e2e/auth-bird.spec.ts`「REQ-UI-043 系统减弱动效」：idle 与 `data-mood=error` 两种状态下，`getAnimations()` 都是 0；「?」静态可见（opacity 1）。
- `src/client/__tests__/bird-mood.test.ts` 的 REQ-UI-043 条：断言 `auth.css` 含两处减弱档兜底和 rich 落叶，且不含 `will-change` / `backdrop-filter`。
