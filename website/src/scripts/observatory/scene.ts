import {
  AdditiveBlending,
  AgXToneMapping,
  BufferAttribute,
  BufferGeometry,
  Color,
  Fog,
  Group,
  HalfFloatType,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget,
  type Material,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { studioEnvironment } from './env';
import { layerCenter, layerY, SPEC } from './spec';
import { seaFragment, seaVertex, streamFragment, streamVertex } from './shaders';

/** 场景的全部可变状态：由滚动导演（director.ts）逐帧给出，场景只负责照做。 */
export interface StageState {
  az: number; // 方位角（度），与 Blender 相同定义
  el: number; // 仰角（度）
  dist: number;
  ty: number; // 注视点高度（Three Y）
  explode: number; // 0 组装 … 1 完全爆炸
  shiftX: number; // 物体在画面中的横向偏移（占视口宽度比例，正值向右）
  shiftY: number; // 纵向偏移（正值向上）
  sea: number; // 海面不透明度
  stream: number; // 遥测流不透明度
  focus: number; // 当前聚焦的层（自下而上的索引），-1 表示无
  ring: number; // 聚焦环可见度
}

export interface Quality {
  low: boolean;
}

const LAYER_IDS = SPEC.layers.map((l) => l.id);
const EMISSIVE = new Set(['amber', 'teal', 'tick', 'reticle']);

export class Observatory {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(30, 1, 0.1, 80);
  private composer?: EffectComposer;
  private bloom?: UnrealBloomPass;
  private root = new Group();
  private layers: Object3D[] = [];
  private layerMats: { mat: MeshStandardMaterial; base: number; kind: string }[][] = [];
  private rotor?: Object3D;
  private platter?: Object3D;
  private sea!: Points<BufferGeometry, ShaderMaterial>;
  private stream!: Points<BufferGeometry, ShaderMaterial>;
  private ring!: Group;
  private width = 1;
  private height = 1;
  private target = new Vector3();
  private spin = 0;
  private pr = 1;
  ready = false;

  constructor(
    canvas: HTMLCanvasElement,
    private quality: Quality,
  ) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: !quality.low,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(new Color(SPEC.palette.void), 1);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = AgXToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.background = new Color(SPEC.palette.void);
    this.scene.fog = new Fog(new Color(SPEC.palette.void), 10, 30);
    this.scene.environment = studioEnvironment(this.renderer);
    this.scene.add(this.root);
    this.buildSea();
    this.buildStream();
    this.buildRing();
    this.setPixelRatio(quality.low ? 1 : Math.min(window.devicePixelRatio, 1.75));
    if (!quality.low) this.buildComposer();
  }

  async load(url: string): Promise<void> {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(url);
    const model = gltf.scene;
    this.layers = LAYER_IDS.map((id) => model.getObjectByName(`L_${id}`)!);
    this.rotor = model.getObjectByName('fan_rotor');
    this.platter = model.getObjectByName('disk_platter');

    // 每层克隆自己的材质，才能单独提亮 / 压暗某一层
    this.layerMats = this.layers.map((layer) => {
      const list: { mat: MeshStandardMaterial; base: number; kind: string }[] = [];
      const cache = new Map<Material, MeshStandardMaterial>();
      layer.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        const src = o.material as MeshStandardMaterial;
        let mat = cache.get(src);
        if (!mat) {
          mat = src.name === 'glass' ? glass() : (src.clone() as MeshStandardMaterial);
          mat.envMapIntensity = src.name === 'mirror' ? 1.4 : src.name === 'alu' ? 0.65 : 1.0;
          cache.set(src, mat);
          list.push({ mat, base: EMISSIVE.has(src.name) ? src.emissiveIntensity : 0, kind: src.name });
        }
        o.material = mat;
        if (src.name === 'glass') o.renderOrder = 2;
      });
      return list;
    });
    this.root.add(model);
    this.ready = true;
  }

  private buildSea() {
    const w = SPEC.waves;
    const n = this.quality.low ? 130 : w.res;
    const grid = new Float32Array(n * n * 2);
    let k = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        grid[k++] = -w.size / 2 + (w.size * i) / (n - 1);
        grid[k++] = -w.size / 2 + (w.size * j) / (n - 1);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('aGrid', new BufferAttribute(grid, 2));
    geo.setAttribute('position', new BufferAttribute(new Float32Array(n * n * 3), 3));
    const comp = w.components.map((c) => {
      const len = Math.hypot(c.dir[0], c.dir[1]);
      return new Vector4(c.dir[0] / len, c.dir[1] / len, c.k, c.amp);
    });
    const mat = new ShaderMaterial({
      vertexShader: seaVertex,
      fragmentShader: seaFragment,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uZ: { value: w.z },
        uHalf: { value: w.size / 2 },
        uSize: { value: (this.quality.low ? 110 : 80) * (w.res / n) },
        uPixelRatio: { value: 1 },
        uPing: { value: 0 },
        uComp: { value: comp },
        uCompB: { value: w.components.map((c) => new Vector2(c.speed, c.phase)) },
        uRipple: { value: new Vector4(w.ripple.amp, w.ripple.k, w.ripple.speed, w.ripple.decay) },
        uLow: { value: new Color('#59606b') },
        uHigh: { value: new Color(SPEC.palette.amber).multiplyScalar(1.25) },
        uOpacity: { value: 1 },
      },
    });
    this.sea = new Points(geo, mat);
    this.sea.frustumCulled = false;
    this.scene.add(this.sea);
  }

  private buildStream() {
    const count = this.quality.low ? 260 : 620;
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      seed[i * 4] = Math.random() * Math.PI * 2;
      seed[i * 4 + 1] = 2.2 + Math.pow(Math.random(), 0.7) * 7.5;
      seed[i * 4 + 2] = 0.05 + Math.random() * 0.07;
      seed[i * 4 + 3] = Math.random();
    }
    const geo = new BufferGeometry();
    geo.setAttribute('aSeed', new BufferAttribute(seed, 4));
    geo.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    const mat = new ShaderMaterial({
      vertexShader: streamVertex,
      fragmentShader: streamFragment,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uZ: { value: SPEC.waves.z },
        uPixelRatio: { value: 1 },
        uSize: { value: 70 },
        uColor: { value: new Color(SPEC.palette.amber).multiplyScalar(1.6) },
        uOpacity: { value: 1 },
      },
    });
    this.stream = new Points(geo, mat);
    this.stream.frustumCulled = false;
    this.scene.add(this.stream);
  }

  private buildRing() {
    this.ring = new Group();
    const hot = new MeshBasicMaterial({ color: new Color(SPEC.palette.amber).multiplyScalar(3), transparent: true, depthWrite: false });
    const faint = new MeshBasicMaterial({ color: new Color(SPEC.palette.bone).multiplyScalar(0.6), transparent: true, depthWrite: false });
    const a = new Mesh(new TorusGeometry(1.16, 0.0035, 6, 220), hot);
    const b = new Mesh(new TorusGeometry(1.3, 0.002, 6, 220, Math.PI * 1.2), faint);
    a.rotation.x = b.rotation.x = Math.PI / 2;
    this.ring.add(a, b);
    this.ring.visible = false;
    this.scene.add(this.ring);
  }

  private buildComposer() {
    const rt = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new Vector2(1, 1), 0.5, 0.45, 1.05);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setPixelRatio(pr: number) {
    this.pr = pr;
    this.renderer.setPixelRatio(pr);
    this.sea.material.uniforms.uPixelRatio!.value = pr;
    this.stream.material.uniforms.uPixelRatio!.value = pr;
    this.composer?.setPixelRatio(pr);
    this.resize(this.width, this.height);
  }

  dropBloom() {
    this.composer?.dispose();
    this.composer = undefined;
  }

  get pixelRatio() {
    return this.pr;
  }

  resize(w: number, h: number) {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.renderer.setSize(this.width, this.height, false);
    this.composer?.setSize(this.width, this.height);
    this.bloom?.resolution.set(this.width / 2, this.height / 2);
    this.camera.aspect = this.width / this.height;
  }

  /** 与 Blender 相机一致：36mm 传感器宽度、AUTO 适配。 */
  private applyLens(lens: number) {
    const a = this.camera.aspect;
    const half = a >= 1 ? 18 / lens / a : 18 / lens;
    this.camera.fov = (2 * Math.atan(half) * 180) / Math.PI;
  }

  apply(s: StageState, time: number, dt: number) {
    // 相机
    const az = (s.az * Math.PI) / 180;
    const el = (s.el * Math.PI) / 180;
    this.target.set(0, s.ty, 0);
    this.camera.position.set(
      s.dist * Math.sin(az) * Math.cos(el),
      s.ty + s.dist * Math.sin(el),
      s.dist * Math.cos(az) * Math.cos(el),
    );
    this.camera.lookAt(this.target);
    this.applyLens(SPEC.camera.hero.lens);
    this.camera.setViewOffset(this.width, this.height, -s.shiftX * this.width, s.shiftY * this.height, this.width, this.height);
    this.camera.updateProjectionMatrix();

    // 仪器
    this.spin += dt * 0.06;
    this.root.rotation.y = this.spin;
    this.layers.forEach((layer, i) => {
      layer.position.y = layerY(i, s.explode);
    });
    if (this.rotor) this.rotor.rotation.y = time * 2.4;
    if (this.platter) this.platter.rotation.y = -time * 1.1;

    const focus = s.focus;
    this.layerMats.forEach((mats, i) => {
      const d = focus < 0 ? 0 : Math.abs(i - focus);
      const lit = focus < 0 ? 1 : Math.max(0.18, 1 - d * 0.82);
      const id = LAYER_IDS[i];
      for (const m of mats) {
        if (m.base > 0) {
          let pulse = 1;
          if (id === 'mem' && m.kind === 'amber') pulse = 0.65 + 0.35 * Math.sin(time * 3.1);
          else if (id === 'net') pulse = 0.55 + 0.45 * (Math.sin(time * 5.3) > 0.2 ? 1 : 0.4);
          else if (id === 'cpu' && m.kind === 'amber') pulse = 0.7 + 0.3 * Math.sin(time * 1.7);
          else if (id === 'lens' && m.kind === 'amber') pulse = 0.85 + 0.15 * Math.sin(time * 2.2);
          m.mat.emissiveIntensity = m.base * pulse * (0.35 + 0.65 * lit) * (focus >= 0 && d < 0.5 ? 1.35 : 1);
        }
      }
    });

    // 聚焦环
    this.ring.visible = s.ring > 0.01 && focus >= 0;
    if (this.ring.visible) {
      const y = layerCenter(Math.round(focus), s.explode);
      const fi = Math.floor(focus);
      const ft = focus - fi;
      const y0 = layerCenter(Math.max(0, fi), s.explode);
      const y1 = layerCenter(Math.min(LAYER_IDS.length - 1, fi + 1), s.explode);
      this.ring.position.y = ft > 0 ? y0 + (y1 - y0) * ft : y;
      this.ring.rotation.y = -time * 0.3;
      this.ring.children.forEach((c) => (((c as Mesh).material as MeshBasicMaterial).opacity = s.ring));
    }

    // 海面与遥测流
    const sea = this.sea.material.uniforms;
    sea.uTime!.value = time;
    sea.uOpacity!.value = s.sea;
    sea.uPing!.value = ((time * 2.6) % 26) - 1;
    this.sea.visible = s.sea > 0.01;
    const st = this.stream.material.uniforms;
    st.uTime!.value = time;
    st.uOpacity!.value = s.stream;
    this.stream.visible = s.stream > 0.01;
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** 第 i 层（自下而上）右侧边缘在屏幕上的位置（CSS 像素）。 */
  anchor(i: number, s: StageState, side = 1): { x: number; y: number } {
    const right = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    right.y = 0;
    right.normalize().multiplyScalar(1.08 * side);
    const p = new Vector3(right.x, layerCenter(i, s.explode), right.z).project(this.camera);
    return { x: ((p.x + 1) / 2) * this.width, y: ((1 - p.y) / 2) * this.height };
  }

  dispose() {
    this.renderer.dispose();
    this.composer?.dispose();
  }
}

function glass(): MeshPhysicalMaterial {
  const m = new MeshPhysicalMaterial({
    name: 'glass',
    color: new Color('#0d1015'),
    metalness: 0,
    roughness: 0.03,
    transparent: true,
    opacity: 0.22,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    depthWrite: false,
  });
  m.envMapIntensity = 2.6;
  return m;
}
