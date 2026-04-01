# xinjin-backend

Node.js + TypeScript backend for xinjin.

## Requirements

- Node.js 18+

## Run

```bash
cd back_end
npm install
npm run dev
```

Build and run:

```bash
npm run build
npm run start
```

## Environment

- `JWT_SECRET` (optional): JWT signing secret. Default is `dev-secret-change-me`.
- `LLM_API_KEY` (optional): when present, backend uses the configured LLM instead of mock replies.
- `LLM_BASE_URL` (optional): defaults to `https://api.deepseek.com`.
- `LLM_MODEL` (optional): defaults to `deepseek-chat`.
- `MCP_SERVER_CMD` (optional): command used to start the local MCP server over stdio.
- `MCP_SERVER_CWD` (optional): working directory for `MCP_SERVER_CMD`. Use this if the MCP command contains relative paths.
- `XINJIN_CONFIG_FILE` (optional): extra config file path. Supports `.env`-style files and `.json`.

Default config loading order:

1. `back_end/.env`
2. `back_end/.env.local`
3. `XINJIN_CONFIG_FILE` if set
4. Shell environment variables override all file-based values

Example `.env`:

```env
LLM_API_KEY=your-llm-api-key
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-chat
MCP_SERVER_CMD=node dist/index.js
MCP_SERVER_CWD=../mcp_server
```

## Storage

- SQLite file: `back_end/data/xinjin.sqlite`
- Tables:
  - `users(id, email, password_hash, created_at)`
  - `sessions(id, user_id, title, created_at)`
  - `messages(id, session_id, role, content, created_at)`

## HTTP API

### Auth

- `POST /api/auth/register`
- `POST /api/auth/login`

Body:

```json
{
  "email": "user@example.com",
  "password": "12345678"
}
```

Response:

```json
{
  "token": "jwt-token",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "createdAt": 1700000000000
  }
}
```

### Chat

- `POST /api/chat/sessions` `{ "title"?: "..." }`
- `GET /api/chat/sessions`
- `GET /api/chat/sessions/:id/messages`
- `POST /api/chat/sessions/:id/messages` `{ "content": "..." }`
- `POST /api/chat/sessions/:id/stream` `{ "content": "...", "voice"?: true }`

`GET /api/chat/sessions` response item:

```json
{ "id": "uuid", "title": "My Session", "created_at": 1700000000000 }
```

`GET /api/chat/sessions/:id/messages` response item:

```json
{ "id": "uuid", "role": "assistant", "content": "...", "created_at": 1700000000000 }
```

SSE stream events:

- `event: token` with `{"text":"..."}`
- `event: pulse` with `{"v":0.15-0.45}`
- `event: done` with `{"messageId":"..."}`

## WebSocket Endpoints (existing)

- Main WS: `ws://localhost:8787`
- Voice placeholder WS: `ws://localhost:8787/voice`

## Curl Examples

1. Register / Login

```bash
curl -X POST http://localhost:8787/api/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"user@example.com\",\"password\":\"12345678\"}"

curl -X POST http://localhost:8787/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"user@example.com\",\"password\":\"12345678\"}"
```

2. Create Session

```bash
curl -X POST http://localhost:8787/api/chat/sessions \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"My Session\"}"
```

3. Send Stream Message (`curl -N`)

```bash
curl -N -X POST http://localhost:8787/api/chat/sessions/<SESSION_ID>/stream \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"I feel overwhelmed and want to plan my next step\",\"voice\":true}"
```
