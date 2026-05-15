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

## 常用命令

```bash
# 本地开发
npm run dev

# 检查代码和生产构建
npm run check

# 构建后部署到腾讯云 CloudBase Hosting
npm run deploy:tcb
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
- 按月份、类型、分类筛选。
- 自动计算收入、支出和结余。
- 导出当前筛选结果为 CSV。

## 数据同步

每条账单会保存当前登录用户的 `user_id`。同一个邮箱账号在手机和电脑登录后，会同步到同一本账。
