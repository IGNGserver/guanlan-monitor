// 把 Blender 导出的原始 GLB 压缩成站点使用的模型：
//   node design/tools/model.mjs <observatory_raw.glb>
// gltfpack：meshopt 压缩（-cc）+ 顶点量化（默认），保留节点名（-kn，站点按 L_<层> / fan_rotor / disk_platter 取节点）
// 与材质名（-km，站点按材质名覆写玻璃与自发光）。站点端用 three 的 MeshoptDecoder 解码。
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const input = process.argv[2];
if (!input) {
  console.error('用法：node design/tools/model.mjs <observatory_raw.glb>');
  process.exit(1);
}
const output = path.join(root, 'public/models/observatory.glb');
execFileSync(path.join(root, 'node_modules/.bin/gltfpack'), ['-i', input, '-o', output, '-cc', '-kn', '-km'], { stdio: 'inherit' });
console.log('wrote', path.relative(root, output), statSync(output).size, 'bytes');
