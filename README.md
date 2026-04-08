# 心镜（Xinjin）项目说明

心镜是一个「前后端分离」的心理状态评估与陪伴式对话项目，包含：

- `front-end`：React + Vite + TypeScript 前端，负责登录、问卷评估、可视化云团和聊天交互。
- `back_end`：Node.js + Fastify + TypeScript 后端，负责鉴权、会话消息、流式回复、评估/分析接口与数据存储。

## 功能概览

- 用户注册 / 登录（JWT）
- 20 题心理状态问卷评估
- 基于评估与多轮输入的状态分析
- 六维调理建议（身体 / 情绪 / 认知 / 行为 / 关系 / 环境）
- 今日微任务生成
- 聊天消息持久化与 SSE 流式输出
- 视觉云团与 pulse 动效反馈

## 项目结构

```text
xinjin/
├── front-end/          # 前端工程（Vite + React）
├── back_end/           # 后端工程（Fastify + SQLite）
├── example             # 参考内容（非运行必需）
├── lays                # 参考内容（非运行必需）
└── todo                # 待办记录（非运行必需）
```

## 运行环境

- Node.js >= 18
- npm >= 9（建议）

## 快速启动（本地联调）

### 1) 启动后端

```bash
cd back_end
npm install
npm run dev
```

默认监听：`http://localhost:8787`

### 2) 启动前端

另开一个终端：

```bash
cd front-end
npm install
npm run dev
```

默认地址：`http://localhost:5173`

### 3) 访问与验证

1. 打开前端页面，先注册或登录。
2. 完成 20 题评估，进入结果页。
3. 在聊天区发送内容，观察：
- 回复是否流式出现
- 云团是否有 pulse 反馈
- 建议面板是否会随聊天刷新

## 环境变量

### 后端（`back_end`）

可选环境变量：

- `JWT_SECRET`：JWT 签名密钥（默认 `dev-secret-change-me`）
- `AI_PROVIDER`：指定模型提供方，设置为 `deepseek` 可强制使用 DeepSeek
- `DEEPSEEK_API_KEY`：DeepSeek API Key（有值时可启用 DeepSeek）
- `DEEPSEEK_BASE_URL`：默认 `https://api.deepseek.com`
- `DEEPSEEK_MODEL`：默认 `deepseek-chat`

说明：

- 未配置 DeepSeek 时，后端会回退到 mock provider，便于本地开发联调。

### 前端（`front-end`）

可选环境变量：

- `VITE_API_BASE`：HTTP API 基础地址（例如 `http://localhost:8787`）
- `VITE_WS_URL`：主 WebSocket 地址

不设置时，前端会按当前域名和内置候选地址自动尝试连接。

## 数据存储

后端使用 SQLite，数据库文件默认在：

- `back_end/data/xinjin.sqlite`

主要数据表：

- `users`
- `sessions`
- `messages`
- `assessment_records`
- `state_analyses`

## 后端接口概览

### 认证

- `POST /api/auth/register`
- `POST /api/auth/login`

### 聊天

- `POST /api/chat/sessions`
- `GET /api/chat/sessions`
- `GET /api/chat/sessions/:id/messages`
- `DELETE /api/chat/sessions/:id/messages`
- `POST /api/chat/sessions/:id/messages`
- `POST /api/chat/sessions/:id/stream`（SSE）

### 评估与分析

- `POST /api/assessment/submit`
- `POST /api/state/analyze`
- `GET /api/profile/summary`
- `GET /api/profile/timeline`

### WebSocket

- `ws://localhost:8787`

## 生产构建

### 前端

```bash
cd front-end
npm run build
npm run preview
```

### 后端

```bash
cd back_end
npm run build
npm run start
```

## 常见问题

### 1) 前端提示网络错误

检查后端是否已启动在 `8787` 端口；必要时在前端设置 `VITE_API_BASE` 指向正确地址。

### 2) 登录/注册返回 400

后端要求：

- 邮箱必须是合法格式
- 密码长度至少 8 位

### 3) 想切到真实模型而不是 mock

在后端设置 `DEEPSEEK_API_KEY`（必要时再设置 `AI_PROVIDER=deepseek`），然后重启后端。

## 现有子文档

- 前端说明：`front-end/README.md`
- 后端说明：`back_end/README.md`
- 前端接口文档：`front-end/API.md`
