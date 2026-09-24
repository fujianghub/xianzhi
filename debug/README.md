# debug/ —— 踩坑记录

每个条目一个目录：`debug/YYYY-MM-DD-<slug>/README.md`，可附截图、日志、复现脚本。性能报告放 `debug/perf/`，部署记录放 `debug/deploys.md`。
二期起（Phase 3）这些条目优先写入应用 `Entry(kind=bug)`，本目录由 `pnpm gi export` 生成。

## 模板

```markdown
# <一句话标题>

- 日期：YYYY-MM-DD
- 影响范围：client / server / collab / infra
- 严重度：low | medium | high | critical
- 相关：commit / Entry 链接 / ADR

## 症状
用户或开发者看到了什么（报错原文、截图）。

## 复现
最小步骤；能用脚本就给脚本。

## 根因
为什么会这样；引用代码位置 `path:line`。

## 修复
改了什么；为什么这样改而不是别的。

## 验证
怎么证明修好了（测试名、命令、截图）；有没有回归风险。
```

五段标题必须与 `03-editor-kernel.md` §6 的 bug 模板一致（症状 / 复现 / 根因 / 修复 / 验证），二期 `debug/` 导入依赖此结构。
