"""观澜「观测单元 GL-01」—— Blender 构建脚本（设计源资产）。

由 design/observatory.json 生成一件七层同轴的精密仪器：每一层对应观澜实际采集的一类硬件
（网络 / 磁盘与存储池 / 内存 / 处理器 / 显卡 / 风扇），顶层是带脉冲波形与实时租约弧的观测窗；
海面点阵之上同时生成舰队分组星群信标（与站点 Three.js 场景同一坐标）。

产物：
  public/models/observatory.glb      站点 Three.js 场景加载的模型（经 gltfpack 压缩，见 design/DESIGN.md）
  design/renders/*.png               Cycles 渲染母版 → 首屏静帧、社交卡片

用法（Blender 4.2 LTS / 5.x）：
  blender -b -P design/blender/build_observatory.py -- \\
    --spec design/observatory.json --glb observatory_raw.glb \\
    --renders masters --samples 96 --blend design/blender/guanlan_observatory.blend
"""

import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

TAU = math.tau


# ---------------------------------------------------------------- spec / util

def cli_args():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def load_spec():
    if "SPEC" in globals():
        return globals()["SPEC"]
    argv = cli_args()
    path = argv[argv.index("--spec") + 1] if "--spec" in argv else "design/observatory.json"
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def hex_lin(value, alpha=1.0):
    value = value.lstrip("#")
    srgb = [int(value[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (*lin, alpha)


def M(x=0.0, y=0.0, z=0.0, rz=0.0, rx=0.0, ry=0.0):
    return (Matrix.Translation((x, y, z))
            @ Matrix.Rotation(rz, 4, "Z")
            @ Matrix.Rotation(ry, 4, "Y")
            @ Matrix.Rotation(rx, 4, "X"))


def polar(r, a, z=0.0, extra=0.0):
    """在半径 r、方位角 a 处放置零件，零件局部 +X 指向径向外侧。"""
    return M(r * math.cos(a), r * math.sin(a), z, rz=a + extra)


# ---------------------------------------------------------------- materials

def make_materials(pal):
    def principled(name, color, metallic=0.0, rough=0.5, emit=None, strength=0.0,
                   transmission=0.0, ior=1.45, coat=0.0):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = hex_lin(color)
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["IOR"].default_value = ior
        bsdf.inputs["Transmission Weight"].default_value = transmission
        bsdf.inputs["Coat Weight"].default_value = coat
        if emit:
            bsdf.inputs["Emission Color"].default_value = hex_lin(emit)
            bsdf.inputs["Emission Strength"].default_value = strength
        return mat

    return {
        "anodized": principled("anodized", pal["anodized"], 1.0, 0.34),
        "graphite": principled("graphite", pal["graphite"], 0.6, 0.44),
        "steel": principled("steel", pal["steel"], 1.0, 0.2),
        "alu": principled("alu", "#939aa4", 1.0, 0.28),
        "mirror": principled("mirror", "#dde2e9", 1.0, 0.045),
        "copper": principled("copper", pal["copper"], 1.0, 0.26),
        "silicon": principled("silicon", "#1d2230", 0.75, 0.12, coat=1.0),
        "pcb": principled("pcb", "#0e1315", 0.0, 0.55),
        "black": principled("black", "#08090b", 0.0, 0.62),
        "tick": principled("tick", pal["bone"], 0.0, 0.45, emit=pal["bone"], strength=0.65),
        "reticle": principled("reticle", pal["bone"], 0.0, 0.5, emit=pal["bone"], strength=0.2),
        "amber": principled("amber", pal["amber"], 0.0, 0.4, emit=pal["amber"], strength=5.2),
        "teal": principled("teal", pal["teal"], 0.0, 0.4, emit=pal["teal"], strength=8.2),
        "glass": principled("glass", "#ffffff", 0.0, 0.04, transmission=1.0, ior=1.45),
    }


# ---------------------------------------------------------------- bmesh primitives

def add_box(bm, sx, sy, sz, matrix):
    bmesh.ops.create_cube(bm, size=1.0, matrix=matrix @ Matrix.Diagonal((sx, sy, sz, 1.0)))


def add_cyl(bm, r, h, z, seg=96, matrix=None):
    base = matrix if matrix is not None else Matrix.Identity(4)
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg,
                          radius1=r, radius2=r, depth=h,
                          matrix=base @ Matrix.Translation((0, 0, z + h / 2)))


def add_annulus(bm, r0, r1, z0, z1, seg=160, a0=0.0, a1=TAU):
    """环形实体（或圆弧段）：r0 内半径，r1 外半径，[z0, z1] 高度，[a0, a1] 方位角。"""
    full = abs((a1 - a0) - TAU) < 1e-6
    n = seg if full else max(4, int(seg * (a1 - a0) / TAU))
    rings = []
    for i in range(n if full else n + 1):
        a = a0 + (a1 - a0) * i / n
        c, s = math.cos(a), math.sin(a)
        rings.append([bm.verts.new((r * c, r * s, z)) for r, z in
                      ((r0, z0), (r1, z0), (r1, z1), (r0, z1))])
    count = len(rings)
    for i in range(count if full else count - 1):
        p, q = rings[i], rings[(i + 1) % count]
        for k in range(4):
            k2 = (k + 1) % 4
            bm.faces.new((p[k], q[k], q[k2], p[k2]))
    if not full:
        bm.faces.new(tuple(reversed(rings[0])))
        bm.faces.new(tuple(rings[-1]))


def add_torus(bm, R, r, z, seg=128, rseg=12):
    grid = []
    for i in range(seg):
        a = TAU * i / seg
        row = []
        for j in range(rseg):
            b = TAU * j / rseg
            d = R + r * math.cos(b)
            row.append(bm.verts.new((d * math.cos(a), d * math.sin(a), z + r * math.sin(b))))
        grid.append(row)
    for i in range(seg):
        for j in range(rseg):
            a, b = grid[i][j], grid[(i + 1) % seg][j]
            c, d = grid[(i + 1) % seg][(j + 1) % rseg], grid[i][(j + 1) % rseg]
            bm.faces.new((a, b, c, d))


def add_blade(bm, angle, z, r_in=0.2, r_out=0.9, steps=12, thick=0.012):
    """风扇叶片：沿半径逐段改变弦长、攻角与后掠，截面为薄矩形。"""
    sections = []
    for i in range(steps + 1):
        t = i / steps
        r = r_in + (r_out - r_in) * t
        chord = 0.15 + 0.1 * t
        pitch = math.radians(40 - 18 * t)
        sweep = angle + 0.42 * t ** 1.4
        pts = []
        for u, v in ((-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)):
            tang = u * chord * math.cos(pitch) - v * thick * math.sin(pitch)
            axial = u * chord * math.sin(pitch) + v * thick * math.cos(pitch)
            x = r * math.cos(sweep) - tang * math.sin(sweep)
            y = r * math.sin(sweep) + tang * math.cos(sweep)
            pts.append(bm.verts.new((x, y, z + axial)))
        sections.append(pts)
    for p, q in zip(sections, sections[1:]):
        for k in range(4):
            k2 = (k + 1) % 4
            bm.faces.new((p[k], q[k], q[k2], p[k2]))
    bm.faces.new(tuple(reversed(sections[0])))
    bm.faces.new(tuple(sections[-1]))


# ---------------------------------------------------------------- builder

class Builder:
    """按 (组, 材质) 累积几何；组名 'fan' 或 'fan/rotor'。"""

    def __init__(self):
        self.parts = {}

    def bm(self, group, mat, bevel=True):
        key = (group, mat)
        if key not in self.parts:
            self.parts[key] = (bmesh.new(), bevel)
        return self.parts[key][0]


def layer_net(b, h):
    a = b.bm("net", "anodized")
    add_annulus(a, 0.86, 1.0, 0.0, 0.07)
    add_annulus(a, 0.86, 1.0, 0.17, h)
    add_annulus(b.bm("net", "steel"), 0.992, 1.002, 0.068, 0.074)
    g = b.bm("net", "graphite")
    add_annulus(g, 0.86, 0.962, 0.07, 0.17)
    add_cyl(g, 0.86, 0.2, 0.0)
    add_cyl(b.bm("net", "anodized"), 0.2, 0.05, 0.2)
    add_annulus(b.bm("net", "steel"), 0.3, 0.315, 0.2, 0.206)
    ports = b.bm("net", "black", bevel=False)
    for i in range(24):
        ang = TAU * i / 24
        add_box(ports, 0.03, 0.075, 0.05, polar(0.962, ang, 0.115))
        led = "teal" if i % 3 == 0 else "amber"
        add_box(b.bm("net", led, bevel=False), 0.012, 0.018, 0.01, polar(0.968, ang, 0.153))
    for i in range(6):
        ang = TAU * i / 6 + TAU / 12
        add_box(b.bm("net", "steel"), 0.2, 0.08, 0.04, polar(0.56, ang, 0.22))
        add_box(b.bm("net", "amber", bevel=False), 0.014, 0.014, 0.008, polar(0.67, ang, 0.24))
    # 四组实时双向通道（/api/agent/realtime）收发模块：青色双灯带表达 15 秒 challenge/pong 租约
    for i in range(4):
        ang = TAU * i / 4
        add_box(b.bm("net", "alu"), 0.14, 0.095, 0.036, polar(0.76, ang, 0.218))
        add_box(b.bm("net", "teal", bevel=False), 0.09, 0.01, 0.006, polar(0.76, ang, 0.238) @ M(0, -0.022, 0))
        add_box(b.bm("net", "teal", bevel=False), 0.09, 0.01, 0.006, polar(0.76, ang, 0.238) @ M(0, 0.022, 0))


def layer_disk(b, h):
    for i in range(6):
        a0 = TAU * i / 6
        add_annulus(b.bm("disk", "anodized"), 0.95, 1.0, 0.0, h, a0=a0, a1=a0 + math.radians(42))
    add_cyl(b.bm("disk", "graphite"), 0.95, 0.025, 0.0)
    # 旋转磁盘碟片与磁头臂（物理盘）
    add_cyl(b.bm("disk/platter", "mirror"), 0.78, 0.012, 0.064)
    add_cyl(b.bm("disk/platter", "steel"), 0.13, 0.06, 0.038)
    add_annulus(b.bm("disk/platter", "steel"), 0.13, 0.17, 0.078, 0.086)
    pivot = Vector((0.7, -0.45, 0.0))
    tip = Vector((0.12, -0.24, 0.0))
    d = tip - pivot
    ang = math.atan2(d.y, d.x)
    mid = (pivot + tip) / 2
    add_cyl(b.bm("disk", "steel"), 0.07, 0.08, 0.03, matrix=M(pivot.x, pivot.y))
    add_box(b.bm("disk", "steel"), d.length, 0.05, 0.012, M(mid.x, mid.y, 0.09, rz=ang))
    add_box(b.bm("disk", "amber", bevel=False), 0.04, 0.03, 0.01, M(tip.x, tip.y, 0.085, rz=ang))

    # 对侧扇区：虚拟化宿主机存储池阵列模块（PVE LVM-thin / ZFS / NVMe 阵列托架与水位刻度）
    sled_alu = b.bm("disk", "alu")
    sled_dark = b.bm("disk", "graphite")
    for k in range(5):
        sa = math.radians(74 + k * 37)
        add_box(sled_dark, 0.24, 0.105, 0.038, polar(0.815, sa, 0.114))
        for f in (-0.032, 0.0, 0.032):
            add_box(sled_alu, 0.21, 0.012, 0.012, polar(0.815, sa, 0.138) @ M(0, f, 0))
        # 在线池状态点（青）+ 容量水位刻度条（琥珀）
        add_box(b.bm("disk", "teal", bevel=False), 0.014, 0.018, 0.008, polar(0.922, sa, 0.136) @ M(0, -0.028, 0))
        fill = 0.08 + (k % 3) * 0.038
        add_box(b.bm("disk", "amber", bevel=False), fill, 0.008, 0.006, polar(0.75 + fill / 2, sa, 0.146) @ M(0, 0.028, 0))


def layer_mem(b, h):
    for i in range(8):
        a0 = TAU * i / 8
        add_annulus(b.bm("mem", "anodized"), 0.96, 1.0, 0.0, h, a0=a0, a1=a0 + math.radians(30))
    add_cyl(b.bm("mem", "graphite"), 0.96, 0.02, 0.0)
    add_cyl(b.bm("mem", "anodized"), 0.3, 0.3, 0.02)
    add_annulus(b.bm("mem", "teal", bevel=False), 0.3, 0.318, 0.26, 0.268)
    latches = b.bm("mem", "steel")
    for i in range(16):
        ang = TAU * i / 16
        add_box(b.bm("mem", "graphite"), 0.5, 0.022, 0.27, polar(0.61, ang, 0.165))
        add_box(b.bm("mem", "amber", bevel=False), 0.46, 0.006, 0.006, polar(0.61, ang, 0.303))
        add_box(b.bm("mem", "copper", bevel=False), 0.46, 0.026, 0.014, polar(0.61, ang, 0.037))
        add_box(latches, 0.024, 0.034, 0.075, polar(0.875, ang, 0.26))
        chips = b.bm("mem", "black", bevel=False)
        for k in range(6):
            r = 0.4 + k * 0.08
            for side in (-1, 1):
                add_box(chips, 0.06, 0.006, 0.06, polar(r, ang, 0.18) @ M(0, side * 0.013, 0))


def layer_cpu(b, h):
    for i in range(12):
        a0 = TAU * i / 12
        add_annulus(b.bm("cpu", "anodized"), 0.97, 1.0, 0.0, h, a0=a0, a1=a0 + math.radians(26))
    add_cyl(b.bm("cpu", "anodized"), 0.97, 0.04, 0.0)
    traces = b.bm("cpu", "copper", bevel=False)
    for i in range(96):
        add_box(traces, 0.44, 0.006, 0.004, polar(0.7, TAU * i / 96, 0.042))
    add_box(b.bm("cpu", "pcb"), 0.66, 0.66, 0.03, M(z=0.055))
    # 扣具压框（提亮深色封装轮廓）
    ilm = b.bm("cpu", "steel")
    for s in (-0.275, 0.275):
        add_box(ilm, 0.58, 0.028, 0.016, M(0, s, 0.078))
        add_box(ilm, 0.028, 0.52, 0.016, M(s, 0, 0.078))
    add_box(b.bm("cpu", "amber", bevel=False), 0.44, 0.44, 0.006, M(z=0.073))
    cells = b.bm("cpu", "silicon")
    for ix in range(4):
        for iy in range(4):
            add_box(cells, 0.1, 0.1, 0.024, M(-0.165 + ix * 0.11, -0.165 + iy * 0.11, 0.084))
    for sx in (-1, 1):
        for sy in (-1, 1):
            add_cyl(b.bm("cpu", "steel"), 0.03, 0.09, 0.04, matrix=M(sx * 0.52, sy * 0.52))


def layer_gpu(b, h):
    add_annulus(b.bm("gpu", "steel"), 0.46, 1.0, 0.0, 0.02)
    add_annulus(b.bm("gpu", "steel"), 0.46, 1.0, h - 0.02, h)
    add_cyl(b.bm("gpu", "copper"), 0.44, h, 0.0)
    fins = b.bm("gpu", "alu")
    for i in range(72):
        add_box(fins, 0.5, 0.01, h - 0.04, polar(0.72, TAU * i / 72, h / 2))
    for R, z in ((0.6, 0.08), (0.76, 0.15), (0.9, 0.22)):
        add_torus(b.bm("gpu", "copper", bevel=False), R, 0.018, z)
    # 外缘多引擎负载导光柱（呼应多显卡实例与进程级最忙 GPU 引擎采样）
    shroud = b.bm("gpu", "anodized")
    glow = b.bm("gpu", "amber", bevel=False)
    for i in range(6):
        ang = TAU * i / 6
        add_box(shroud, 0.032, 0.09, h - 0.04, polar(0.982, ang, h / 2))
        add_box(glow, 0.01, 0.048, h * 0.52, polar(0.996, ang, h / 2))


def layer_fan(b, h):
    add_annulus(b.bm("fan", "anodized"), 0.92, 1.0, 0.0, h)
    add_annulus(b.bm("fan", "alu"), 0.916, 0.936, h - 0.014, h)
    g = b.bm("fan", "graphite")
    for i in range(4):
        add_box(g, 0.75, 0.03, 0.015, polar(0.555, TAU * i / 4 + TAU / 8, 0.0075))
    add_annulus(g, 0.5, 0.53, 0.0, 0.015)
    add_cyl(b.bm("fan/rotor", "graphite"), 0.18, 0.13, 0.025)
    add_annulus(b.bm("fan/rotor", "alu"), 0.172, 0.186, 0.138, 0.154)
    add_cyl(b.bm("fan/rotor", "steel"), 0.12, 0.01, 0.155)
    blades = b.bm("fan/rotor", "graphite")
    for i in range(9):
        add_blade(blades, TAU * i / 9, 0.09, r_in=0.17, r_out=0.9)


def layer_lens(b, h, spec):
    add_annulus(b.bm("lens", "anodized"), 0.78, 1.0, 0.0, h)
    add_annulus(b.bm("lens", "steel"), 0.74, 0.78, 0.0, h - 0.02)
    add_cyl(b.bm("lens", "black"), 0.74, 0.02, 0.0)
    ticks = b.bm("lens", "tick", bevel=False)
    for i in range(120):
        major = i % 10 == 0
        length = 0.1 if major else 0.045
        width = 0.008 if major else 0.004
        add_box(ticks, length, width, 0.004, polar(0.81 + length / 2, TAU * i / 120, h + 0.002))
    reticle = b.bm("lens", "reticle", bevel=False)
    for r in (0.2, 0.4, 0.6):
        add_annulus(reticle, r, r + 0.0025, 0.02, 0.022)
    add_box(reticle, 1.44, 0.0025, 0.002, M(z=0.021))
    add_box(reticle, 0.0025, 1.44, 0.002, M(z=0.021))
    teal = b.bm("lens", "teal", bevel=False)
    add_cyl(teal, 0.022, 0.01, h, matrix=M(*(0.94 * Vector((math.cos(0.9), math.sin(0.9), 0)))))
    # 外圈三段青色租约刻度弧，呼应 15 秒实时会话租约
    for k in range(3):
        a0 = 0.9 + 0.16 + k * 0.22
        add_annulus(teal, 0.935, 0.948, h + 0.001, h + 0.006, seg=96, a0=a0, a1=a0 + 0.13)

    # 脉冲波形：与产品图标同一走势，悬在观测窗中央
    curve = bpy.data.curves.new("pulse_curve", "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = 0.0115
    curve.bevel_resolution = 4
    curve.use_fill_caps = True
    spline = curve.splines.new("POLY")
    pts = spec["pulse"]
    spline.points.add(len(pts) - 1)
    for p, (x, y) in zip(spline.points, pts):
        p.co = (x, 0.0, 0.22 + y * 0.9, 1.0)
    tmp = bpy.data.objects.new("pulse_tmp", curve)
    bpy.context.scene.collection.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    mesh = tmp.evaluated_get(dg).to_mesh()
    b.bm("lens/pulse", "amber", bevel=False).from_mesh(mesh)
    tmp.evaluated_get(dg).to_mesh_clear()
    bpy.data.objects.remove(tmp)
    bpy.data.curves.remove(curve)

    dome = b.bm("lens/dome", "glass", bevel=False)
    bmesh.ops.create_uvsphere(dome, u_segments=96, v_segments=48, radius=0.76,
                              matrix=M(z=h - 0.02) @ Matrix.Diagonal((1, 1, 0.55, 1)))
    bmesh.ops.delete(dome, geom=[v for v in dome.verts if v.co.z < h - 0.021], context="VERTS")


LAYERS = {"net": layer_net, "disk": layer_disk, "mem": layer_mem, "cpu": layer_cpu,
          "gpu": layer_gpu, "fan": layer_fan}


# ---------------------------------------------------------------- assemble

def build():
    spec = load_spec()
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        for item in list(coll):
            coll.remove(item)
    col = bpy.context.scene.collection
    mats = make_materials(spec["palette"])

    root = bpy.data.objects.new("GL01", None)
    col.objects.link(root)
    z = 0.0
    empties = {}
    for layer in spec["layers"]:
        lid, h = layer["id"], layer["h"]
        empty = bpy.data.objects.new(f"L_{lid}", None)
        empty.location = (0, 0, z)
        empty.parent = root
        empty["label"] = layer["label"]
        col.objects.link(empty)
        empties[lid] = empty
        b = Builder()
        if lid == "lens":
            layer_lens(b, h, spec)
        else:
            LAYERS[lid](b, h)
        for (group, mname), (bm, bevel) in b.parts.items():
            parent = empty
            if "/" in group:
                sub = group.split("/")[1]
                sub_name = {"rotor": "fan_rotor", "platter": "disk_platter"}.get(sub, f"{lid}_{sub}")
                if sub_name not in empties:
                    e = bpy.data.objects.new(sub_name, None)
                    e.parent = empty
                    col.objects.link(e)
                    empties[sub_name] = e
                parent = empties[sub_name]
            name = f"{group.replace('/', '_')}_{mname}"
            me = bpy.data.meshes.new(name)
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            bm.to_mesh(me)
            bm.free()
            me.materials.append(mats[mname])
            me.shade_smooth()
            if hasattr(me, "set_sharp_from_angle"):
                me.set_sharp_from_angle(angle=math.radians(32))
            ob = bpy.data.objects.new(name, me)
            ob.parent = parent
            col.objects.link(ob)
            if bevel:
                mod = ob.modifiers.new("bevel", "BEVEL")
                mod.width = 0.0035
                mod.segments = 2
                mod.limit_method = "ANGLE"
                mod.angle_limit = math.radians(40)
                mod.harden_normals = True
        z += h + spec["seam"]
    return root


def wave_height(w, x, y, t=0.0):
    """与站点着色器（src/scripts/observatory/shaders.ts）同一公式。"""
    h = 0.0
    for c in w["components"]:
        dx, dy = c["dir"]
        n = math.hypot(dx, dy)
        h += c["amp"] * math.sin(c["k"] * (dx * x + dy * y) / n + c["speed"] * t + c["phase"])
    r = math.hypot(x, y)
    rp = w["ripple"]
    h += rp["amp"] * math.sin(rp["k"] * r - rp["speed"] * t) * math.exp(-rp["decay"] * r)
    return h


def build_sea():
    """海面点阵与舰队星群信标（仅用于 Blender 静帧；站点端由着色器实时计算）。"""
    spec = load_spec()
    w = spec["waves"]
    for name in ("sea", "sea_beacons_teal", "sea_beacons_amber", "sea_beacon_lines"):
        if name in bpy.data.objects:
            bpy.data.objects.remove(bpy.data.objects[name])
    n, size = w["res"], w["size"]
    me = bpy.data.meshes.new("sea")
    coords, heights = [], []
    for i in range(n):
        for j in range(n):
            x = -size / 2 + size * i / (n - 1)
            y = -size / 2 + size * j / (n - 1)
            h = wave_height(w, x, y)
            coords.append((x, y, w["z"] + h))
            heights.append(h)
    me.vertices.add(len(coords))
    me.vertices.foreach_set("co", [c for v in coords for c in v])
    attr = me.attributes.new("h", "FLOAT", "POINT")
    attr.data.foreach_set("value", heights)
    ob = bpy.data.objects.new("sea", me)
    bpy.context.scene.collection.objects.link(ob)

    mat = bpy.data.materials.get("sea_dot") or bpy.data.materials.new("sea_dot")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    attr_n = nt.nodes.new("ShaderNodeAttribute")
    attr_n.attribute_name = "h"
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = hex_lin("#5d6470")
    ramp.color_ramp.elements[1].position = 0.75
    ramp.color_ramp.elements[1].color = hex_lin(spec["palette"]["amber"])
    scale = nt.nodes.new("ShaderNodeMapRange")
    scale.inputs["From Min"].default_value = -0.25
    scale.inputs["From Max"].default_value = 0.25
    cam = nt.nodes.new("ShaderNodeCameraData")
    fade = nt.nodes.new("ShaderNodeMapRange")
    fade.inputs["From Min"].default_value = 4.0
    fade.inputs["From Max"].default_value = 22.0
    fade.inputs["To Min"].default_value = 2.2
    fade.inputs["To Max"].default_value = 0.0
    nt.links.new(attr_n.outputs["Fac"], scale.inputs["Value"])
    nt.links.new(scale.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], emit.inputs["Color"])
    nt.links.new(cam.outputs["View Distance"], fade.inputs["Value"])
    nt.links.new(fade.outputs["Result"], emit.inputs["Strength"])
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])

    tree = bpy.data.node_groups.get("sea_points") or bpy.data.node_groups.new("sea_points", "GeometryNodeTree")
    tree.nodes.clear()
    tree.interface.clear()
    tree.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    tree.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    gin = tree.nodes.new("NodeGroupInput")
    gout = tree.nodes.new("NodeGroupOutput")
    m2p = tree.nodes.new("GeometryNodeMeshToPoints")
    m2p.inputs["Radius"].default_value = 0.011
    setm = tree.nodes.new("GeometryNodeSetMaterial")
    setm.inputs["Material"].default_value = mat
    tree.links.new(gin.outputs[0], m2p.inputs["Mesh"])
    tree.links.new(m2p.outputs["Points"], setm.inputs["Geometry"])
    tree.links.new(setm.outputs["Geometry"], gout.inputs[0])
    mod = ob.modifiers.new("points", "NODES")
    mod.node_group = tree

    def emit_mat(mname, color, strength):
        m = bpy.data.materials.get(mname) or bpy.data.materials.new(mname)
        m.use_nodes = True
        mnt = m.node_tree
        mnt.nodes.clear()
        mout = mnt.nodes.new("ShaderNodeOutputMaterial")
        mem = mnt.nodes.new("ShaderNodeEmission")
        mem.inputs["Color"].default_value = hex_lin(color)
        mem.inputs["Strength"].default_value = strength
        mnt.links.new(mem.outputs["Emission"], mout.inputs["Surface"])
        return m

    mat_b_teal = emit_mat("sea_beacon_teal_mat", spec["palette"]["teal"], 1.9)
    mat_b_amber = emit_mat("sea_beacon_amber_mat", spec["palette"]["amber"], 2.1)
    mat_b_line = emit_mat("sea_beacon_line_mat", spec["palette"]["teal"], 0.42)

    bm_teal = bmesh.new()
    bm_amber = bmesh.new()
    bm_line = bmesh.new()
    for cl in spec.get("clusters", []):
        nodes = cl["nodes"]
        for x, y, health in nodes:
            hz = w["z"] + wave_height(w, x, y) + 0.035
            target_bm = bm_teal if health > 0.75 else bm_amber
            add_cyl(target_bm, 0.032, 0.01, 0.0, seg=28, matrix=M(x, y, hz))
            ring_tmp = bmesh.new()
            add_annulus(ring_tmp, 0.068, 0.078, 0.0, 0.004, seg=40)
            bmesh.ops.translate(ring_tmp, verts=ring_tmp.verts, vec=(x, y, hz))
            tmp_me = bpy.data.meshes.new("_ring_tmp")
            ring_tmp.to_mesh(tmp_me)
            ring_tmp.free()
            target_bm.from_mesh(tmp_me)
            bpy.data.meshes.remove(tmp_me)
        for i in range(len(nodes)):
            for j in range(i + 1, len(nodes)):
                x0, y0, _ = nodes[i]
                x1, y1, _ = nodes[j]
                steps = 8
                for s in range(steps):
                    t0, t1 = s / steps, (s + 1) / steps
                    ax, ay = x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0
                    bx, by = x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1
                    az = w["z"] + wave_height(w, ax, ay) + 0.028
                    bz = w["z"] + wave_height(w, bx, by) + 0.028
                    dv = Vector((bx - ax, by - ay, bz - az))
                    mid = Vector(((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2))
                    rot = dv.normalized().to_track_quat("X", "Z").to_matrix().to_4x4()
                    add_box(bm_line, dv.length * 0.92, 0.0035, 0.0025, Matrix.Translation(mid) @ rot)

    for bname, bm_src, bmat in (
        ("sea_beacons_teal", bm_teal, mat_b_teal),
        ("sea_beacons_amber", bm_amber, mat_b_amber),
        ("sea_beacon_lines", bm_line, mat_b_line),
    ):
        bme = bpy.data.meshes.new(bname)
        bm_src.to_mesh(bme)
        bm_src.free()
        bme.materials.append(bmat)
        bob = bpy.data.objects.new(bname, bme)
        bpy.context.scene.collection.objects.link(bob)

    return ob


def set_sea_visible(vis):
    for name in ("sea", "sea_beacons_teal", "sea_beacons_amber", "sea_beacon_lines"):
        ob = bpy.data.objects.get(name)
        if ob:
            ob.hide_render = not vis


def explode(factor):
    """factor = 0 组装态；1 = 每层之间额外拉开 spec['explode'] 米。"""
    spec = load_spec()
    z = 0.0
    for i, layer in enumerate(spec["layers"]):
        bpy.data.objects[f"L_{layer['id']}"].location.z = z + i * spec["explode"] * factor
        z += layer["h"] + spec["seam"]


def stage(distance=7.0, elevation=18.0, azimuth=-32.0, lens=50, target=(0, 0, 0.95),
          res=(1600, 1000), dof=None, shift=(0.0, 0.0)):
    """摄影棚：近黑背景，左后方大面积冷白轮廓光 + 右侧暖色窄条光 + 顶部柔光。"""
    for ob in [o for o in bpy.data.objects if o.type in {"CAMERA", "LIGHT"}]:
        bpy.data.objects.remove(ob)
    scene = bpy.context.scene
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = hex_lin("#07090c")
    bg.inputs["Strength"].default_value = 1.0

    def area(name, loc, size, energy, color, shape="RECTANGLE", size_y=None):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.color = hex_lin(color)[:3]
        data.shape = shape
        data.size = size
        if size_y:
            data.size_y = size_y
        ob = bpy.data.objects.new(name, data)
        ob.location = loc
        scene.collection.objects.link(ob)
        direction = Vector(target) - Vector(loc)
        ob.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        return ob

    area("rim_left", (-4.5, 3.5, 4.0), 3.0, 980, "#dfe8ff")
    area("strip_right", (4.2, 1.2, 1.4), 0.28, 460, "#ffd2a6", size_y=4.2)
    area("top_strip", (-0.6, 0.4, 6.0), 0.38, 300, "#ffffff", size_y=6.0)
    area("front_fill", (1.5, -6.0, 1.2), 5.0, 110, "#cfd8e6")
    area("rim_back", (3.2, 5.0, 0.2), 2.2, 760, "#bcd2ff")

    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = lens
    cam_data.sensor_width = 36
    cam_data.sensor_fit = "AUTO"
    cam_data.shift_x, cam_data.shift_y = shift
    if dof:
        cam_data.dof.use_dof = True
        cam_data.dof.focus_distance = dof[0]
        cam_data.dof.aperture_fstop = dof[1]
    cam = bpy.data.objects.new("cam", cam_data)
    el, az = math.radians(elevation), math.radians(azimuth)
    t = Vector(target)
    cam.location = t + distance * Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    cam.rotation_euler = (t - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    return cam


def render(path, engine="CYCLES", samples=96):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES" if engine == "CYCLES" else "BLENDER_EEVEE"
    if engine == "CYCLES":
        scene.cycles.samples = samples
        scene.cycles.use_denoising = True
        try:
            prefs = bpy.context.preferences.addons["cycles"].preferences
            prefs.compute_device_type = "OPTIX"
            prefs.get_devices()
            gpu_found = any(d.type != "CPU" for d in prefs.devices)
            if gpu_found:
                for d in prefs.devices:
                    d.use = True
                scene.cycles.device = "GPU"
            else:
                scene.cycles.device = "CPU"
        except Exception:
            scene.cycles.device = "CPU"
    else:
        scene.eevee.taa_render_samples = samples
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_depth = "16" if engine == "CYCLES" else "8"
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def render_masters(out_dir, samples=96):
    """站点用到的三张渲染母版。机位与 src/scripts/observatory/director.ts 的关键帧一致。"""
    os.makedirs(out_dir, exist_ok=True)
    spec = load_spec()
    h = spec["camera"]["hero"]
    shots = []
    explode(0.0)
    if "sea" not in bpy.data.objects:
        build_sea()
    set_sea_visible(True)
    # 1. 首屏横版：物体右移 shiftX（Blender 的 shift_x 方向相反）
    stage(distance=h["distance"], elevation=h["elevation"], azimuth=h["azimuth"], lens=h["lens"],
          target=tuple(h["target"]), res=(2560, 1440), shift=(-h.get("shiftX", 0.0), 0.0))
    shots.append(render(os.path.join(out_dir, "hero.png"), samples=samples))
    # 2. 首屏竖版（手机）：距离 ×1.12，物体上移 0.2 个画面高度
    stage(distance=h["distance"] * 1.12, elevation=h["elevation"], azimuth=h["azimuth"], lens=h["lens"],
          target=tuple(h["target"]), res=(1080, 1920), shift=(0.0, -0.2))
    shots.append(render(os.path.join(out_dir, "hero-portrait.png"), samples=samples))
    # 3. 爆炸视图（无 WebGL 时的剖面静帧）
    explode(1.0)
    set_sea_visible(False)
    bases, z = [], 0.0
    for layer in spec["layers"]:
        bases.append(z)
        z += layer["h"] + spec["seam"]
    mid = bases[3] + 3 * spec["explode"] + spec["layers"][3]["h"] / 2
    stage(distance=11.6, elevation=20, azimuth=-34, lens=h["lens"], target=(0, 0, mid), res=(1400, 1600))
    shots.append(render(os.path.join(out_dir, "exploded.png"), samples=samples))
    explode(0.0)
    set_sea_visible(True)
    stage(distance=h["distance"], elevation=h["elevation"], azimuth=h["azimuth"], lens=h["lens"],
          target=tuple(h["target"]), res=(2560, 1440), shift=(-h.get("shiftX", 0.0), 0.0))
    return shots


def export_glb(path):
    bpy.ops.object.select_all(action="DESELECT")
    root = bpy.data.objects["GL01"]
    for ob in [root, *root.children_recursive]:
        ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_apply=True, use_selection=True,
                              export_yup=True, export_cameras=False, export_lights=False,
                              export_extras=True, export_materials="EXPORT")


if __name__ == "__main__":
    build()
    argv = cli_args()
    if "--glb" in argv:
        export_glb(argv[argv.index("--glb") + 1])
    samples = int(argv[argv.index("--samples") + 1]) if "--samples" in argv else 96
    if "--renders" in argv:
        render_masters(argv[argv.index("--renders") + 1], samples=samples)
    if "--blend" in argv:
        if "sea" not in bpy.data.objects:
            build_sea()
            h = load_spec()["camera"]["hero"]
            stage(distance=h["distance"], elevation=h["elevation"], azimuth=h["azimuth"], lens=h["lens"],
                  target=tuple(h["target"]), res=(2560, 1440), shift=(-h.get("shiftX", 0.0), 0.0))
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(argv[argv.index("--blend") + 1]), compress=True)
