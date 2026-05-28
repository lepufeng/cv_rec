# CV Rec Web

简洁的简历解析平台前端，包含用户与管理员两套界面。

> 项目级文档入口见仓库根目录 `DOCS.md`；当前后端/插件数据契约见 `SCHEMA.md`。

## 技术栈

- React 18 + TypeScript + Vite
- Tailwind CSS
- React Router v6
- Zustand (auth state)

## 路由

| Path | 角色 | 说明 |
|---|---|---|
| `/login` | 公开 | 登录 / 注册（首位用户自动成为管理员） |
| `/profile` | 用户 | 简历预览（卡片化分区，支持字段级修正） |
| `/upload` | 用户 | 拖拽上传简历，同步等待解析 |
| `/admin/stats` | 管理员 | 平台总览：用户数、成本、按模型/阶段分布 |
| `/admin/models` | 管理员 | 模型 Provider 切换 + API Key 配置 + 连通性测试 |
| `/admin/users` | 管理员 | 用户列表 + 简历数 + 累计成本 |

## 本地开发

```bash
# 1. 后端先启动（在仓库根目录）
uvicorn app.main:app --reload --port 8000

# 2. 启动前端
cd web
npm install
npm run dev
# 默认 http://localhost:5173
```

Vite 已配置 `/api/*` 代理到 `127.0.0.1:8000`，无需 CORS 折腾。

## 构建产物

```bash
npm run build
# 产物输出至 web/dist/
```

## 设计风格

参考 simplify.jobs 的简洁工作流：
- 浅色背景（`#f8fafc`），白色卡片，柔和阴影
- 单一主色（indigo）+ 大量灰度层次
- Inter 字体（中文回落到 PingFang SC / Microsoft YaHei）
- 去除多余装饰，聚焦内容与可读性
