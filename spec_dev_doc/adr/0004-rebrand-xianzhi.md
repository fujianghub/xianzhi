# ADR-0004 品牌更名：生长间奏 → 衔枝（Xianzhi），内部前缀 gi → xz

> 状态：已采纳 · 2026-09-24 · 取代 ADR-0001 与 04 §1 中的品牌名「生长间奏 / Growing Interlude」及音乐隐喻；ADR-0001 其余决定不变。

## 背景

用户决定把产品名改为「衔枝」（xián zhī），寓意燕子衔枝筑巢，一点一点搭建自己的东西。旧名的音乐隐喻（乐章 / 声部 / 间奏 / 音符）与新寓意不符。仓库根目录与所有内部标识同步更名。

## 决定

1. **品牌**：中文「衔枝」，英文 `Xianzhi`；根目录 `XianZhi`，包名 / 镜像名 `xianzhi`。
2. **内部前缀 gi → xz 全量替换**（用户选择）：CSS token `--xz-*`、类名 `xz-*`、存储键 `xz:*`、正文协议 `xz:attachment/`、链接协议 `xz://`、API Key 前缀 `xz_`、Cookie 前缀 `xz`、环境变量 `XZ_*`、数据库 `xz / xz_test / xz_e2e / xz_verify`、容器 `xz-dev-* / xz-app / xz-collab`、CLI `pnpm xz`、outbox 函数 / 通道 `xz_events_notify / xz_outbox`。
3. **数据迁移**：`pnpm xz migrate-prefix`（幂等）改写正文 ydoc 的图片 src 与链接 href、任务描述 / 评论 JSON、工作区名称与 slug，并把旧 outbox 触发器换成 `xz_*`。已有迁移文件 0002 / 0005 的文本同步改名（drizzle 只按时间戳判定是否已执行，改文本不会重跑）。
4. **开发库切换无损**：在原集群内 `ALTER DATABASE … RENAME` 与新建 `xz` 超级用户；数据卷（`data/pg`）不变，旧容器 `gi-dev-*` 停用不删除。
5. **隐喻改为筑巢**（glossary §2、04 §1）：空间 = 巢（界面仍叫「空间」）、任务 = 枝、周期 = 程（季度 = 长程）、复盘 = 回望、里程碑动效 = 成巢；Logo 为衔枝的燕子。

## 后果

- 浏览器本地数据随前缀更名失效一次：登录 Cookie、主题 / 密度偏好、最近访问、正文 IndexedDB 缓存（服务端正文不受影响）。
- 旧 `gi_` 开头的 API Key 按哈希校验仍可使用；新建的 Key 为 `xz_` 前缀。
- 历史记录（CHANGELOG 旧条目、ADR-0001 ~ 0003、`debug/`）保持原文，不回改。
- `infra/ci/ci.yml` 草稿与 `CLAUDE.md` 中的旧名待用户确认后修改（红线 / 文档约定）。
