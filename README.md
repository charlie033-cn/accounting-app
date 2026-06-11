# 记账 Web App

一个使用 React、Vite、TypeScript 和腾讯云 CloudBase 构建的轻量记账应用。支持邮箱注册登录、多设备同步、收支记录、月度统计、分类筛选和 CSV 导出。

## 线上地址

腾讯云 CloudBase Hosting：

https://test-d3g2xaivpb160ef4f-1323111038.tcloudbaseapp.com

## 本地启动

```bash
npm install
cp .env.example .env.local
npm run dev
```

本地默认地址通常是：

```text
http://127.0.0.1:5173/
```

## CloudBase 配置

当前使用的 CloudBase 环境 ID：

```text
test-d3g2xaivpb160ef4f
```

新设备 clone 项目后，需要复制 `.env.example` 为 `.env.local`。`.env.local` 不要提交到 GitHub。

腾讯云控制台需要确认：

1. 已创建 CloudBase 环境 `test-d3g2xaivpb160ef4f`。
2. 已开启身份认证里的邮箱登录，并配置发信邮箱。
3. 已创建数据库集合 `transactions`。
4. `transactions` 集合已配置读写权限。
5. 已创建数据库集合 `budgets`（字段示例：`user_id`、`period` 如 `2026-05`、`monthly_amount` 数字、`created_at`、`updated_at`），并为当前登录用户配置与 `transactions` 类似的读写权限（仅本人数据）。
6. 已创建数据库集合 `recurring_templates`（字段示例：`user_id`、`name`、`amount`、`category`、`day_of_month`、`start_period`、`duration_months`、`status`、`created_at`、`updated_at`），权限规则与 `transactions` 一致。
7. 已创建数据库集合 `user_category_lists`（每用户一条文档：`user_id`、`expense` 与 `income` 为字符串数组、时间戳），权限与 `transactions` 一致；用于「我的 → 分类管理」同步自定义分类。未创建时应用使用内置默认分类列表。
8. 已创建数据库集合 `monthly_ai_reports`（字段示例：`user_id`、`month`、`report_version`、`fingerprint`、`report`、`created_at`、`updated_at`），权限与 `transactions` 一致；用于复用同月未变化账单的 AI 消费报告，减少重复 Token 消耗。
9. 已创建数据库集合 `personal_assets`（字段示例：`user_id`、`name`、`type`、`status`、`amount`、`purchase_date`、`note`、`created_at`、`updated_at`），权限与 `transactions` 一致；用于「更多功能 → 我的家当」记录资产和日均成本。
10. `transactions` 中周期自动记账可选字段：`source`、`recurring_template_id`（需在控制台为查询条件建索引时按 CloudBase 文档配置）。

## 小票识别（TokenHub，可选）

1. 在 TokenHub 创建 **API Key**。
2. 云开发控制台 → **云函数** → 新建函数 `parseReceiptTokenhub`（与代码中名称一致），或将仓库内 `cloudfunctions/parseReceiptTokenhub` 用 CLI 部署：
   - 本地已登录：`npm run deploy:fn-receipt`
3. 在该云函数的 **环境变量** 中配置 **`TOKENHUB_API_KEY`**（必填）。可选：`TOKENHUB_MODEL`（默认 `youtu-vita`）、`TOKENHUB_BASE_URL`（默认 `https://tokenhub.tencentmaas.com/v1`）。
4. 确认云函数 **运行角色** 可访问外网（调用 TokenHub HTTPS）。
5. 重新部署静态站点后，在「记账」页使用 **识别小票图片**；密钥不会出现在前端。

## 账单导入 AI 分类兜底（TokenHub，可选）

账单导入会先使用内置规则自动分类；仍为「其他」的记录可调用 TokenHub 云函数补充分类，用户界面不额外展示 AI 标识。

1. 云开发控制台 → **云函数** → 新建函数 `classifyTransactionsTokenhub`，或将仓库内 `cloudfunctions/classifyTransactionsTokenhub` 用 CLI 部署：
   - 本地已登录：`npm run deploy:fn-classify`
2. 在该云函数的 **环境变量** 中配置 **`TOKENHUB_API_KEY`**（可复用小票识别函数的 Key）。可选：`TOKENHUB_MODEL`（默认 `deepseek-v3.1-terminus`）、`TOKENHUB_BASE_URL`（默认 `https://tokenhub.tencentmaas.com/v1`）。
3. 确认云函数 **运行角色** 可访问外网（调用 TokenHub HTTPS）。

## 消费报告生成（TokenHub，可选）

报表页会先展示本地统计报告；用户点击「生成报告」后，可调用 TokenHub 生成更自然的消费复盘。界面不展示 AI 标识，失败时保留本地报告。

1. 云开发控制台 → **云函数** → 新建函数 `generateSpendingReportTokenhub`，或将仓库内 `cloudfunctions/generateSpendingReportTokenhub` 用 CLI 部署：
   - 本地已登录：`npm run deploy:fn-report`
2. 在该云函数的 **环境变量** 中配置 **`TOKENHUB_API_KEY`**（可复用小票识别函数的 Key）。可选：`TOKENHUB_MODEL`（默认 `hunyuan-lite`）、`TOKENHUB_BASE_URL`（默认 `https://tokenhub.tencentmaas.com/v1`）。
3. 确认云函数 **运行角色** 可访问外网（调用 TokenHub HTTPS）。

## 常用命令

```bash
# 本地开发
npm run dev

# 检查代码和生产构建
npm run check

# 构建后部署到腾讯云 CloudBase Hosting
npm run deploy:tcb

# 部署云函数 parseReceiptTokenhub（需先 tcb login，且已配置函数环境变量 TOKENHUB_API_KEY）
npm run deploy:fn-receipt

# 部署云函数 classifyTransactionsTokenhub（需配置 TOKENHUB_API_KEY）
npm run deploy:fn-classify

# 部署云函数 generateSpendingReportTokenhub（需配置 TOKENHUB_API_KEY）
npm run deploy:fn-report
```

如果在新设备上第一次部署，需要先登录腾讯云 CloudBase CLI：

```bash
npx -p @cloudbase/cli@latest tcb login
```

## 从 GitHub 继续开发

1. clone 仓库到新设备。
2. 运行 `npm install`。
3. 复制 `.env.example` 为 `.env.local`。
4. 运行 `npm run dev` 本地预览。
5. 修改完成后运行 `npm run check`。
6. 确认无误后运行 `npm run deploy:tcb` 发布到腾讯云。

```bash
cp .env.example .env.local
```

## 功能

- 邮箱注册、登录、退出。
- 新增、编辑、删除收入和支出。
- 底部导航四 Tab：记账、账单、更多功能、我的。
- 周期记账规则（对齐月末、打开应用时自动补记当日流水）；完整按日触发建议配合云函数。
- 月度「支出总预算」：按当月天数折算日均参考，展示今日支出占日均比例与本月累计占预算比例（与列表筛选无关）。
- 自动计算收入、支出和结余。
- 账单 Tab：按日 / 月 / 年查看，类型与分类筛选，导出 CSV。
- 可选：「记账」页 **识别小票图片**（需部署云函数并配置 TokenHub API Key，见上文「小票识别」）。

## 数据同步

每条账单会保存当前登录用户的 `user_id`。同一个邮箱账号在手机和电脑登录后，会同步到同一本账。
