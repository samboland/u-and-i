"""Whole-element selection and transforms for the u&i UV canvas."""

from functools import lru_cache
import math

import bmesh
import bpy
import gpu
from gpu_extras.batch import batch_for_shader
from mathutils import Vector
from mathutils.geometry import intersect_point_tri_2d, tessellate_polygon


def is_canvas(context):
    return (
        context.area
        and context.area.ui_type == "UV"
        and context.region
        and context.region.type == "WINDOW"
        and context.scene.uai_canvas
        and context.space_data.image == context.scene.uai_canvas
        and context.mode == "EDIT_MESH"
    )


def elements(context):
    for obj in context.objects_in_mode_unique_data:
        if not obj.get("uai_kind") or not obj.visible_get():
            continue
        mesh = bmesh.from_edit_mesh(obj.data)
        uv = mesh.loops.layers.uv.active
        if uv and len(mesh.faces) == 1:
            face = next(iter(mesh.faces))
            if len(face.loops) == 4 and not face.hide:
                yield obj, face, uv, mesh


def selection(context):
    return [entry for entry in elements(context) if entry[1].select]


def points(face, uv):
    return [loop[uv].uv.copy() for loop in face.loops]


def bounds(coords):
    return (
        Vector((min(p.x for p in coords), min(p.y for p in coords))),
        Vector((max(p.x for p in coords), max(p.y for p in coords))),
    )


def selected_bounds(entries):
    return bounds([p for _, face, uv, _ in entries for p in points(face, uv)])


def pivot(entries):
    if len(entries) == 1:
        saved = read_pivot(entries[0][0])
        if saved is not None:
            return saved
    lo, hi = selected_bounds(entries)
    return (lo + hi) / 2


def read_pivot(obj):
    bm = bmesh.from_edit_mesh(obj.data)
    layer = bm.faces.layers.float_vector.get("uai_pivot")
    if layer:
        value = next(iter(bm.faces))[layer]
        if value.z:
            return value.to_2d()


def write_pivot(obj, value):
    # Face data participates in Blender's edit-mesh undo stack.
    bm = bmesh.from_edit_mesh(obj.data)
    layers = bm.faces.layers.float_vector
    layer = layers.get("uai_pivot") or layers.new("uai_pivot")
    next(iter(bm.faces))[layer] = (*value, 1) if value is not None else (0, 0, 0)
    refresh(obj)


def turn_mode(entries):
    return tuple(sorted(obj.session_uid for obj, _, _, _ in entries)) == UAI_OT_select.turn_selection


def refresh(obj):
    bmesh.update_edit_mesh(obj.data, loop_triangles=False, destructive=False)


def set_selected(entry, state):
    obj, face, _, _ = entry
    face.select_set(state)
    refresh(obj)


def contains(context, entry, point):
    obj, face, uv, _ = entry
    view = context.region.view2d
    polygon = [Vector(view.view_to_region(*p, clip=False)) for p in points(face, uv)]
    if obj.get("uai_kind") in {"Button", "Panel"} and obj.uai_shape != "RECTANGLE":
        polygon = canvas_outline(obj, polygon)
    return any(intersect_point_tri_2d(point, polygon[0], a, b) for a, b in zip(polygon[1:], polygon[2:]))


def draw_bounds():
    ctx = bpy.context
    if not is_canvas(ctx) or not ctx.space_data.show_gizmo:
        return
    entries = selection(ctx)
    if not entries:
        return
    lo, hi = selected_bounds(entries)
    view = ctx.region.view2d
    corners = [
        view.view_to_region(x, y, clip=False)
        for x, y in ((lo.x, lo.y), (hi.x, lo.y), (hi.x, hi.y), (lo.x, hi.y))
    ]
    shader = gpu.shader.from_builtin("POLYLINE_UNIFORM_COLOR")
    batch = batch_for_shader(shader, "LINE_STRIP", {"pos": corners + corners[:1]})
    shader.bind()
    shader.uniform_float("viewportSize", gpu.state.viewport_get()[2:])
    gpu.state.blend_set("ALPHA")
    for width, color in ((3, (0, 0, 0, 0.55)), (1, (0.8, 0.8, 0.8, 0.85))):
        shader.uniform_float("lineWidth", width)
        shader.uniform_float("color", color)
        batch.draw(shader)
    theme = ctx.preferences.themes[0].user_interface
    size = 5 * ctx.preferences.system.ui_scale
    fill = gpu.shader.from_builtin("UNIFORM_COLOR")
    for key, pos in handle_positions(ctx, entries):
        poly, indices = handle_shape(*key)
        verts = [pos + v * size for v in poly]
        alpha = 1 if highlighted.get(ctx.region.as_pointer()) == key else 0.6
        is_pivot = key[0] == "PIVOT"
        shader.bind()
        shader.uniform_float("lineWidth", 2.5 if is_pivot else 1)
        shader.uniform_float("color", (0, 0, 0, 1) if is_pivot else (*theme.gizmo_view_align, alpha * 0.45))
        batch_for_shader(shader, "LINE_STRIP", {"pos": verts + verts[:1]}).draw(shader)
        fill.bind()
        fill.uniform_float("color", (*theme.gizmo_view_align, alpha))
        batch_for_shader(fill, "TRIS", {"pos": verts}, indices=indices).draw(fill)
    gpu.state.blend_set("NONE")


# Closed silhouettes based on Inkscape's draw_darrow and draw_carrow.
@lru_cache(maxsize=32)
def handle_shape(action, dx, dy):
    if action == "PIVOT":
        poly = [
            (-1, -0.18),
            (-0.18, -0.18),
            (-0.18, -1),
            (0.18, -1),
            (0.18, -0.18),
            (1, -0.18),
            (1, 0.18),
            (0.18, 0.18),
            (0.18, 1),
            (-0.18, 1),
            (-0.18, 0.18),
            (-1, 0.18),
        ]
    elif action == "ROTATE":

        def arc(radius, start, end):
            return [
                (5 + radius * math.cos(t), 10 + radius * math.sin(t))
                for i in range(13)
                for t in [math.radians(start + (end - start) * i / 12)]
            ]

        path = (
            [(1.5, 5), (5, 1.5)]
            + arc(6.75, -90, 0)
            + [(13.5, 10), (10, 13.5), (6.5, 10)]
            + arc(3.25, 0, -90)
            + [(5, 8.5)]
        )
        poly = [(dx * (x - 7.5) / 7, -dy * (y - 7.5) / 7) for x, y in path]
        # Source Y points down, with the source glyph on the upper right.
    else:
        x, y = (dy, dx) if action == "SHEAR" else (dx, dy)
        length = math.hypot(x, y)
        c, s = x / length, y / length
        path = [
            (-1, 0),
            (-0.5, -0.5),
            (-0.5, -0.21),
            (0.5, -0.21),
            (0.5, -0.5),
            (1, 0),
            (0.5, 0.5),
            (0.5, 0.21),
            (-0.5, 0.21),
            (-0.5, 0.5),
        ]
        poly = [(c * u - s * v, s * u + c * v) for u, v in path]
    verts = [Vector(p) for p in poly]
    return verts, tessellate_polygon([verts])


highlighted = {}


def handle_positions(context, entries):
    if not entries or not context.space_data.show_gizmo:
        return
    lo, hi = selected_bounds(entries)
    mid, half = (lo + hi) / 2, (hi - lo) / 2
    turn = turn_mode(entries)
    gap = 10 * context.preferences.system.ui_scale
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            if dx or dy:
                action = ("ROTATE" if dx and dy else "SHEAR") if turn else "SCALE"
                pos = mid + Vector((dx * half.x, dy * half.y))
            elif turn and len(entries) == 1:
                action, pos = "PIVOT", pivot(entries)
            else:
                continue
            x, y = context.region.view2d.view_to_region(*pos, clip=False)
            yield (action, dx, dy), Vector((x + dx * gap, y + dy * gap))


class UAI_GGT_selector(bpy.types.GizmoGroup):
    bl_idname = "UAI_GGT_selector"
    bl_label = "Selection"
    bl_space_type = "IMAGE_EDITOR"
    bl_region_type = "WINDOW"
    bl_options = {"PERSISTENT", "SCALE"}

    @classmethod
    def poll(cls, context):
        return is_canvas(context)

    def setup(self, context):
        self.handles = []
        for dx, dy in [(x, y) for x in (-1, 0, 1) for y in (-1, 0, 1)]:
            actions = ("SCALE", "ROTATE" if dx and dy else "SHEAR") if dx or dy else ("PIVOT",)
            for action in actions:
                g = self.gizmos.new("GIZMO_GT_button_2d")
                # Native gizmos handle hover and input. The canvas paints the
                # glyphs after the assets so the pivot also appears above text.
                g.draw_options = set()
                g.scale_basis = 7
                g.use_draw_modal = True
                g.alpha = g.alpha_highlight = 0
                g.target_set_operator("uai.select_element")
                self.handles.append((g, action, dx, dy))

    def draw_prepare(self, context):
        entries = selection(context)
        positions = dict(handle_positions(context, entries))
        hovered = None
        for g, action, dx, dy in self.handles:
            g.hide = (action, dx, dy) not in positions
            if g.hide:
                continue
            x, y = positions[action, dx, dy]
            g.matrix_basis[0][3] = x
            g.matrix_basis[1][3] = y
            if g.is_highlight:
                hovered = action, dx, dy
        region_id = context.region.as_pointer()
        if highlighted.get(region_id) != hovered:
            highlighted[region_id] = hovered
            context.region.tag_redraw()


class UAI_OT_select(bpy.types.Operator):
    bl_idname = "uai.select_element"
    bl_label = "Transform Canvas Selection"
    bl_options = {"UNDO", "BLOCKING"}
    turn_selection = ()

    @classmethod
    def poll(cls, context):
        return is_canvas(context)

    def invoke(self, context, event):
        self.press = Vector((event.mouse_region_x, event.mouse_region_y))
        # Blender can dispatch to the previous hover target before the next redraw.
        targets = handle_positions(context, selection(context))
        radius = 7 * context.preferences.system.ui_scale
        self.action, self.dx, self.dy = "BODY", 0, 0
        for key, pos in targets:
            distance = (pos - self.press).length
            if distance <= radius:
                self.action, self.dx, self.dy = key
                radius = distance
        self.start = Vector(context.region.view2d.region_to_view(*self.press))
        self.dragged = self.toggle = False
        if self.action == "BODY":
            items = list(elements(context))
            order = {obj.session_uid: i for i, obj in enumerate(context.visible_objects)}
            items.sort(key=lambda item: order[item[0].session_uid], reverse=True)
            hit = next((item for item in items if contains(context, item, self.press)), None)
            self.toggle = bool(hit and hit[1].select and not event.shift)
            if not self.toggle:
                type(self).turn_selection = ()
                for item in items:
                    if hit and item[0] == hit[0]:
                        set_selected(item, not item[1].select if event.shift else True)
                    elif not event.shift:
                        set_selected(item, False)
            if hit and hit[1].select:
                context.view_layer.objects.active = hit[0]
            else:
                context.area.tag_redraw()
                return {"FINISHED"}
        entries = selection(context)
        if not entries:
            return {"CANCELLED"}
        self.lo, self.hi = selected_bounds(entries)
        self.center = pivot(entries)
        self.ids = tuple(sorted(obj.session_uid for obj, _, _, _ in entries))
        self.original = [(obj, points(face, uv), read_pivot(obj)) for obj, face, uv, _ in entries]
        context.window_manager.modal_handler_add(self)
        context.area.tag_redraw()
        return {"RUNNING_MODAL"}

    def modal(self, context, event):
        if event.type in {"ESC", "RIGHTMOUSE", "WINDOW_DEACTIVATE"}:
            if self.dragged:
                self.restore()
            context.area.tag_redraw()
            return {"CANCELLED"}
        if event.type == "LEFTMOUSE" and event.value == "RELEASE":
            if self.toggle and not self.dragged:
                type(self).turn_selection = () if self.turn_selection == self.ids else self.ids
            context.area.tag_redraw()
            return {"FINISHED"}
        if event.type != "MOUSEMOVE":
            return {"RUNNING_MODAL"}
        mouse = Vector((event.mouse_region_x, event.mouse_region_y))
        if (
            not self.dragged
            and (mouse - self.press).length < context.preferences.inputs.drag_threshold_mouse
        ):
            return {"RUNNING_MODAL"}
        self.dragged = True
        delta = Vector(context.region.view2d.region_to_view(*mouse)) - self.start
        image_size = Vector(context.scene.uai_canvas.size)
        middle, half = (self.lo + self.hi) / 2, (self.hi - self.lo) / 2
        direction = Vector((self.dx, self.dy))
        edge = middle + direction * half
        origin = self.center if event.shift else middle - direction * half
        settings = context.tool_settings
        uv = context.space_data.uv_editor
        if (
            settings.use_snap_uv
            and "GRID" in settings.snap_uv_element
            and uv.show_grid_over_image
            and self.action in {"BODY", "SCALE", "PIVOT"}
        ):
            anchor = {"BODY": self.lo, "SCALE": edge, "PIVOT": self.center}[self.action]
            divisions = uv.custom_grid_subdivisions
            for i in range(2):
                delta[i] = round((anchor[i] + delta[i]) * divisions[i]) / divisions[i] - anchor[i]
        if self.action == "ROTATE":
            a = (self.start - self.center) * image_size
            b = (self.start + delta - self.center) * image_size
            angle = math.atan2(a.x * b.y - a.y * b.x, a.dot(b))
            if event.ctrl:
                step = math.pi / 12
                angle = round(angle / step) * step
        ratios = Vector((1, 1))
        if self.action == "SCALE":
            for i in range(2):
                if direction[i] and abs(edge[i] - origin[i]) > 1e-8:
                    ratios[i] += delta[i] / (edge[i] - origin[i])
            if event.ctrl:
                ratios[:] = [
                    max((ratios[i] for i in range(2) if direction[i]), key=lambda r: abs(r - 1))
                ] * 2

        def transform(p):
            if self.action == "BODY":
                return p + delta
            if self.action == "SCALE":
                return origin + (p - origin) * ratios
            if self.action == "ROTATE":
                q = (p - self.center) * image_size
                c, s = math.cos(angle), math.sin(angle)
                return self.center + Vector(
                    ((c * q.x - s * q.y) / image_size.x, (s * q.x + c * q.y) / image_size.y)
                )
            axis = 0 if self.dx else 1
            result = p.copy()
            span = edge[axis] - origin[axis]
            if abs(span) > 1e-8:
                result[1 - axis] += delta[1 - axis] * (p[axis] - origin[axis]) / span
            return result

        for obj, coords, saved in self.original:
            initial = Vector(saved) if saved else sum(coords, Vector((0, 0))) / len(coords)
            if self.action == "PIVOT":
                write_pivot(obj, initial + delta)
            else:
                self.write(obj, [transform(p) for p in coords])
                write_pivot(obj, initial if self.action == "SCALE" else transform(initial))
        context.area.tag_redraw()
        return {"RUNNING_MODAL"}

    def write(self, obj, coords):
        bm = bmesh.from_edit_mesh(obj.data)
        face = next(iter(bm.faces))
        uv = bm.loops.layers.uv.active
        for loop, p in zip(face.loops, coords):
            loop[uv].uv = p
        refresh(obj)

    def restore(self):
        for obj, coords, saved in self.original:
            self.write(obj, coords)
            write_pivot(obj, saved)


def register(keyconfig, outline):
    global canvas_outline
    canvas_outline = outline
    bpy.utils.register_class(UAI_OT_select)
    bpy.utils.register_class(UAI_GGT_selector)
    bpy.types.SpaceImageEditor.draw_handler_add(draw_bounds, (), "WINDOW", "POST_PIXEL")
    if keyconfig:
        km = keyconfig.keymaps.new(name="UV Editor", space_type="EMPTY")
        for shift in (False, True):
            km.keymap_items.new("uai.select_element", "LEFTMOUSE", "PRESS", shift=shift, head=True)
