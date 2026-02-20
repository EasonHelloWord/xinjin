# mind-mirror-cloud-ui

React + Vite + TypeScript front-end for xinjin cloud visualization and chat.

## Setup

```bash
cd front-end
npm install
```

Create `.env` (already added):

```env
VITE_API_BASE=http://localhost:8787
```

## Run

```bash
npm run dev
```

## Features wired in this version

- Auth: register/login, token persistence in `localStorage`
- Chat sessions: create/list/select sessions, load history
- Streaming chat: POST SSE via `fetch` + `ReadableStream` parser
- Sphere feedback: `token` / `pulse` stream events emit pulse to cloud sphere scaling
- Browser TTS: optional voice output via `window.speechSynthesis` and pulse during speech

## End-to-end local test

1. Start back-end:

```bash
cd back_end
npm install
npm run dev
```

2. Start front-end:

```bash
cd front-end
npm install
npm run dev
```

3. Open the app, register or login on `/login`.
4. Send: `我觉得很空虚，注意力很难集中`.
   - Expect assistant text to stream token-by-token.
   - Expect sphere to pulse while streaming.
5. Enable `Voice output` and send again.
   - Expect speech playback after stream done.
   - Expect sphere to keep pulsing during speech.
