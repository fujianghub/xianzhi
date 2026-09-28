# ADR-0023 模板编辑与工作区共享

> 状态：已采纳 · 2026-09-28 · 修订 ADR-0011 §2「工作区模板仅管理员可建」；补充 01 §3.4b / §5、02 §9 `/templates`、08 §2.13 设置 → 模板。

## 背景

ADR-0011 的自定义模板只有一条路：写一篇记录 → 属性 → 另存为模板；存下以后只能改名、删掉，正文、说明、适用空间都改不了。想分享给别人用，要找管理员把它提升为「工作区模板」。用户的诉求是「自己定义模板、保存，并公开分享，其他人也可以使用」。

## 决定

1. **分享范围 = 工作区内共享**（用户 2026-09-28 选定）：不做匿名公开链接（00 §0 非目标「公开访问、匿名可读页面」不变）。沿用 `scope = workspace`，界面称「共享模板」「共享给工作区成员」。
2. **谁能共享**（REQ-TPL-006）：`template.create` 对 workspace 范围由「仅 owner / admin」放宽为「非 guest」；个人 → 共享、共享 → 个人都走 `PATCH scope`。`template.manage` 不变：作者（非 guest）管自己的，管理员可管全部共享模板。guest 可读、可用共享模板，不能建 / 共享。列表返回 `canShare`（前端不比较角色，不变量 2）与每行 `ownerName`（作者，账号已删为空串 → 「已删除的用户」）。
3. **直接编辑**（REQ-TPL-007）：`POST /templates` 可直接给 `body + kind`（已有），设置 → 模板新增「新建模板」页与「编辑」页；`PATCH /templates/:id` 增 `body` / `kind` / `fields`，并**必须带 `ifUpdatedAt`**（共享后作者与管理员可能同时改，不匹配 409 `CONFLICT_STALE` + `current`）。只改 kind 不给 fields → fields 重置为该 kind 默认；fields 按「新 kind ?? 原 kind」严格校验。
4. **模板编辑器**：非协同 Tiptap（`schemaKit` + `UndoRedo`），模板正文是 PM JSON 种子，不是 `entries.ydoc`，不触碰不变量 1。斜杠菜单去掉依赖记录 / ydoc 的项（图片、附件、记录卡片、记录链接、源码、模板）；粘贴文件提示「模板不能带附件」；`Mod-s` 保存模板；未知节点用 `wrapUnknownPm` / `unwrapUnknownPm` 原样保留。占位符 `{{date}} {{user}} {{space}}` 提示文字取代码常量（i18next 会吃掉 `{{…}}`）。
5. **复制到我的**（REQ-TPL-008）：`POST /templates { fromTemplateId }`（body / fromEntryId / fromTemplateId 三选一）：内置或可见模板 → 新的个人模板，默认名「<原名> 副本」；看不到的模板 404。
6. **空间默认模板随之清理**（REQ-TPL-009）：`spaces.default_template_id` 无外键；共享模板改回个人或被删除时，同事务把引用它的空间默认模板置空并推进这些空间的 `updated_at`（打开着的「编辑空间」对话框会 409，而不是把悬空 id 再写回去）。列表每行给 `spaceDefaults`（被多少空间用作默认），取消共享 / 删除前确认框写明数量。
7. **站内分享链接**：模板行「复制链接」→ `/settings/templates?preview=<id>`，打开即预览；仍需登录且同工作区可见（不是公开链接）。
8. 另存为模板对话框加「说明」与「共享给工作区成员」勾选（`canShare` 时显示）。

## 候选与否决

- **匿名公开链接 `/t/<token>`**：需要推翻 00 §0 非目标、新增公开路由、限流、撤销与正文脱敏；用户选择只在工作区内共享。
- **新增 `shared` 第三种范围**：与 `workspace` 语义重叠，还要迁移 check 约束；直接放宽 workspace 的创建权限更简单。
- **模板正文也走 Yjs 协同**：模板改动频率低、通常一人维护；乐观锁足够，免去 collab 文档类型扩展。
- **删模板时拒绝（被空间引用）**：会逼用户先去逐个空间改默认；改为确认 + 自动清理。

## 后果

- 00：REQ-TPL-004 加「改于」注；+REQ-TPL-006 ~ 010。01 §3.4b scope 说明、§5 权限矩阵 template.create 行。02 §9 `/templates` 行。08 §1 路由表、§2.13 注。glossary +共享模板。
- 代码：`authz.ts`、`services/templates.ts`、`shared/schemas/templates.ts`；前端 `_app.settings.templates.tsx`、`_app.settings.templates_.new.tsx`、`_app.settings.templates_.$templateId.tsx`、`TemplateForm`、`editor/TemplateEditor.tsx`、`slash.tsx`（`exclude`）、`EntryAside` 另存为模板。
- 已知限制：模板正文里的图片仍指向来源记录的附件，别人未必有权读（与 ADR-0011 相同，未改）。
- 测试：`templates.test.ts`（REQ-TPL-006 ~ 009）、`authz.test.ts` 矩阵、`e2e/templates-share.spec.ts`（REQ-TPL-010）。
