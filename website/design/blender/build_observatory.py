"""观澜「观测单元 GL-01」—— Blender 构建脚本（设计源资产）。

由 design/observatory.json 生成一件七层同轴的精密仪器：每一层对应观澜实际采集的一类硬件
（网络 / 磁盘 / 内存 / 处理器 / 显卡 / 风扇），顶层是带脉冲波形的观测窗（呼应产品图标）。

产物：
  public/models/observatory.glb      站点 Three.js 场景加载的模型（经 gltfpack 压缩，见 design/DESIGN.md）
  design/renders/*.png               Cycles 渲染母版 → 首屏静帧、社交卡片

用法（Blender 5.2）：
  blender -b -P design/blender/build_observatory.py -- --spec design/observatory.json --glb out.glb
或在已连接的 Blender 会话里先定义全局 SPEC（dict）再执行本文件内容，然后调用 build()。

约定：每层以一个 Empty（L_<id>）为根，几何按层内局部坐标（底面 z = 0）构建，Empty 放在组装位置。
站点据此只需沿竖直轴平移各层即可做「爆炸视图」；可动部件（fan_rotor、disk_platter）是单独的 Empty。
同一层同一材质的零件合并为一个网格，控制 draw call 数量。
"""

import json
import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

TAU = math.tau


# ---------------------------------------------------------------- spec / util

def load_spec():
    if "SPEC" in globals():
        return globals()["SPEC"]
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
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
        "anodized": principled("anodized", pal["anodized"], 1.0, 0.36),
        "graphite": principled("graphite", pal["graphite"], 0.55, 0.48),
        "steel": principled("steel", pal["steel"], 1.0, 0.2),
        "alu": principled("alu", "#8c939c", 1.0, 0.3),
        "mirror": principled("mirror", "#d9dee5", 1.0, 0.05),
        "copper": principled("copper", pal["copper"], 1.0, 0.28),
        "silicon": principled("silicon", "#1d2230", 0.75, 0.12, coat=1.0),
        "pcb": principled("pcb", "#0e1315", 0.0, 0.55),
        "black": principled("black", "#08090b", 0.0, 0.62),
        "tick": principled("tick", pal["bone"], 0.0, 0.45, emit=pal["bone"], strength=0.6),
        "reticle": principled("reticle", pal["bone"], 0.0, 0.5, emit=pal["bone"], strength=0.18),
        "amber": principled("amber", pal["amber"], 0.0, 0.4, emit=pal["amber"], strength=5.0),
        "teal": principled("teal", pal["teal"], 0.0, 0.4, emit=pal["teal"], strength=8.0),
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
    g = b.bm("net", "graphite")
    add_annulus(g, 0.86, 0.962, 0.07, 0.17)
    add_cyl(g, 0.86, 0.2, 0.0)
    add_cyl(b.bm("net", "anodized"), 0.2, 0.05, 0.2)
    add_annulus(b.bm("net", "steel"), 0.3, 0.315, 0.2, 0.206)
    ports = b.bm("net", "black", bevel=False)
    for i in range(24):
        ang = TAU * i / 24
        add_box(ports, 0.03, 0.075, 0.05, polar(0.962, ang, 0.115))
        led = "teal" if i % 4 == 0 else "amber"
        add_box(b.bm("net", led, bevel=False), 0.012, 0.018, 0.01, polar(0.968, ang, 0.153))
    for i in range(6):
        ang = TAU * i / 6 + TAU / 12
        add_box(b.bm("net", "steel"), 0.2, 0.08, 0.04, polar(0.56, ang, 0.22))
        add_box(b.bm("net", "amber", bevel=False), 0.014, 0.014, 0.008, polar(0.67, ang, 0.24))


def layer_disk(b, h):
    for i in range(6):
        a0 = TAU * i / 6
        add_annulus(b.bm("disk", "anodized"), 0.95, 1.0, 0.0, h, a0=a0, a1=a0 + math.radians(42))
    add_cyl(b.bm("disk", "graphite"), 0.95, 0.025, 0.0)
    add_cyl(b.bm("disk/platter", "mirror"), 0.8, 0.012, 0.07)
    add_cyl(b.bm("disk/platter", "steel"), 0.13, 0.06, 0.04)
    add_annulus(b.bm("disk/platter", "steel"), 0.13, 0.17, 0.082, 0.09)
    pivot = Vector((0.7, -0.45, 0.0))
    tip = Vector((0.12, -0.24, 0.0))
    d = tip - pivot
    ang = math.atan2(d.y, d.x)
    mid = (pivot + tip) / 2
    add_cyl(b.bm("disk", "steel"), 0.07, 0.08, 0.03, matrix=M(pivot.x, pivot.y))
    add_box(b.bm("disk", "steel"), d.length, 0.05, 0.012, M(mid.x, mid.y, 0.092, rz=ang))
    add_box(b.bm("disk", "amber", bevel=False), 0.04, 0.03, 0.01, M(tip.x, tip.y, 0.087, rz=ang))


def layer_mem(b, h):
    for i in range(8):
        a0 = TAU * i / 8
        add_annulus(b.bm("mem", "anodized"), 0.96, 1.0, 0.0, h, a0=a0, a1=a0 + math.radians(30))
    add_cyl(b.bm("mem", "graphite"), 0.96, 0.02, 0.0)
    add_cyl(b.bm("mem", "anodized"), 0.3, 0.3, 0.02)
    add_annulus(b.bm("mem", "teal", bevel=False), 0.3, 0.318, 0.26, 0.268)
    for i in range(16):
        ang = TAU * i / 16
        add_box(b.bm("mem", "graphite"), 0.5, 0.022, 0.27, polar(0.61, ang, 0.165))
        add_box(b.bm("mem", "amber", bevel=False), 0.46, 0.006, 0.006, polar(0.61, ang, 0.303))
        add_box(b.bm("mem", "copper", bevel=False), 0.46, 0.026, 0.014, polar(0.61, ang, 0.037))
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


def layer_fan(b, h):
    add_annulus(b.bm("fan", "anodized"), 0.92, 1.0, 0.0, h)
    g = b.bm("fan", "graphite")
    for i in range(4):
        add_box(g, 0.75, 0.03, 0.015, polar(0.555, TAU * i / 4 + TAU / 8, 0.0075))
    add_annulus(g, 0.5, 0.53, 0.0, 0.015)
    add_cyl(b.bm("fan/rotor", "graphite"), 0.18, 0.13, 0.025)
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
    add_cyl(b.bm("lens", "teal", bevel=False), 0.02, 0.01, h, matrix=M(*(0.94 * Vector((math.cos(0.9), math.sin(0.9), 0)))))

    # 脉冲波形：与产品图标同一走势，悬在观测窗中央
    curve = bpy.data.curves.new("pulse_curve", "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = 0.011
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
    """海面点阵（仅用于 Blender 静帧；站点端由着色器实时计算）。"""
    spec = load_spec()
    w = spec["waves"]
    for name in ("sea",):
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

    tree = bpy.data.node_groups.new("sea_points", "GeometryNodeTree")
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
    return ob


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

    area("rim_left", (-4.5, 3.5, 4.0), 3.0, 900, "#dfe8ff")
    area("strip_right", (4.2, 1.2, 1.4), 0.25, 420, "#ffd2a6", size_y=4.0)
    area("top_strip", (-0.6, 0.4, 6.0), 0.35, 260, "#ffffff", size_y=6.0)
    area("front_fill", (1.5, -6.0, 1.2), 5.0, 90, "#cfd8e6")
    area("rim_back", (3.2, 5.0, 0.2), 2.0, 700, "#bcd2ff")

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


def render(path, engine="CYCLES", samples=128):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES" if engine == "CYCLES" else "BLENDER_EEVEE"
    if engine == "CYCLES":
        scene.cycles.samples = samples
        scene.cycles.use_denoising = True
        try:
            prefs = bpy.context.preferences.addons["cycles"].preferences
            prefs.compute_device_type = "OPTIX"
            prefs.get_devices()
            for d in prefs.devices:
                d.use = True
            scene.cycles.device = "GPU"
        except Exception:
            scene.cycles.device = "CPU"
    else:
        scene.eevee.taa_render_samples = samples
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_depth = "16" if engine == "CYCLES" else "8"
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def render_masters(out_dir, samples=128):
    """站点用到的三张渲染母版。机位与 src/scripts/observatory/director.ts 的关键帧一致。"""
    import os
    spec = load_spec()
    h = spec["camera"]["hero"]
    shots = []
    explode(0.0)
    sea = bpy.data.objects.get("sea") or build_sea()
    sea.hide_render = False
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
    sea.hide_render = True
    bases, z = [], 0.0
    for layer in spec["layers"]:
        bases.append(z)
        z += layer["h"] + spec["seam"]
    mid = bases[3] + 3 * spec["explode"] + spec["layers"][3]["h"] / 2
    stage(distance=11.6, elevation=20, azimuth=-34, lens=h["lens"], target=(0, 0, mid), res=(1400, 1600))
    shots.append(render(os.path.join(out_dir, "exploded.png"), samples=samples))
    explode(0.0)
    sea.hide_render = False
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
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if "--glb" in argv:
        export_glb(argv[argv.index("--glb") + 1])
