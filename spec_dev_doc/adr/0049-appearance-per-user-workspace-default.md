# ADR-0049 外观偏好随账号保存 · 工作区默认外观

> 状态：已采纳 · 2026-10-02 · 修订 ADR-0047 §1（玻璃强度「本机偏好」→ 随账号保存）、REQ-UI-001 / 011 / 028（主题 / 密度 / 动效档位「持久化到本机」→ 随账号保存、本机只作首帧缓存）、08 §2.13（个人页偏好说明、工作区页 +默认外观）。迁移 0027（`user_preferences.appearance`）。需求区 00：REQ-UI-051、REQ-WS-024。

## 背景

用户（2026-10-02）问：「偏好是基于用户永久生效吗？支持默认设置修改」。

现状：主题、密度、动效档位、玻璃强度都只存在本机 `localStorage` 里。换设备、换浏览器或清缓存就回到默认，同一账号在多台设备上也不一致；默认值写死在代码里，改不了。阅读偏好（ADR-0024）早已按人存在服务端，但外观偏好没有跟进。

## 决定

1. **随账号保存**：`user_preferences` 加 jsonb 列 `appearance`，只存用户明确选过的键（`theme` / `density` / `motion` / `glass`）。`PATCH /me/preferences` 接受 `{ appearance: { key: value | null } }`，`null` 表示删除该键、改回跟随默认。服务端按键合并：`appearance || $set - ARRAY[$removed]`。与阅读偏好一样不要求 `ifUpdatedAt`（02 §4 例外）。
2. **工作区默认外观**：存在 `organization.metadata.settings.appearance`（Better Auth 的 JSON 文本），沿用 `PATCH /workspace`（`can('workspace.manage')`，所有者 / 管理员，记审计 `workspace.settings_changed`），给 `settings.appearance` 加上字段校验。整份替换，缺的键跟随内置默认。
3. **生效值** = 内置默认（跟随系统 · 舒适 · 标准 · 流光）← 工作区默认 ← 用户值，由共享函数 `resolveAppearance` 计算。`GET /me/preferences` 返回 `appearance`（用户值）与 `workspaceAppearance`（工作区默认），由客户端合成。
4. **首帧不闪**：本机 `xz:theme` / `xz:density` / `xz:motion` / `xz:glass` 只作缓存，`theme-init.js` 照旧先按缓存应用。登录后由 `useAppearanceSync` 拉到服务端值，按生效值覆盖缓存与 `html` 属性。用户改动由 `setAppearance` 处理：本机立即生效，再 PATCH（带 `keepalive`，改完立刻刷新也不会丢）。
5. **入口**：
   - 「设置 → 个人」四项随账号保存，下拉里标出「（默认）」项，提供「恢复为工作区默认」按钮。
   - 「设置 → 工作区信息」给所有者 / 管理员编辑「默认外观」。
   - 已登录顶栏的主题切换、设计画廊的玻璃强度快捷切换，都写账号。
   - 未登录页（登录 / 注册）的主题菜单仍只写本机：此时不知道是谁。
6. **不迁移本机旧值**：不把 ADR-0049 之前的本机选择上传为账号值。新设备和共用浏览器会把上一个人或测试注入的本机值误传成账号值；e2e 共用库里会因此串号。代价是老用户的本机选择需要再选一次（个人工作台，影响很小）。

## 影响

- e2e：外观不再能靠写 `localStorage` 指定，否则登录后会被账号值覆盖。改用 `helpers.setAppearancePref` / `resetAppearance` 走 API，用完复位（xz_e2e 共用库，按人存）。夜场靠 `emulateMedia({ colorScheme })`，账号未选主题时跟随系统。
- 用户改了外观后，其他已打开的标签页要到下次拉取偏好（5 分钟或刷新）才会更新；不做实时推送。
