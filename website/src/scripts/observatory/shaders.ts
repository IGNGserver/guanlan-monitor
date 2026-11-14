/**
 * 海面点阵、舰队分组信标与双模遥测流的着色器。
 * 海面高度与 design/blender/build_observatory.py 的 wave_height() 是同一公式：
 * h = Σ amp·sin(k·(dir·p) + speed·t + phase) + 涟漪；位置 = f(网格坐标, 时间)，无 GPGPU 状态。
 */

const WAVE_UNIFORMS = /* glsl */ `
  uniform float uTime;
  uniform float uZ;
  uniform float uHalf;
  uniform float uPing;
  uniform vec4 uComp[3];   // dir.xy（已归一化）, k, amp
  uniform vec2 uCompB[3];  // speed, phase
  uniform vec4 uRipple;    // amp, k, speed, decay

  float waveHeight(vec2 p, out float r, out float ring, out float pong) {
    float h = 0.0;
    for (int i = 0; i < 3; i++) {
      h += uComp[i].w * sin(uComp[i].z * dot(uComp[i].xy, p) + uCompB[i].x * uTime + uCompB[i].y);
    }
    r = length(p);
    h += uRipple.x * sin(uRipple.y * r - uRipple.z * uTime) * exp(-uRipple.w * r);
    float fade = smoothstep(uHalf, uHalf * 0.38, uPing);
    ring = exp(-pow((r - uPing) * 1.8, 2.0)) * fade;
    pong = exp(-pow((r - max(0.0, uPing - 1.75)) * 2.2, 2.0)) * fade;
    return h;
  }
`;

export const seaVertex = /* glsl */ `
  ${WAVE_UNIFORMS}
  uniform float uSize;
  uniform float uPixelRatio;
  uniform vec3 uLow;
  uniform vec3 uHigh;
  uniform vec3 uTeal;
  attribute vec2 aGrid;    // Blender 平面坐标 (x, y)
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 p = aGrid;
    float r;
    float ring;
    float pong;
    float h = waveHeight(p, r, ring, pong);

    vec3 pos = vec3(p.x, uZ + h + ring * 0.05 + pong * 0.025, -p.y);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    float t = smoothstep(0.35, 0.75, (h + 0.25) / 0.5);
    vColor = mix(uLow, uHigh, t) + uHigh * ring * 1.35 + uTeal * pong * 0.65;

    float dist = -mv.z;
    float edge = 1.0 - smoothstep(uHalf * 0.62, uHalf, max(abs(p.x), abs(p.y)));
    vAlpha = clamp(1.0 - (dist - 4.0) / 20.0, 0.0, 1.0) * edge;
    gl_PointSize = uSize * uPixelRatio * (1.0 + ring * 0.8 + pong * 0.4) / dist;
  }
`;

export const seaFragment = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.12, d) * vAlpha * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

/** 舰队分组信标：代表不同设备组内的节点，随波面起伏并在脉冲掠过时应答（challenge / pong）。 */
export const beaconVertex = /* glsl */ `
  ${WAVE_UNIFORMS}
  uniform float uSize;
  uniform float uPixelRatio;
  uniform vec3 uTeal;
  uniform vec3 uAmber;
  attribute vec4 aBeacon; // x, y, health (1=teal, 0.5=amber), phase
  varying vec3 vColor;
  varying float vAlpha;
  varying float vReply;

  void main() {
    vec2 p = aBeacon.xy;
    float r;
    float ring;
    float pong;
    float h = waveHeight(p, r, ring, pong);

    float reply = clamp(ring * 1.4 + pong * 1.8, 0.0, 1.6);
    vec3 pos = vec3(p.x, uZ + h + 0.045 + reply * 0.035, -p.y);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    float pulse = 0.82 + 0.18 * sin(uTime * 2.4 + aBeacon.w * 6.2831);
    vec3 base = aBeacon.z > 0.75 ? uTeal : uAmber;
    vColor = base * (1.15 * pulse + reply * 1.1);
    vReply = reply;

    float dist = -mv.z;
    vAlpha = clamp(1.0 - (dist - 4.0) / 22.0, 0.0, 1.0);
    gl_PointSize = uSize * uPixelRatio * (1.0 + reply * 0.55) / dist;
  }
`;

export const beaconFragment = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vReply;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float core = smoothstep(0.2, 0.04, d);
    float halo = exp(-pow((d - 0.36) * 14.0, 2.0)) * (0.42 + vReply * 0.45);
    float glow = smoothstep(0.5, 0.0, d) * 0.24;
    float a = clamp(core + halo + glow, 0.0, 1.0) * vAlpha * uOpacity;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

/** 设备组内拓扑细线：贴合波面把同一分组的节点连成星群。 */
export const beaconLineVertex = /* glsl */ `
  ${WAVE_UNIFORMS}
  attribute vec3 aLine; // x, y, healthMix
  varying float vAlpha;
  varying float vHealth;

  void main() {
    vec2 p = aLine.xy;
    float r;
    float ring;
    float pong;
    float h = waveHeight(p, r, ring, pong);
    vec3 pos = vec3(p.x, uZ + h + 0.032 + (ring + pong) * 0.03, -p.y);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = -mv.z;
    vAlpha = clamp(1.0 - (dist - 4.0) / 20.0, 0.0, 1.0) * (0.13 + (ring + pong) * 0.28);
    vHealth = aLine.z;
  }
`;

export const beaconLineFragment = /* glsl */ `
  uniform vec3 uTeal;
  uniform vec3 uAmber;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vHealth;

  void main() {
    vec3 col = mix(uAmber, uTeal, step(0.75, vHealth));
    float a = vAlpha * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(col * a, a);
  }
`;

/**
 * 双模遥测流：
 *  - aKind = 0：常规遥测（琥珀色），从舰队星群与海面升起、汇入仪器底部；
 *  - aKind = 1：实时直连通道（青色），高速双向穿梭于海面分组与观测单元之间。
 */
export const streamVertex = /* glsl */ `
  uniform float uTime;
  uniform float uZ;
  uniform float uPixelRatio;
  uniform float uSize;
  attribute vec4 aSeed; // 方位角, 起始半径, 速度, 相位
  attribute float aKind; // 0 = 常规上报(amber), 1 = 实时直连(teal)
  varying float vAlpha;
  varying float vKind;

  void main() {
    float raw = fract(uTime * aSeed.z + aSeed.w);
    // 实时通道有一半粒子从仪器向设备下发（challenge / RPC 请求），一半应答上行
    float down = step(0.5, fract(aSeed.w * 13.7)) * aKind;
    float f = down > 0.5 ? 1.0 - raw : raw;
    float e = f * f * (3.0 - 2.0 * f);
    float swirl = mix(1.25, 0.42, aKind);
    float ang = aSeed.x + e * swirl;
    float topR = mix(0.08, 0.24, aKind);
    float rad = mix(aSeed.y, topR, pow(e, mix(0.72, 0.9, aKind)));
    float topY = mix(-0.02, 0.92, aKind);
    float y = mix(uZ + 0.06, topY, pow(e, mix(1.75, 1.2, aKind)));
    vec3 pos = vec3(cos(ang) * rad, y, sin(ang) * rad);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    vAlpha = smoothstep(0.0, 0.14, raw) * smoothstep(1.0, 0.84, raw);
    vKind = aKind;
    gl_PointSize = uSize * uPixelRatio * mix(0.6 + e, 0.85 + 0.55 * sin(raw * 3.14159), aKind) / -mv.z;
  }
`;

export const streamFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uTeal;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vKind;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vAlpha * uOpacity;
    if (a < 0.003) discard;
    vec3 col = mix(uColor, uTeal, vKind);
    gl_FragColor = vec4(col * a, a);
  }
`;
