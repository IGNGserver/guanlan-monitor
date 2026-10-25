/**
 * 海面点阵与遥测流的着色器。海面高度与 design/blender/build_observatory.py 的 wave_height()
 * 是同一公式：h = Σ amp·sin(k·(dir·p) + speed·t + phase) + 涟漪；位置 = f(网格坐标, 时间)，
 * 没有 GPGPU 状态，WebGL1 也能跑。
 */

export const seaVertex = /* glsl */ `
  uniform float uTime;
  uniform float uZ;
  uniform float uHalf;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uPing;
  uniform vec4 uComp[3];   // dir.xy（已归一化）, k, amp
  uniform vec2 uCompB[3];  // speed, phase
  uniform vec4 uRipple;    // amp, k, speed, decay
  uniform vec3 uLow;
  uniform vec3 uHigh;
  attribute vec2 aGrid;    // Blender 平面坐标 (x, y)
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 p = aGrid;
    float h = 0.0;
    for (int i = 0; i < 3; i++) {
      h += uComp[i].w * sin(uComp[i].z * dot(uComp[i].xy, p) + uCompB[i].x * uTime + uCompB[i].y);
    }
    float r = length(p);
    h += uRipple.x * sin(uRipple.y * r - uRipple.z * uTime) * exp(-uRipple.w * r);

    // 观测脉冲：自仪器向外扩散的一道亮环
    float ring = exp(-pow((r - uPing) * 1.8, 2.0)) * smoothstep(uHalf, uHalf * 0.4, uPing);

    vec3 pos = vec3(p.x, uZ + h + ring * 0.05, -p.y);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    float t = smoothstep(0.35, 0.75, (h + 0.25) / 0.5);
    vColor = mix(uLow, uHigh, t) + uHigh * ring * 1.4;

    float dist = -mv.z;
    float edge = 1.0 - smoothstep(uHalf * 0.62, uHalf, max(abs(p.x), abs(p.y)));
    vAlpha = clamp(1.0 - (dist - 4.0) / 20.0, 0.0, 1.0) * edge;
    gl_PointSize = uSize * uPixelRatio * (1.0 + ring * 0.8) / dist;
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

/** 遥测流：从海面各处升起、汇入仪器底部的粒子。每个粒子的轨迹只由种子与时间决定。 */
export const streamVertex = /* glsl */ `
  uniform float uTime;
  uniform float uZ;
  uniform float uPixelRatio;
  uniform float uSize;
  attribute vec4 aSeed; // 方位角, 起始半径, 速度, 相位
  varying float vAlpha;

  void main() {
    float f = fract(uTime * aSeed.z + aSeed.w);
    float e = f * f * (3.0 - 2.0 * f);
    float ang = aSeed.x + e * 1.4;
    float rad = mix(aSeed.y, 0.08, pow(e, 0.7));
    float y = mix(uZ + 0.05, -0.02, pow(e, 1.8));
    vec3 pos = vec3(cos(ang) * rad, y, sin(ang) * rad);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    vAlpha = smoothstep(0.0, 0.15, f) * smoothstep(1.0, 0.82, f);
    gl_PointSize = uSize * uPixelRatio * (0.6 + e) / -mv.z;
  }
`;

export const streamFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vAlpha * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, a);
  }
`;
