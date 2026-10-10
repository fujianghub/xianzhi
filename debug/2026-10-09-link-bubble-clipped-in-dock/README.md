# 链接「编辑」表单被遮挡：伸出视口、被详情坞裁剪、坞被横向滚走、压在侧栏下

- 日期：2026-10-09
- 影响范围：client
- 严重度：medium
- 相关：ADR-0056 §B；REQ-LINK-010（ADR-0055 / REQ-LINK-009 的链接气泡）

## 症状

在记录详情坞 / 任务详情坞（列表点开的「预览」）或记录整页里，光标点进链接、气泡点「编辑」后：显示文字 / 链接地址输入框或「保存」看不见；详情坞正文整体左移、左边被切掉一截；整页里链接靠左时气泡左半边压在侧栏下面。

## 复现

1280×800，写十几行后在末尾放一个网址：
1. 整页：把链接滚到视口底部，点链接 →「编辑」→ 表单从 y=766 长到 878，超出视口；气泡 left=167，被侧栏（0 ~ 240）盖住。
2. 详情坞：同上 → 表单底部超出；坞 `scrollWidth` 634 > `clientWidth` 415，点「编辑」后 `scrollLeft` = 44。

## 根因

`LinkBubble` 用 Tiptap `BubbleMenu` 默认配置：
- `strategy: absolute`、挂在 `view.dom.parentElement` 里 → 受详情坞 `overflow: auto` 裁剪；工具条 513px 宽于坞，撑出横向可滚区域，`input.select()` 聚焦时浏览器把坞横向滚过去。
- 插件只在选区 / 文档变化、window 滚动 / 缩放时重算位置；切到编辑表单只是 React 内容变高，不会重新 flip，表单沿着原来的「下方」位置往下长。
- `.xz-link-bubble` 没有 z-index，shift 也没有边界（`BubbleBar` 早已设 `boundary: 纸面` + z-dropdown，`LinkBubble` 没跟上）。

## 修复

- `strategy: fixed` + `appendTo` 专用容器（body 下；在 Radix 弹窗里则挂弹窗内，避开焦点锁），z = dropdown。
- flip / shift / hide 用可推导参数，边界 = 所在 `.xz-reading` / `.xz-detail-dock` / 弹窗，顶部让出顶栏。
- `editing` / 紧凑切换后派发 `setMeta('linkBubble', 'updatePosition')`；capture 监听内部容器滚动（rAF 节流）重新定位。
- 区域 < 560px 只留图标（坞内工具条 513 → 243px）。

## 验证

- e2e `e2e/link-edit.spec.ts` REQ-LINK-010：整页与详情坞底部链接点「编辑」，表单在视口与纸面 / 坞内、位于链接上方、四角 `elementFromPoint` 都命中气泡；坞 `scrollLeft = 0`；坞内 `data-compact`；改文字保存成功。
- 回归：REQ-LINK-009 / REQ-TASK-049（任务描述失焦保存）、dock-copy-links、editor-toolbar 通过。
