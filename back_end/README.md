# xinjin-backend

Node.js + TypeScript minimal backend for the xinjin front-end.

## Requirements

- Node.js 18+ (works on Node.js 20+)

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

## WebSocket Endpoints

- Main WS: `ws://localhost:8787`
- Voice placeholder WS: `ws://localhost:8787/voice`

## Protocol Envelope

All main WS messages use this envelope:

```json
{
  "v": 1,
  "type": "xxx",
  "ts": 1700000000000,
  "reqId": "optional-string",
  "payload": {}
}
```

## Example Messages

Client -> Server `hello`:

```json
{
  "v": 1,
  "type": "hello",
  "ts": 1700000000000,
  "payload": {
    "client": "front-end",
    "version": "any-string"
  }
}
```

Client -> Server `text_input`:

```json
{
  "v": 1,
  "type": "text_input",
  "ts": 1700000000001,
  "reqId": "req-1",
  "payload": {
    "text": "我有点焦虑"
  }
}
```

Server -> Client `hello_ack`:

```json
{
  "v": 1,
  "type": "hello_ack",
  "ts": 1700000000002,
  "payload": {
    "back_end": "xinjin-backend",
    "version": "1.0",
    "sessionId": "f2b89ca1-8c58-46c6-8a31-2f8c36253ba8"
  }
}
```

Voice WS on connect:

```json
{
  "v": 1,
  "type": "voice_ready",
  "ts": 1700000000003,
  "payload": {
    "mode": "placeholder"
  }
}
```
