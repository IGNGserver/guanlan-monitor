import {
  BackSide,
  BoxGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  Vector3,
  type Texture,
  type WebGLRenderer,
} from 'three';

/**
 * 与 Blender 摄影棚同构的环境光：近黑的房间里几块高亮柔光板。
 * 金属件的观感几乎全由反射决定，所以这里比加更多实时灯光更重要。
 */
export function studioEnvironment(renderer: WebGLRenderer): Texture {
  const scene = new Scene();
  const room = new Mesh(new BoxGeometry(30, 30, 30), new MeshBasicMaterial({ color: new Color('#050607'), side: BackSide }));
  scene.add(room);

  const target = new Vector3(0, 1, 0);
  const panel = (w: number, h: number, pos: [number, number, number], hex: string, power: number) => {
    const mat = new MeshBasicMaterial({ color: new Color(hex).multiplyScalar(power), side: DoubleSide });
    const m = new Mesh(new PlaneGeometry(w, h), mat);
    m.position.set(...pos);
    m.lookAt(target);
    scene.add(m);
  };
  // Blender (x, y, z) → Three (x, z, -y)
  panel(4.5, 3.2, [-4.5, 4.0, -3.5], '#dfe8ff', 5.5); // 左后轮廓光
  panel(0.35, 5.0, [4.2, 1.4, -1.2], '#ffd2a6', 7.0); // 右侧暖色窄条
  panel(0.5, 7.0, [-0.6, 6.0, -0.4], '#ffffff', 1.4); // 顶部细条
  panel(3.0, 2.2, [3.2, 0.2, -5.0], '#bcd2ff', 4.0); // 右后冷光
  panel(6.0, 2.0, [1.5, 1.2, 6.0], '#cfd8e6', 0.6); // 正面微弱补光

  const pmrem = new PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.02);
  pmrem.dispose();
  scene.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose();
      (o.material as MeshBasicMaterial).dispose();
    }
  });
  return rt.texture;
}
