"""Whole-element selection and transforms for the u&i UV canvas."""

from functools import lru_cache
import math
import sys
import time
import unicodedata

import blf
import bmesh
import bpy
import gpu
from gpu_extras.batch import batch_for_shader
from mathutils import Matrix, Vector
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
    return [entry for entry in elements(context) if entry[0].select_get()]


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
    obj.select_set(state)
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
    edit = UAI_OT_edit_text.active
    if edit and edit.region_id == ctx.region.as_pointer():
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
        shader.bind()
        shader.uniform_float("lineWidth", 1)
        shader.uniform_float("color", (*theme.gizmo_view_align, alpha * 0.45))
        batch_for_shader(shader, "LINE_STRIP", {"pos": verts + verts[:1]}).draw(shader)
        fill.bind()
        fill.uniform_float("color", (*theme.gizmo_view_align, alpha))
        batch_for_shader(fill, "TRIS", {"pos": verts}, indices=indices).draw(fill)
    gpu.state.blend_set("NONE")


# Closed silhouettes based on Inkscape's draw_darrow and draw_carrow.
@lru_cache(maxsize=32)
def handle_shape(action, dx, dy):
    if action == "ROTATE":

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
HANDLE_DIRECTIONS = tuple((x, y) for x in (-1, 0, 1) for y in (-1, 0, 1) if x or y)


def handle_positions(context, entries):
    if not entries or not context.space_data.show_gizmo:
        return
    lo, hi = selected_bounds(entries)
    mid, half = (lo + hi) / 2, (hi - lo) / 2
    turn = turn_mode(entries)
    gap = 10 * context.preferences.system.ui_scale
    for dx, dy in HANDLE_DIRECTIONS:
        action = ("ROTATE" if dx and dy else "SHEAR") if turn else "SCALE"
        pos = mid + Vector((dx * half.x, dy * half.y))
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
        for dx, dy in HANDLE_DIRECTIONS:
            actions = ("SCALE", "ROTATE" if dx and dy else "SHEAR")
            for action in actions:
                g = self.gizmos.new("GIZMO_GT_button_2d")
                # Native gizmos handle hover and input. The canvas paints the
                # glyphs after the assets.
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


class TextLayout:
    """The same screen-space transform serves glyph drawing and pointer hit testing."""

    def __init__(self, context, corners, text):
        corners = [Vector(p) for p in corners]
        center = sum(corners, Vector((0, 0))) / 4
        x = corners[1] - corners[0]
        y = corners[3] - corners[0]
        self.available = x.length
        x.normalize()
        y.normalize()
        self.basis = Matrix(((x.x, y.x, 0, center.x), (x.y, y.y, 0, center.y),
                             (0, 0, 1, 0), (0, 0, 0, 1)))
        self.text = text
        blf.size(0, 16 * context.space_data.zoom[1])
        self.width, height = blf.dimensions(0, text)
        self.height = max(1, blf.dimensions(0, "Mg")[1])
        self.baseline = -(height if height else self.height) / 2

    def offset(self, index):
        return blf.dimensions(0, self.text[:index])[0] - self.width / 2

    def index_at(self, mouse):
        x = (self.basis.inverted_safe() @ Vector((*mouse, 0))).x
        lo, hi = 0, len(self.text)
        while lo < hi:
            mid = (lo + hi) // 2
            if x < (self.offset(mid) + self.offset(mid + 1)) / 2:
                hi = mid
            else:
                lo = mid + 1
        return lo


def text_rect(x0, y0, x1, y1, color):
    shader = gpu.shader.from_builtin("UNIFORM_COLOR")
    batch = batch_for_shader(shader, "TRI_FAN", {"pos": [(x0,y0),(x1,y0),(x1,y1),(x0,y1)]})
    shader.bind()
    shader.uniform_float("color", color)
    batch.draw(shader)


def draw_canvas_text(context, obj, corners, label):
    edit = UAI_OT_edit_text.active
    if edit and (edit.region_id != context.region.as_pointer() or edit.element != obj):
        edit = None
    text = edit.draft if edit else label
    if not (edit or text):
        return
    layout = TextLayout(context, corners, text)
    if not edit and layout.width + 8 >= layout.available:
        return
    with gpu.matrix.push_pop():
        gpu.matrix.multiply_matrix(layout.basis)
        bottom = layout.baseline - layout.height * .2
        top = bottom + layout.height * 1.15
        if edit and edit.anchor != edit.caret:
            left, right = sorted((layout.offset(edit.anchor), layout.offset(edit.caret)))
            color = context.preferences.themes[0].user_interface.wcol_text.item
            previous_blend = gpu.state.blend_get()
            gpu.state.blend_set("ALPHA")
            text_rect(left, bottom, right, top, color)
            gpu.state.blend_set(previous_blend)
        blf.position(0, -layout.width / 2, layout.baseline, 0)
        blf.color(0, 1, 1, 1, 1)
        blf.draw(0, text)
        if edit and (time.monotonic() - edit.blink_start) % 1 < .6:
            x = layout.offset(edit.caret)
            text_rect(x-.8, bottom, x+.8, top, (1,1,1,1))


def word_bounds(text, index):
    # Inkscape expands the caret to the previous word start and next word end.
    starts, ends = [], []
    inside = False
    for i, char in enumerate(text):
        category = unicodedata.category(char)
        if char.isalnum():
            if not inside:
                starts.append(i)
            inside = True
        elif inside and not (category.startswith("M") or category == "Cf"):
            ends.append(i)
            inside = False
    if inside:
        ends.append(len(text))
    return (next((i for i in reversed(starts) if i <= index), 0),
            next((i for i in ends if i >= index), len(text)))


class UAI_OT_edit_text(bpy.types.Operator):
    bl_idname = "uai.edit_text"
    bl_label = "Edit Text"
    bl_options = {"UNDO", "BLOCKING"}
    active = None

    @classmethod
    def poll(cls, context):
        obj = context.view_layer.objects.active
        return cls.active is None and is_canvas(context) and obj and obj.get("uai_kind") in {"Button", "Label"}

    def invoke(self, context, event):
        self.element = context.view_layer.objects.active
        self.region_id = context.region.as_pointer()
        self.draft = self.original = self.element.get("uai_text", self.element.name)
        self.anchor = self.caret = self.pointer_index(context, event)
        self.dragging = False
        self.last_click = None
        self.drag_word = None
        self.history = []
        self.future = []
        self.blink_start = time.monotonic()
        self.timer = context.window_manager.event_timer_add(.2, window=context.window)
        type(self).active = self
        context.window_manager.modal_handler_add(self)
        context.area.tag_redraw()
        return {"RUNNING_MODAL"}

    def pointer_index(self, context, event):
        bm = bmesh.from_edit_mesh(self.element.data)
        face = next(iter(bm.faces))
        uv = bm.loops.layers.uv.active
        view = context.region.view2d
        corners = [view.view_to_region(*p, clip=False) for p in points(face, uv)]
        return TextLayout(context, corners, self.draft).index_at((event.mouse_region_x,event.mouse_region_y))

    def cancel(self, context):
        type(self).active = None
        context.window_manager.event_timer_remove(self.timer)
        if context.area:
            context.area.tag_redraw()

    def finish(self, context):
        if self.draft != self.original:
            self.element.uai_caption = self.draft
        self.cancel(context)
        return {"FINISHED"}

    def replace(self, text, start, end):
        self.history.append((self.draft, self.caret, self.anchor))
        self.future.clear()
        self.draft = self.draft[:start] + text + self.draft[end:]
        self.caret = self.anchor = start + len(text)

    def modal(self, context, event):
        if event.type in {"ESC", "WINDOW_DEACTIVATE"} or not is_canvas(context):
            self.cancel(context)
            return {"CANCELLED"}
        if event.type == "TIMER":
            context.area.tag_redraw()
            return {"RUNNING_MODAL"}
        if event.type == "LEFTMOUSE":
            if event.value == "RELEASE":
                self.dragging = False
            elif event.value in {"PRESS", "DOUBLE_CLICK"}:
                mouse = Vector((event.mouse_region_x, event.mouse_region_y))
                entry = next((e for e in elements(context) if e[0] == self.element), None)
                if not entry or not contains(context, entry, mouse):
                    return self.finish(context) | {"PASS_THROUGH"}
                self.caret = self.pointer_index(context, event)
                now = time.monotonic()
                double = not event.shift and is_second_press(event, self.last_click, self.region_id, now, mouse)
                self.last_click = None if double or event.shift else (self.region_id, now, mouse)
                self.drag_word = word_bounds(self.draft, self.caret) if double else None
                if self.drag_word is not None:
                    self.anchor, self.caret = self.drag_word
                elif not event.shift:
                    self.anchor = self.caret
                self.dragging = True
        elif self.dragging and event.type == "MOUSEMOVE":
            index = self.pointer_index(context, event)
            if self.drag_word is None:
                self.caret = index
                if index != self.anchor:
                    self.last_click = None
            else:
                start, end = self.drag_word
                if index < start:
                    self.anchor, self.caret = end, word_bounds(self.draft, index)[0]
                else:
                    self.anchor, self.caret = start, max(end, word_bounds(self.draft, index)[1])
        elif event.value != "PRESS":
            return {"RUNNING_MODAL"}
        elif event.type in {"RET", "NUMPAD_ENTER", "TAB"}:
            return self.finish(context)
        else:
            self.last_click = None
            lo, hi = sorted((self.anchor, self.caret))
            shortcut = event.ctrl or event.oskey
            if shortcut and event.type == "A":
                self.anchor, self.caret = 0, len(self.draft)
            elif shortcut and event.type in {"C", "X"}:
                if lo != hi:
                    context.window_manager.clipboard = self.draft[lo:hi]
                    if event.type == "X":
                        self.replace("", lo, hi)
            elif shortcut and event.type == "V":
                self.replace(" ".join(context.window_manager.clipboard.splitlines()), lo, hi)
            elif shortcut and event.type in {"Y", "Z"}:
                undo = event.type == "Z" and not event.shift
                source, dest = (self.history, self.future) if undo else (self.future, self.history)
                if source:
                    dest.append((self.draft, self.caret, self.anchor))
                    self.draft, self.caret, self.anchor = source.pop()
            elif event.type in {"BACK_SPACE", "DEL"}:
                if lo == hi:
                    if event.type == "BACK_SPACE":
                        lo = max(0, lo - 1)
                    else:
                        hi = min(len(self.draft), hi + 1)
                if lo != hi:
                    self.replace("", lo, hi)
            elif event.type in {"HOME", "END", "LEFT_ARROW", "RIGHT_ARROW"}:
                if event.type == "HOME":
                    self.caret = 0
                elif event.type == "END":
                    self.caret = len(self.draft)
                elif lo != hi and not event.shift:
                    self.caret = lo if event.type == "LEFT_ARROW" else hi
                else:
                    step = -1 if event.type == "LEFT_ARROW" else 1
                    self.caret = max(0, min(len(self.draft), self.caret + step))
                if not event.shift:
                    self.anchor = self.caret
            elif event.unicode and event.unicode.isprintable():
                self.replace(event.unicode, lo, hi)
            else:
                return {"RUNNING_MODAL"}
        self.blink_start = time.monotonic()
        context.area.tag_redraw()
        return {"RUNNING_MODAL"}


def is_second_press(event, previous, target, pressed_at, position):
    if previous is None or previous[0] != target:
        return False
    if sys.platform != "win32":
        prefs = bpy.context.preferences.inputs
        return (event.value == "DOUBLE_CLICK" or
                ((pressed_at - previous[1]) * 1000 < prefs.mouse_double_click_time
                 and (position - previous[2]).length <= prefs.drag_threshold_mouse))
    # GTK's Windows backend reads these settings for the Inkscape Selector.
    from ctypes import windll
    user32 = windll.user32
    distance = max(user32.GetSystemMetrics(36), user32.GetSystemMetrics(37))
    offset = position - previous[2]
    return ((pressed_at - previous[1]) * 1000 < user32.GetDoubleClickTime()
            and max(abs(offset.x), abs(offset.y)) <= distance)


class UAI_OT_select(bpy.types.Operator):
    bl_idname = "uai.select_element"
    bl_label = "Transform Canvas Selection"
    bl_options = {"UNDO", "BLOCKING"}
    turn_selection = ()
    last_body_click = None

    @classmethod
    def poll(cls, context):
        return is_canvas(context)

    def invoke(self, context, event):
        previous_click = type(self).last_body_click
        type(self).last_body_click = None
        self.body_target = None
        self.pressed_at = time.monotonic()
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
            if hit and not (event.ctrl or event.shift):
                obj = hit[0]
                self.body_target = (context.region.as_pointer(), obj.session_uid)
                if hit[0].select_get() and is_second_press(event, previous_click, self.body_target,
                                                      self.pressed_at, self.press):
                    type(self).turn_selection = previous_click[3]
                    context.view_layer.objects.active = obj
                    if obj.get("uai_kind") in {"Button", "Label"}:
                        bpy.ops.uai.edit_text("INVOKE_DEFAULT")
                    else:
                        bpy.ops.wm.call_panel(name="UAI_PT_element", keep_open=True)
                    return {"FINISHED"}
            self.toggle = bool(hit and hit[0].select_get() and not event.shift)
            if not self.toggle:
                type(self).turn_selection = ()
                for item in items:
                    if hit and item[0] == hit[0]:
                        set_selected(item, not item[0].select_get() if event.shift else True)
                    elif not event.shift:
                        set_selected(item, False)
            if hit and hit[0].select_get():
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
            if self.body_target and not self.dragged:
                type(self).last_body_click = (self.body_target, self.pressed_at, self.press,
                                              self.turn_selection)
            if self.toggle and not self.dragged:
                type(self).turn_selection = () if self.turn_selection == self.ids else self.ids
            context.area.tag_redraw()
            return {"FINISHED"}
        modifier_changed = event.type in {"LEFT_CTRL", "RIGHT_CTRL"}
        if event.type != "MOUSEMOVE" and not (modifier_changed and self.dragged):
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
            (settings.use_snap_uv != (self.action in {"BODY", "SHEAR"} and event.ctrl))
            and "GRID" in settings.snap_uv_element
            and uv.show_grid_over_image
            and self.action in {"BODY", "SCALE", "SHEAR"}
        ):
            anchor = self.lo if self.action == "BODY" else edge
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
    bpy.utils.register_class(UAI_OT_edit_text)
    bpy.utils.register_class(UAI_OT_select)
    bpy.utils.register_class(UAI_GGT_selector)
    bpy.types.SpaceImageEditor.draw_handler_add(draw_bounds, (), "WINDOW", "POST_PIXEL")
    if keyconfig:
        km = keyconfig.keymaps.new(name="UV Editor", space_type="EMPTY")
        for shift in (False, True):
            for ctrl in (False, True):
                km.keymap_items.new("uai.select_element", "LEFTMOUSE", "PRESS", shift=shift, ctrl=ctrl, head=True)
        km.keymap_items.new("uai.select_element", "LEFTMOUSE", "DOUBLE_CLICK", head=True)
