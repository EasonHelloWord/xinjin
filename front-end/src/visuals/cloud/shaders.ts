export const cloudVertexShader = `
uniform float uTime;
uniform vec3 uOffset;
uniform vec3 uAttractor;
uniform float uDeformStrength;
uniform float uDeformRadius;
uniform float uNoiseAmp;
uniform float uGateInner;
uniform float uGatePeak;
uniform float uGateOuter;
uniform float uBreathHz;
uniform float uBreathJitter;
uniform int uInteractionMode;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying float vGate;
varying float vNoise;

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
  vec3 n = normalize(normal);
  float breath = sin(uTime * 6.2831853 * (uBreathHz + uBreathJitter * 0.2)) * 0.03;
  p *= 1.0 + breath;

  vec3 pw = p + uOffset;
  vec3 toA = uAttractor - pw;
  float dist = length(toA);
  float w = exp(-(dist * dist) / (2.0 * uDeformRadius * uDeformRadius));
  vec3 dir = normalize(toA + vec3(1e-6));
  vec3 ddir = normalize(mix(n, dir, 0.6));

  float centerDist = length(uAttractor - uOffset);
  float gateA = smoothstep(uGateInner, uGatePeak, centerDist);
  float gateB = 1.0 - smoothstep(uGatePeak, uGateOuter, centerDist);
  float centerGate = gateA * gateB;
  if (uInteractionMode == 0) centerGate = 0.0;

  float ns = noise3(pw * 2.2 + vec3(uTime * 0.45));
  vec3 displacement = ddir * w * uDeformStrength * centerGate;
  displacement += n * (ns - 0.5) * uNoiseAmp * 0.08 * centerGate;
  p += displacement;

  vec4 worldPos = modelMatrix * vec4(p, 1.0);
  vWorldPos = worldPos.xyz;
  vNormalW = normalize(mat3(modelMatrix) * n);
  vGate = centerGate;
  vNoise = ns;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const cloudFragmentShader = `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uNoiseAmp;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying float vGate;
varying float vNoise;

void main() {
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float fresnel = pow(1.0 - abs(dot(normalize(vNormalW), viewDir)), 1.8);
  float alpha = mix(0.22, 0.72, fresnel);
  alpha *= (1.0 - (vNoise - 0.5) * uNoiseAmp * 0.6);
  alpha *= mix(0.85, 1.0, vGate);
  alpha = clamp(alpha, 0.04, 0.95);

  vec3 color = mix(uColorA, uColorB, clamp(fresnel * 0.7 + 0.2, 0.0, 1.0));
  gl_FragColor = vec4(color, alpha);
}
`;

