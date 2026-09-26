# ADR-0014 我的记录：位置导航、标签自定义、收藏 / 最近、批量、看板与时间线

> 状态：已采纳 · 2026-09-26 · 修订 02 §9 标签权限（`tag.manage` 由「仅 owner / admin」改为「管理员或创建者」）；其余为新增。

## 背景

「我的记录」（`/entries`）只有类型 / 作者 / 标题筛选，与空间目录（ADR-0012）脱节：看不出记录在哪个空间、哪一页之下，也不能按目录定位；标签只能在 TagPicker 里输入即建，颜色按名字散列、不能改，也没有统一管理处；单篇操作（归档、导出、删除）散在命令面板里，没有批量；Bug 与迭代只有卡片 / 表格两种看法。

用户选择（2026-09-26）：左侧导航 + 右侧列表；标签管理页 + 选色 + 筛选；标签权限 = 管理员与创建者；另要 ⋯ 菜单（删除 / 归档 / 导出）、批量、最近打开 + 收藏、Bug 看板 / 迭代时间线。

## 决定

1. **位置导航**（REQ-ENTRY-012）：`/entries` 左栏 = 全部 · 最近打开 · 收藏 · 已归档 · 个人随笔，其下 大类 → 空间 → 目录树（空间展开时才请求 `GET /spaces/:id/tree`）。选中项写入 URL，互斥：`spaceId` / `under`（目录子树，含节点本身）/ `groupId`（`none` = 未分类）/ `favorite=1` / `recent=1` / `archived=1`。空间记录页签内左栏只列本空间的「全部 / 已归档」与目录。窄屏折叠为「选择位置」按钮。
   - 列表每项带 `path`（根 → 父页的可读祖先，读不到的祖先截断）与 `favorited`；卡片 / 表格 / 看板显示路径。
   - 最近打开沿用本机 `localStorage xz:recent`，以 `ids=` 取回并按访问顺序排；收藏为个人数据，新表 `entry_favorites(user_id, entry_id)`。
   - 在目录节点下点「新记录」= 作为该页子页创建；属性页新增「目录位置」（不在目录 / 顶层 / 某页之下，放到末尾）；在目录里的记录换空间前确认（会移出目录）。
2. **标签自定义**（REQ-TAG-004 ~ 006）：`tags.created_by`；`tag.manage` = owner / admin，或非 guest 的创建者（历史标签 `created_by` 为空，只有管理员能管）。`GET /tags` 每项带 `canManage`。新增 `POST /tags/:id/merge { intoId }`（关联并入目标、去重、删源）。`/settings/tags` 管理页：新建选色、改名、改色、合并、删除、用量、查看记录。TagPicker 创建行可改色。记录页与搜索页标签多选筛选（`tag=a,b` 任一命中；`/search` 的 `tag` 同步改为多值）。
3. **⋯ 菜单**（REQ-ENTRY-014）：详情页页头与卡片悬停：收藏 · 固定 · 导出 Markdown / HTML · 归档 / 取消归档 · 删除（确认；Toast「撤销」= restore）。导出改为 POST 取回 Blob 下载（原命令面板 `location.href` 是 GET，接口只挂了 POST，一并修正）。
4. **批量**（REQ-ENTRY-013）：`POST /entries/batch`，`op = move | tags | archive | unarchive | delete`，≤ 100 条；逐条走既有 service（鉴权 / 审计 / 失效与单条一致），单条失败不回滚其它条，返回 `{ ok, failed[{id, code, message}] }`。界面：「多选」模式（`select=1`），吸底操作条；失败项保持选中。
5. **看板 / 时间线**（REQ-ENTRY-015）：只选一种带 `status` 枚举的类型（Bug / 优化 / 决策 / 学习计划）时可切「看板」，列 = status 定义顺序，拖到另一列 = PATCH `fields.status`（整份 fields + ifUpdatedAt）；只选 迭代 / 变更 时可切「时间线」，按 `periodStart` / `releasedAt` 倒序、按月分组。`view = table | board | timeline`。

## 候选与否决

- 顶部面包屑下拉代替左栏：层级深时不可见全貌——用户选左栏。
- 标签仅管理员可管：成员自建标签无法纠错——用户选「管理员与创建者」。
- 收藏存 localStorage：跨设备丢失——改为服务端个人表；「最近打开」仍在本机（高频写入，不值得落库）。
- 批量做成事务整体回滚：一条无权即全部失败，体验差——改为逐条。

## 后果

- 迁移 0012：`tags.created_by`、`entry_favorites`。
- 00：+REQ-ENTRY-012 ~ 015、REQ-TAG-004 ~ 006；01 §3.7 / §3.4a / §5；02 §9 路由 +4、标签权限注；08 §1 +`/settings/tags`、§2.8 · §2.11 search params。glossary +收藏、最近打开、位置导航、批量、看板（记录）、时间线。
