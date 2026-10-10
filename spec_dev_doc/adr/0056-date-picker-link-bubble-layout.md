# ADR-0056 日期属性改用月历选择器 · 编辑器浮层改为 fixed（链接气泡 / 表格工具条 / 斜杠与 @ 候选）

> 状态：已采纳 · 2026-10-09 · 修订 ADR-0035 §B（日期属性「选中即保存」的原生日期框 → 月历选择器）、ADR-0055 §1（链接气泡的定位与挂载）、ADR-0016（日历快速编辑里任务的日期 / 时间）、ADR-0025 §4（表格工具条定位）。无迁移。需求区 00：REQ-ENTRY-042、REQ-LINK-010、REQ-CAL-014、REQ-MOBILE-008、REQ-EDITOR-036。

## 背景

用户（2026-10-09）：「Bug 这里日期怎么点击更改不了」「点击预览后链接的编辑框经常被遮挡」。实测（3011 · Playwright）：

1. **日期**：`FieldEditor` 的日期分支是原生 `<input type="date">`，`onChange` 有值即提交并关弹层。Chrome 的日期框按年 / 月 / 日分段编辑，**每改一段就触发一次 change**——按一次 ↓ 就把月份改了并关掉；键入年份连发多次 PATCH，最后存进 `0005-02-02`（服务端 `isoDate` 只校验格式，照收）。只有点右侧 55% 透明的小日历图标才能正常选。所有日期属性（属性面板、表格单元格、详情坞、模板元数据）都受影响。另：Bug 发现日期选未来 → 422，值回弹，用户也感知为「改不了」。
2. **链接气泡**（`LinkBubble`，Tiptap `BubbleMenu`）：
   - 切到「编辑」表单（36 → 112px 高）不重新定位：靠下的链接表单伸出视口，输入框与「保存」不可见；
   - `absolute` 挂在编辑器父节点里：在详情坞（`overflow-y: auto`）内被裁剪；工具条 513px 宽于坞（415px），撑出横向滚动，聚焦输入框时坞被横向滚走约 44px，正文左侧被切掉；
   - 没有 z-index、shift 没有边界：整页里链接靠左时气泡伸进侧栏下方，被侧栏盖住。

## 决定

### A. 日期属性用月历选择器（REQ-ENTRY-042）

1. `FieldEditor` 日期分支改用 `DateFieldPicker`：快选（昨天 · 今天 · 明天）+ 月历（复用 `MiniMonth`，翻月）+ 文本框 + 清空。**点日期即提交**；文本框只在回车时按完整日期提交（`YYYY-MM-DD`，也认 `/` `.`，一位月日补零），逐键输入不提交、不关弹层，半截 / 越界回车给就地提示。不再用原生日期框。
2. 可选范围：`entryFields.dateBounds(kind, name, fields, today)` 由已有的日期先后约束推出（Bug 发现 ≤ 解决、迭代 / 计划开始 ≤ 结束），Bug 发现日期另加 ≤ 今天（与 `normalizeBugFields` 同规则）。越界日期在快选与月历里置灰。属性面板与表格单元格传入；模板元数据不传（模板不带 Bug 日期）。
3. `MiniMonth` +`isDisabled`（可选），日期格 +`data-date`。
4. 服务端兜底：共用 `isoDate` 加年份范围 1900 ~ 2999（422「日期超出范围」），挡住任何来源的半截年份。

### B. 链接气泡改为 fixed 浮层（REQ-LINK-010）

5. 气泡 `strategy: fixed`，经 `appendTo` 挂到 body 下的专用容器；编辑器在 Radix 弹窗（`[role=dialog]`）里时挂到弹窗内（模态 Sheet 有焦点锁，挂到外面输入框拿不到焦点）。用专用容器而不是直接挂 body：插件失焦判断按「容器是否包含新焦点」，容器只含气泡才不误判。
6. `.xz-link-bubble` 设 `z-index: var(--xz-z-dropdown)`，压过侧栏 / 详情坞 / 吸顶格式栏。
7. flip（回退到上方）/ shift / hide 的边界 = 所在 `.xz-reading` / `.xz-detail-dock` / 弹窗（floating-ui 可推导参数，每次定位现取），顶部让出顶栏。
8. 内容尺寸变化（工具条 ⇄ 编辑表单、紧凑切换）后派发 `setMeta('linkBubble', 'updatePosition')` 重新定位；任意内部滚动容器滚动（capture，rAF 节流）时同样重新定位（插件自己只听 window）。
9. 所在区域窄于 560px（详情坞、任务描述）时按钮只留图标，文字进 `title` 与读屏（`data-compact`）；编辑表单输入框宽度随视口收缩。

### C. 日历快速编辑里的任务日期 / 时间（REQ-CAL-014）

10. 同类排查（2026-10-09）发现日历快速编辑气泡里任务的日期 / 时间也是原生框 + `onChange` 即 PATCH：按一下 ↓ 截止就挪到上个月、任务从当前视图消失；逐段键入年份会写进 `0002-…`（`dueAt` 用 `isoDateTime`，A.4 的年份限制管不到）。
11. 日期改为按钮 + 嵌套弹层里的 `DateFieldPicker`（不能清空：清空就从日历上消失），点日期才保存；嵌套弹层拦下按键冒泡——气泡把非输入框里的 Delete / Backspace 当「删除任务」，日期格上按 Backspace 不能删掉任务。时间改为草稿，失焦 / 回车 / 关闭气泡时保存。
12. 服务端 `isoDateTime` 同 `isoDate` 限年份 1900 ~ 2999。

### D. 斜杠与 @ 候选框（REQ-MOBILE-008）

13. 候选框原先 `fixed` 挂在 body 下。< lg 的任务详情是**模态** Sheet：Radix 给 body 设 `pointer-events: none`，挂在 body 下的候选框继承它，**点 / 触都穿透到下面的编辑器**，只能用键盘选（任务评论的 @）。改为与链接气泡同一套挂载：编辑器在弹窗里时挂到弹窗内（`floating.ts` `suggestionPopup`）；flip / shift 边界 = 所在纸面 / 坞 / 弹窗；用 floating-ui `autoUpdate` 随内部容器滚动跟随（原先只在输入变化时定位，滚动坞时会与光标脱节）。

### E. 表格工具条（REQ-EDITOR-036）

14. 与改前的链接气泡同病：`absolute` 挂在编辑器父节点、无边界、外层无 z（`fixed` 外层自成层叠上下文，z 必须设在外层，统一用 `.xz-float-menu`）。改为 `useFixedMenu`（`floating.ts`，链接气泡同用）。
15. 工具条约 390px，最窄的详情坞（320px）放不下：显示时按所在区域宽度设 `max-width` 并换行，尺寸变了重新定位。
16. 参照原为整张表格：长表格顶部滚出可视区时工具条会被 flip 到表格底部（屏幕外）。参照改为「表格在可视区内的部分」（顶边至少在可视区顶部以下「工具条高 + 间距」），工具条停在可视区顶部；整张表滚出时交给 hide 隐藏。

## 候选与否决

- **日期：保留原生框、改为失焦 / 回车提交**：改动最小，但原生框的分段编辑与日场 / 夜场风格割裂，选择体验仍差；月历组件项目里已有（任务截止日），复用成本低。
- **日期：引入日期选择库**：首屏预算紧（241 / 250 KB），`MiniMonth` 已够用。
- **气泡：只照抄 BubbleBar 的 shift 边界 + z-index**：解决侧栏遮挡，但仍在坞内被裁剪、撑横向滚动，不解决「编辑框伸出视口」。
- **气泡：直接 `appendTo: document.body`**：插件失焦判断会把页面上任何元素都当作「气泡内」，点到别的输入框气泡不消失。
- **气泡：编辑改成居中对话框**：交互变重，丢失「就地」感；fixed + flip 已足够。

## 后果

- 00：+REQ-ENTRY-042、REQ-LINK-010。
- 测试：unit `entryFields.test`（isoDate 范围、dateBounds）、`schemas.test`（isoDateTime 范围）；e2e `bug.spec`（REQ-ENTRY-042）、`link-edit.spec`（REQ-LINK-010）、`calendar.spec`（REQ-CAL-014；REQ-CAL-012 用例改为时间回车保存）、`mobile.spec`（REQ-MOBILE-008）、`floating-menus.spec`（REQ-EDITOR-036）。
- 代码：浮层公共定位抽到 `src/client/editor/floating.ts`（链接气泡、表格工具条、斜杠、@ 共用）；选区工具条 `BubbleBar` 已有纸面边界、实测在坞内无问题，未改。
- 踩坑：`debug/2026-10-09-date-field-commit-per-keystroke`、`debug/2026-10-09-link-bubble-clipped-in-dock`、`debug/2026-10-09-calendar-quick-date-commit-per-keystroke`、`debug/2026-10-09-mention-menu-unclickable-in-modal-sheet`。
- 已有数据里若有 1900 年之前的日期（如本次误存的 `0005-…`），读取不受影响；再次保存该记录的 fields 时会 422，需在属性面板改正。
