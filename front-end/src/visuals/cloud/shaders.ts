// 顶点着色器：负责粒子形变、呼吸、噪声、鼠标交互等位移计算。
export const cloudVertexShader = `
attribute vec3 aRandom;
uniform float uTime;
uniform float uNoiseAmp;
uniform float uNoiseFreq;
uniform float uJitter;
uniform float uPointSize;
uniform float uBreathHz;
uniform float uBreathJitter;
uniform float uSocialSink;
uniform float uDensity;
uniform vec3 uMouse;
uniform float uInteractionStrength;
uniform float uInteractionRadius;
uniform int uInteractionMode;
uniform float uClickBoost;
varying float vMix;
varying float vAlpha;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, u.x);
  float nx10 = mix(n010, n110, u.x);
  float nx01 = mix(n001, n101, u.x);
  float nx11 = mix(n011, n111, u.x);
  float nxy0 = mix(nx00, nx10, u.y);
  float nxy1 = mix(nx01, nx11, u.y);
  return mix(nxy0, nxy1, u.z);
}

void main() {
  vec3 p = position;
  float timeScale = uTime * 6.2831853;
  float breath = sin(timeScale * uBreathHz + aRandom.x * 9.0) * (0.03 + uDensity * 0.08);
  breath += sin(timeScale * (uBreathHz + uBreathJitter) + aRandom.y * 4.0) * 0.02;

  float n = noise3(p * uNoiseFreq + vec3(uTime * 0.17));
  p *= (1.0 + breath + (n - 0.5) * uNoiseAmp);
  p += (aRandom - 0.5) * uJitter * (0.4 + sin(uTime * 1.5 + aRandom.z * 20.0) * 0.6);

  float edge = smoothstep(0.4, 1.8, length(p));
  p.y -= uSocialSink * edge;

  vec3 toMouse = uMouse - p;
  float d = length(toMouse);
  float influence = smoothstep(uInteractionRadius, 0.0, d);
  float strength = uInteractionStrength * uClickBoost * influence;
  if (uInteractionMode == 1) {
    p += normalize(toMouse + vec3(1e-5)) * strength;
  } else if (uInteractionMode == 2) {
    p -= normalize(toMouse + vec3(1e-5)) * strength;
  } else if (uInteractionMode == 3) {
    vec3 tangent = normalize(vec3(-toMouse.y, toMouse.x, 0.0) + vec3(1e-5));
    p += tangent * strength * 1.2;
  }

  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = uPointSize * (300.0 / -mvPosition.z) * (0.75 + uDensity * 0.7);
  gl_PointSize = clamp(gl_PointSize, 1.0, 8.0);

  vMix = clamp(length(p) / 2.2, 0.0, 1.0);
  vAlpha = mix(0.25, 0.95, 1.0 - edge);
}
`;

// 片元着色器：负责粒子圆点软边与颜色混合。
export const cloudFragmentShader = `
uniform vec3 uColorA;
uniform vec3 uColorB;
varying float vMix;
varying float vAlpha;

void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float dist = length(uv);
  float soft = smoothstep(0.55, 0.0, dist);
  float alpha = soft * vAlpha;
  if (alpha < 0.01) discard;
  vec3 color = mix(uColorA, uColorB, vMix);
  gl_FragColor = vec4(color, alpha);
}
`;
