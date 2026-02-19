# 心镜 Front-End API 文档

## 1. 概览

当前项目对外主要提供两类 API：

- WebSocket 协议（前端接收服务端指令）
- 前端事件总线 API（模块间输入事件）

默认 WebSocket 地址：`ws://localhost:8787`（见 `src/config.ts`）

## 2. WebSocket API

### 2.1 连接信息

- URL: `ws://localhost:8787`
- 方向: 服务端 -> 前端
- 消息格式: JSON

### 2.2 入站消息类型

#### `setState`

用于局部更新视觉状态。

```json
{
  "type": "setState",
  "state": {
    "arousal": 0.8,
    "valence": 0.3
  },
  "transitionMs": 700
}
```

字段说明：

- `type`: 固定为 `setState`
- `state`: `StateVisualInput` 的部分字段（见“4. 数据模型”）
- `transitionMs`: 可选，过渡时长（毫秒），默认 500

#### `setPreset`

应用预设情绪状态。

```json
{
  "type": "setPreset",
  "name": "happy",
  "intensity": 0.9,
  "transitionMs": 600
}
```

字段说明：

- `type`: 固定为 `setPreset`
- `name`: 预设名，`neutral | happy | sad | angry | anxious | overloaded`
- `intensity`: 可选，0..1
- `transitionMs`: 可选，过渡时长（毫秒），默认 700

#### `setInteractionMode`

切换交互模式。

```json
{
  "type": "setInteractionMode",
  "mode": "vortex"
}
```

字段说明：

- `type`: 固定为 `setInteractionMode`
- `mode`: `gravity | off | repel | vortex`

#### `setConfig`

动态修改配置项（受白名单限制）。

```json
{
  "type": "setConfig",
  "key": "interaction.attractStrength",
  "value": 0.9
}
```

字段说明：

- `type`: 固定为 `setConfig`
- `key`: 配置键（仅允许白名单）
- `value`: 任意 JSON 值（实际会按目标字段类型使用）

允许的 `key` 白名单（`src/config.ts`）：

- `cloud.pointSize`
- `interaction.attractStrength`
- `interaction.attractRadius`
- `interaction.stiffness`
- `interaction.damping`
- `interaction.maxOffset`
- `interaction.stretchStrength`
- `interaction.stretchMax`
- `interaction.relaxSpeed`
- `interaction.hoverBoost`
- `cloud.enableBloomByDefault`

### 2.3 连接状态与错误

`WsClient` 状态：

- `connecting`
- `open`
- `closed`
- `error`

错误场景：

- WebSocket 初始化失败
- 连接异常
- 消息不是合法 JSON

重连策略：

- 指数退避，从 500ms 开始，最大 10000ms
- 手动关闭后不再重连

## 3. 前端事件总线 API（InputBus）

定义位置：`src/events/inputBus.ts`

### 3.1 事件列表

- `text_input`: `{ text: string }`
- `voice_input`: `{ text: string }`
- `system_response`: `{ text: string; suggestedPreset?: PresetName }`
- `video_state_hint`: `{ partialState: Partial<StateVisualInput> }`
- `user_action`: `{ type: string }`

### 3.2 调用方式

```ts
import { inputBus } from "./events/inputBus";

const off = inputBus.on("text_input", (payload) => {
  console.log(payload.text);
});

inputBus.emit("text_input", { text: "hello" });
off();
```

## 4. 数据模型

### 4.1 `StateVisualInput`

全部字段范围建议为 `0..1`：

```ts
interface StateVisualInput {
  arousal: number;
  valence: number;
  stability: number;
  load: number;
  socialDrain: number;
  intensity: number;
}
```

### 4.2 `PresetName`

```ts
type PresetName =
  | "neutral"
  | "happy"
  | "sad"
  | "angry"
  | "anxious"
  | "overloaded";
```

### 4.3 `InteractionMode`

```ts
type InteractionMode = "gravity" | "off" | "repel" | "vortex";
```

## 5. 前端服务接口（供二次开发）

### 5.1 `ChatService` (`src/chat/chatService.ts`)

- `onMessage(cb): () => void`
- `sendText(text: string): void`

行为说明：

- `sendText` 会先发出用户消息
- 同时触发 `text_input` 事件
- 约 300ms 后生成系统占位回复并触发 `system_response`

### 5.2 `TextInputChannel` (`src/input/textInput.ts`)

- `send(text: string): void` -> 触发 `text_input`

### 5.3 `VoiceInput` (`src/input/voiceInput.ts`)

- `isSupported(): boolean`
- `onStatus(cb): () => void`
- `start(): void`
- `stop(): void`

行为说明：

- `start` 后进入 `recording`
- 约 2s 后产出占位文本，触发 `voice_input`，并调用 `chatService.sendText`

### 5.4 `VideoInputChannel` (`src/input/videoInputChannel.ts`)

- `emitHint(partialState): void` -> 触发 `video_state_hint`

### 5.5 `WsClient` (`src/net/wsClient.ts`)

- `constructor(handlers, url?)`
- `connect(): void`
- `close(): void`

`handlers`:

- `onMessage(msg)`
- `onStatus?(status)`
- `onError?(error)`

## 6. 联调示例

服务端持续向前端发送：

```json
{"type":"setState","state":{"arousal":0.7,"valence":0.4},"transitionMs":600}
{"type":"setPreset","name":"anxious","intensity":0.8}
{"type":"setInteractionMode","mode":"repel"}
{"type":"setConfig","key":"cloud.pointSize","value":2.8}
```

前端将根据消息即时更新云团状态与交互行为。
