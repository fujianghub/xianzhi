# ADR-0002 视觉风格改为 Apple 玻璃（日场 / 夜场）

> 状态：已采纳 · 2026-09-23 · 部分取代 ADR-0001 §9.3「设计稿」行与 `04-design-system.md` §1 的「不复制简斋的玻璃态」。
> 完整规范：`spec_dev_doc/06-visual-style.md`。

## 背景

ADR-0001 §9.3 与 `04` §1 曾规定「避免复制简斋的玻璃态」，理由是与简斋拉开品牌距离。用户于 2026-09-23 明确要求：前端样式模仿简斋的 Apple 玻璃风格并深度美化，提供亮、暗两种主题。

## 候选方案

| 方案 | 优点 | 缺点 |
|---|---|---|
| A. 维持 `04` 原案：暖纸感实色面板，无玻璃 | 实现最简、性能最好 | 不符合用户明确要求；与简斋后台观感断裂 |
| B. 全盘照搬简斋 `.jz-glass`：每张卡片都 blur、六主题、随时辰 | 复用度最高 | 虚拟列表内大量 `backdrop-filter` 拖垮移动端；六主题维护面翻倍；AntD 覆盖层的 `!important` 与本项目不变量 5 冲突 |
| **C. 玻璃只用于 chrome，正文与列表为不透明纸面；两主题** | 保留 Apple 玻璃观感与简斋配方；性能可控；token 全挂 `:root` 无作用域坑 | 需要维护一套预合成实色（改底色须重算） |

## 决定

采用方案 C：

1. 视觉材质采用 **macOS / iOS 式分层毛玻璃**：实色底板 + 三处固定光晕 + 四级半透明玻璃 + 顶缘棱线 + 无色柔阴影。
2. **只有两种主题**：`light`（日场）/ `dark`（夜场），默认跟随系统。不引入简斋的星空 / 深海 / 春水 / 冬雪与「随时辰」。
3. 品牌色不变：仍是 `04` 的苔绿主色 + 琥珀强调色 + 暖中性色；与简斋的翡翠重音区分开。品牌隐喻（乐章 / 间奏）与 `04` §1 的克制原则保留。
4. **正文与列表是不透明纸面，玻璃只用于 chrome**（顶栏、侧栏、浮层、面板）。
5. 全部 token 挂 `:root` / `[data-theme]`，不做类作用域；禁止 `!important`（不变量 5 不变）。

## 后果

- `04-design-system.md` §2.1 中 `--gi-bg / surface / surface-2 / border` 的值由 `06` §3 覆盖；§2.3 阴影命名改为 `06` 的 `soft / card / float`；§2.4 新增 `--gi-ease-spring`。其余语义色、字体、间距、动效档位、布局、组件层次不变。
- Phase 0 增加：玻璃 token 与工具类、底板光晕、View Transition 主题切换、`/design` 材质 / 深度 / 切换三页、`scripts/check-css.ts` 与 `check-contrast.ts`。工时约 +1 天。
- 性能预算新增：同屏 `backdrop-filter` ≤ 6、blur ≤ 28px、虚拟列表内禁 blur（`06` §8）。
- 带色阴影、噪点纹理、动态光晕明确不做，避免工作台变成海报。

## 参考

- 简斋 `frontend/src/styles/tokens.css`、`theme.css`（`.jz-glass` 体系、View Transition 圆形揭幕、`linear()` 弹簧）
- Apple Human Interface Guidelines · Materials：https://developer.apple.com/design/human-interface-guidelines/materials
