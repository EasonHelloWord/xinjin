# 心镜 - 抽象云团状态可视化主界面

基于 `Vite + TypeScript + React + Three.js` 的前端基础工程。  
当前重点是 Home 页的抽象云团状态可视化，已预留 Dashboard/Kanban/Login 路由骨架，并预留文本聊天/语音/视频输入通道（mock）。

## 启动

```bash
npm install
npm run dev
```

构建：

```bash
npm run build
```

## 路由

- `/` Home（云团 + 调试面板 + ChatDock + 视频输入占位）
- `/dashboard` 占位
- `/kanban` 占位
- `/login` 占位

## 目录结构

```txt
src/
  config.ts
  engine/
    CloudController.ts
    CloudEngine.ts
  visuals/cloud/
    CloudField.ts
    mapping.ts
    shaders.ts
  net/
    wsClient.ts
  state/
    types.ts
    presets.ts
  pages/
    HomePage.tsx
    PlaceholderPage.tsx
  events/
    inputBus.ts
  input/
    textInput.ts
    voiceInput.ts
    videoInputChannel.ts
  chat/
    chatService.ts
    ChatDock.tsx
  media/
    videoInput.ts
    VideoPanel.tsx
```

## 状态模型（StateVisualInput）

```ts
{
  arousal: number;     // 0..1
  valence: number;     // 0..1
  stability: number;   // 0..1
  load: number;        // 0..1
  socialDrain: number; // 0..1
  intensity: number;   // 0..1
}
```

预设：`neutral/happy/sad/angry/anxious/overloaded`

## 状态到视觉映射

位于 `src/visuals/cloud/mapping.ts`，可调：

- 颜色：`valence` 控制冷暖，`arousal` 提升饱和与亮度
- 形变：`load` 提高噪声振幅/频率，`stability` 低时 jitter 增强
- 粒子密度：`intensity + load` 映射到密度与实际 draw count
- 呼吸：`arousal` 映射到 `0.08..0.25Hz`，`stability` 低时叠加抖动
- socialDrain：映射为边缘下垂（`socialSink`）

## CloudController API

`src/engine/CloudController.ts`

- `setState(partial, transitionMs?)`
- `setPreset(name, intensity?, transitionMs?)`
- `setInteractionMode("attract"|"repel"|"vortex"|"off")`
- `pause(bool)`
- 额外：`toggleBloom()`、`togglePause()`、`applyConfig(...)`

## WebSocket 协议

默认连接：`ws://localhost:8787`（`src/config.ts`）

### 入站消息

```json
{"type":"setState","state":{"arousal":0.8,"valence":0.3},"transitionMs":700}
{"type":"setPreset","name":"happy","intensity":0.9,"transitionMs":600}
{"type":"setInteractionMode","mode":"vortex"}
{"type":"setConfig","key":"interaction.interactionStrength","value":0.9}
```

`setConfig` 白名单在 `src/config.ts` 的 `setConfigWhitelist`。

## 输入通道架构（文字图）

`Text/Voice/Video UI -> Input Channels -> InputBus -> 业务订阅者`

- Chat 文本：`ChatService.sendText -> textInputChannel -> InputBus(text_input)`
- 语音占位：`VoiceInput.start -> 2s mock 文本 -> InputBus(voice_input) -> ChatService.sendText`
- 视频占位：`VideoInput.start -> mock 情绪 hint -> videoInputChannel -> InputBus(video_state_hint)`

云团只订阅：

- `system_response.suggestedPreset` -> `CloudController.setPreset`
- `video_state_hint.partialState` -> `CloudController.setState`

因此后续替换真实 AI/ASR/RTC 不需要改云团渲染代码。

## InputBus 事件列表

- `text_input` `{ text }`
- `voice_input` `{ text }`
- `system_response` `{ text, suggestedPreset? }`
- `video_state_hint` `{ partialState }`
- `user_action` `{ type }`

## 聊天/语音/视频占位说明

当前是 mock：

- 聊天：本地假回复，300ms 生成 `system_response`
- 语音：按钮切换录音状态，2s 后返回假转写文本
- 视频：权限请求 + 状态 UI，占位发出 `video_state_hint`

未来替换点：

- ASR：替换 `src/input/voiceInput.ts` mock 定时器
- LLM：替换 `src/chat/chatService.ts` 的假回复逻辑（可改成 HTTP/WS）
- RTC/视频分析：替换 `src/media/videoInput.ts` 的 mock hint 产生逻辑

## 交互与快捷键

- 鼠标移动：交互点映射到 `z=0` 平面并平滑跟随
- 鼠标按下：增强交互强度
- 快捷键：
  - `1..6` 切预设
  - `Space` 吸引/排斥切换
  - `B` Bloom 开关
  - `P` 暂停/继续

## 性能降级

- 运行中计算平均 FPS（滑窗）
- 低于阈值（默认 `<45`）时自动降级：
  1. 关闭 bloom
  2. 粒子数降到 25k
  3. 粒子数降到 10k

可在 `src/config.ts` 提高初始粒子数来模拟低性能触发。

## 错误处理

页面内可读提示覆盖以下场景：

- WebGL 不支持/初始化失败
- WS 连接异常/消息解析失败/非法配置项
- 性能自动降级提示

## 后续接入 Dashboard/Login

路由骨架已保留在 `src/App.tsx`。  
后续只需替换 `src/pages/PlaceholderPage.tsx` 对应路由元素为真实页面组件，并复用当前 `InputBus + CloudController + wsClient` 基础设施。
