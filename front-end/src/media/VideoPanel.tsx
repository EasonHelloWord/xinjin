// 视频输入面板：展示权限/状态，并提供启动停止按钮。
import { useEffect, useState } from "react";
import { videoInput, VideoPermission, VideoStatus } from "./videoInput";

interface VideoPanelProps {
  // open=false 时组件直接不渲染。
  open: boolean;
  onClose: () => void;
}

export function VideoPanel({ open, onClose }: VideoPanelProps): JSX.Element | null {
  const [permission, setPermission] = useState<VideoPermission>("idle");
  const [status, setStatus] = useState<VideoStatus>("stopped");

  useEffect(() => {
    // 订阅 videoInput 状态，保持面板显示同步。
    const off = videoInput.onState((s) => {
      setPermission(s.permission);
      setStatus(s.status);
    });
    return off;
  }, []);

  if (!open) return null;

  return (
    <div className="video-panel">
      <div className="video-panel-head">
        <strong>视频输入占位</strong>
        <button onClick={onClose}>关闭</button>
      </div>
      <p>权限状态: {permission}</p>
      <p>运行状态: {status}</p>
      <div className="video-actions">
        <button onClick={() => void videoInput.requestPermission()}>请求权限</button>
        <button onClick={() => videoInput.start()}>开始</button>
        <button onClick={() => videoInput.stop()}>停止</button>
      </div>
      <p className="video-note">当前仅占位：不进行真实视频采集或RTC传输。</p>
    </div>
  );
}
