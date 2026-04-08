import { CSSProperties, useId, useMemo } from "react";
import "./WaveAnimation.css";

type WaveAnimationProps = {
  speed?: number;
  amplitude?: number;
  color?: string;
};

const VIEWBOX_WIDTH = 1200;
const VIEWBOX_HEIGHT = 160;
const BASELINE = VIEWBOX_HEIGHT / 2;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildSinePath(options: {
  width: number;
  baseline: number;
  amplitude: number;
  wavelength: number;
  phase: number;
  samples: number;
}): string {
  const { width, baseline, amplitude, wavelength, phase, samples } = options;
  const step = width / samples;
  let d = `M 0 ${baseline + Math.sin(phase) * amplitude}`;

  for (let i = 1; i <= samples; i += 1) {
    const x = i * step;
    const y = baseline + Math.sin((x / wavelength) * Math.PI * 2 + phase) * amplitude;
    d += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  }

  return d;
}

export function WaveAnimation({ speed = 1, amplitude = 18, color = "#78b8bb" }: WaveAnimationProps): JSX.Element {
  const safeSpeed = clamp(speed, 0.4, 3);
  const safeAmplitude = clamp(amplitude, 6, 40);
  const id = useId().replace(/:/g, "");

  const layers = useMemo(
    () => [
      {
        key: "back",
        path: buildSinePath({
          width: VIEWBOX_WIDTH,
          baseline: BASELINE + 4,
          amplitude: safeAmplitude * 0.58,
          wavelength: 240,
          phase: 0.7,
          samples: 220
        }),
        width: 2.4,
        opacity: 0.35,
        flowDuration: 18 / safeSpeed,
        breatheDuration: 6.4
      },
      {
        key: "mid",
        path: buildSinePath({
          width: VIEWBOX_WIDTH,
          baseline: BASELINE,
          amplitude: safeAmplitude * 0.78,
          wavelength: 210,
          phase: 1.6,
          samples: 240
        }),
        width: 2.8,
        opacity: 0.6,
        flowDuration: 13 / safeSpeed,
        breatheDuration: 5.8
      },
      {
        key: "front",
        path: buildSinePath({
          width: VIEWBOX_WIDTH,
          baseline: BASELINE - 2,
          amplitude: safeAmplitude,
          wavelength: 190,
          phase: 2.4,
          samples: 260
        }),
        width: 3.2,
        opacity: 0.95,
        flowDuration: 9.2 / safeSpeed,
        breatheDuration: 5.1
      }
    ],
    [safeAmplitude, safeSpeed]
  );

  return (
    <div className="wave-animation" style={{ "--wave-color": color } as CSSProperties}>
      <svg
        className="wave-animation-svg"
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        preserveAspectRatio="none"
        role="presentation"
      >
        <defs>
          <linearGradient id={`${id}-front`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={color} stopOpacity="0.14" />
            <stop offset="45%" stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor="#9bd7ca" stopOpacity="0.22" />
          </linearGradient>
          <linearGradient id={`${id}-mid`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#8fcfd1" stopOpacity="0.1" />
            <stop offset="50%" stopColor={color} stopOpacity="0.84" />
            <stop offset="100%" stopColor="#83c9b8" stopOpacity="0.14" />
          </linearGradient>
          <linearGradient id={`${id}-back`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#acdfe0" stopOpacity="0.08" />
            <stop offset="50%" stopColor="#9ac8d2" stopOpacity="0.56" />
            <stop offset="100%" stopColor="#9ad2c4" stopOpacity="0.1" />
          </linearGradient>
          <filter id={`${id}-glow`} x="-20%" y="-120%" width="140%" height="340%">
            <feGaussianBlur stdDeviation="2.8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {layers.map((layer) => {
          const gradientId = `${id}-${layer.key === "front" ? "front" : layer.key === "mid" ? "mid" : "back"}`;
          return (
            <g
              key={layer.key}
              className="wa-layer"
              style={
                {
                  "--wa-breathe-duration": `${layer.breatheDuration}s`,
                  "--wa-flow-duration": `${layer.flowDuration}s`,
                  "--wa-layer-opacity": layer.opacity,
                  "--wa-line-width": layer.width
                } as CSSProperties
              }
            >
              <g className="wa-flow">
                <path
                  className="wa-line wa-line-glow"
                  d={layer.path}
                  stroke={`url(#${gradientId})`}
                  filter={`url(#${id}-glow)`}
                />
                <path className="wa-line wa-line-core" d={layer.path} stroke={`url(#${gradientId})`} />

                <path
                  className="wa-line wa-line-glow"
                  d={layer.path}
                  stroke={`url(#${gradientId})`}
                  transform={`translate(${VIEWBOX_WIDTH} 0)`}
                  filter={`url(#${id}-glow)`}
                />
                <path
                  className="wa-line wa-line-core"
                  d={layer.path}
                  stroke={`url(#${gradientId})`}
                  transform={`translate(${VIEWBOX_WIDTH} 0)`}
                />
              </g>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
