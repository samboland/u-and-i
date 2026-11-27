"""Whole-element selection and transforms for the u&i UV canvas."""


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
from mathutils.geometry import intersect_point_tri_2d


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


def active_canvas_tool(context):
    tool = context.workspace.tools.from_space_image_mode("UV")
    return tool.idname if tool else None


class UAI_OT_toggle_tool(bpy.types.Operator):
    bl_idname = "uai.toggle_canvas_tool"
    bl_label = "Switch Select and Transform"

    @classmethod
    def poll(cls, context):
        return is_canvas(context)

    def execute(self, context):
        transform = active_canvas_tool(context) == "builtin.select_box" and selection(context)
        target = "builtin.transform" if transform else "builtin.select_box"
        UAI_OT_select_activate.last_press = None
        UAI_OT_select.turn_selection = ()
        return bpy.ops.wm.tool_set_by_id(name=target)


def configure_toolbar():
    from bl_ui.space_toolsystem_toolbar import (
        IMAGE_PT_tools_active, _defs_annotate, _defs_image_uv_select, _defs_image_uv_transform,
    )
    stock_tools = IMAGE_PT_tools_active.tools_from_context
    tools = (
        _defs_image_uv_select.box._replace(label="Select"),
        _defs_image_uv_transform.transform._replace(widget="UAI_GGT_selector"),
        None,
        _defs_annotate.scribble,
    )

    def tools_from_context(cls, context, mode=None):
        space = context.space_data
        if (space and space.type == "IMAGE_EDITOR" and (mode or space.mode) == "UV"
                and context.scene.uai_canvas and space.image == context.scene.uai_canvas):
            yield from tools
        else:
            yield from stock_tools(context, mode)

    IMAGE_PT_tools_active.tools_from_context = classmethod(tools_from_context)


def selection(context):
    return [entry for entry in elements(context) if entry[0].select_get()]


def sync_transform_tool():
    context = bpy.context
    for window in context.window_manager.windows:
        if not window.scene.uai_canvas:
            continue
        tool = window.workspace.tools.from_space_image_mode("UV")
        if not tool or tool.idname != "builtin.transform":
            continue
        for area in window.screen.areas:
            if area.ui_type != "UV" or area.spaces.active.image != window.scene.uai_canvas:
                continue
            region = next((r for r in area.regions if r.type == "WINDOW"), None)
            if region is None:
                continue
            with context.temp_override(window=window, area=area, region=region):
                if not selection(context):
                    UAI_OT_select.turn_selection = ()
                    bpy.ops.wm.tool_set_by_id(name="builtin.select_box")
                    break
                if not area.spaces.active.show_gizmo:
                    area.spaces.active.show_gizmo = True
                area.tag_redraw()


def queue_transform_sync(*_):
    if not bpy.app.timers.is_registered(sync_transform_tool):
        bpy.app.timers.register(sync_transform_tool)


def points(face, uv):
    return [loop[uv].uv.copy() for loop in face.loops]


def bounds(coords):
    return (
        Vector((min(p.x for p in coords), min(p.y for p in coords))),
        Vector((max(p.x for p in coords), max(p.y for p in coords))),
    )


def selected_bounds(entries):
    return bounds([p for _, face, uv, _ in entries for p in points(face, uv)])


def pivot(context, entries):
    obj, face, uv, _ = next((e for e in entries if e[0] == context.view_layer.objects.active), entries[0])
    saved = read_pivot(obj)
    if saved is not None:
        return saved
    lo, hi = bounds(points(face, uv))
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


def layout_offset(obj, value=None):
    mesh = bmesh.from_edit_mesh(obj.data)
    layers = mesh.faces.layers.float_vector
    layer = layers.get("uai_layout_offset_px")
    if value is None:
        return next(iter(mesh.faces))[layer].to_2d() if layer else Vector((0, 0))
    layer = layer or layers.new("uai_layout_offset_px")
    next(iter(mesh.faces))[layer] = (*value, 0)
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
    gpu.state.blend_set("NONE")


# Dimensions in units of Blender's preferred gizmo size.
AXIS_HANDLES = (("MOVE", 1, 0), ("MOVE", 0, 1), ("SCALE", 1, 0), ("SCALE", 0, 1))
SHEAR_HANDLES = (("SHEAR", 1, 0), ("SHEAR", 0, 1))


def gizmo_center(context, entries):
    return Vector(context.region.view2d.view_to_region(*pivot(context, entries), clip=False))


def gizmo_size(context):
    return context.preferences.view.gizmo_size * context.preferences.system.ui_scale


def handle_at(context, entries, mouse):
    body = ("BODY", 0, 0)
    if not entries or not context.space_data.show_gizmo:
        return body
    return handle_at_position((mouse - gizmo_center(context, entries)) / gizmo_size(context), turn_mode(entries))


def handle_at_position(pos, shear):
    if shear:
        for key in SHEAR_HANDLES:
            along, across = (pos.x, pos.y) if key[1] else (pos.y, pos.x)
            if (.94 < along < 1.16 and abs(across) < .34) or (.12 < along <= .94 and abs(across) < .055):
                return key
    else:
        for action, dx, dy in AXIS_HANDLES:
            along, across = (pos.x, pos.y) if dx else (pos.y, pos.x)
            low, high = (.98, 1.71) if action == "MOVE" else (.12, .87)
            if low <= along <= high and abs(across) < .12:
                return action, dx, dy
        if abs(pos.length - 1.0) < .08:
            return "ROTATE", 0, 0
    return "BODY", 0, 0


class UAI_GT_transform_pick(bpy.types.Gizmo):
    """Use the same screen-space hit regions for hover and press in the UV editor."""
    bl_idname = "UAI_GT_transform_pick"

    def draw(self, context):
        pass

    def test_select(self, context, location):
        if self.hide:
            return -1
        pos = (Vector(location) - self.center) / gizmo_size(context)
        return 0 if handle_at_position(pos, self.key[0] == "SHEAR") == self.key else -1


class UAI_GGT_selector(bpy.types.GizmoGroup):
    bl_idname = "UAI_GGT_selector"
    bl_label = "Transform"
    bl_space_type = "IMAGE_EDITOR"
    bl_region_type = "WINDOW"
    bl_options = set()

    @classmethod
    def poll(cls, context):
        return is_canvas(context) and active_canvas_tool(context) == "builtin.transform"

    def setup(self, context):
        self.handles = []
        theme = context.preferences.themes[0].user_interface
        for key in (("ROTATE", 0, 0), *AXIS_HANDLES, *SHEAR_HANDLES):
            action, dx, dy = key
            if action == "ROTATE":
                # The viewport dial only supports 3D picking. Blender's UV ring
                # draws in region coordinates and accepts the same rotation drag.
                visual = self.gizmos.new("GIZMO_GT_move_3d")
                visual.draw_style = "RING_2D"
                color = theme.axis_z
            else:
                visual = self.gizmos.new("GIZMO_GT_arrow_3d")
                axis = Vector((dx, dy, 0))
                basis = axis.to_track_quat("Z", "Y").to_matrix().to_4x4()
                if action == "SHEAR":
                    tangent = Vector((-dy, dx, 0))
                    basis = Matrix((Vector((0, 0, .5)), tangent * 6, axis)).transposed().to_4x4()
                    color = Vector(theme.axis_z if dx else theme.axis_y).lerp(Vector(theme.axis_x), .75)
                else:
                    start, end = (.98, 1.45) if action == "MOVE" else (.15, .76)
                    visual.length = end - start
                    visual.matrix_offset.translation = (0, 0, start)
                    color = theme.axis_x if dx else theme.axis_y
                visual.use_draw_offset_scale = True
                visual.draw_style = "NORMAL" if action == "MOVE" else "BOX"
                visual.matrix_basis = basis
            visual.color = color
            visual.line_width = 2
            visual.hide_select = True
            visual.use_draw_modal = True
            pick = self.gizmos.new("UAI_GT_transform_pick")
            pick.hide = True
            pick.key = key
            pick.target_set_operator("uai.select_element")
            self.handles.append((key, visual, pick))

    def draw_prepare(self, context):
        entries = selection(context)
        edit = UAI_OT_edit_text.active
        enabled = bool(entries) and not (edit and edit.region_id == context.region.as_pointer())
        if enabled:
            center = gizmo_center(context, entries)
            shear = turn_mode(entries)
        for key, visual, pick in self.handles:
            is_shear = key[0] == "SHEAR"
            pick.hide = visual.hide = not enabled or (is_shear != shear)
            if not visual.hide:
                pick.center = center
                visual.matrix_basis.translation = (*center, 0)
                visual.alpha = 1 if pick.is_highlight else (.5 if is_shear else .78)


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

    @property
    def visible(self):
        return bool(self.text) and self.width + 8 < self.available

    @property
    def bottom(self):
        return self.baseline - self.height * .2

    @property
    def top(self):
        return self.bottom + self.height * 1.15

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
    if not edit and not layout.visible:
        return
    with gpu.matrix.push_pop():
        gpu.matrix.multiply_matrix(layout.basis)
        bottom = layout.bottom
        top = layout.top
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
        elif event.type == "TAB":
            result = self.finish(context)
            bpy.ops.uai.toggle_canvas_tool()
            return result
        elif event.type in {"RET", "NUMPAD_ENTER"}:
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


def element_at(context, mouse):
    items = list(elements(context))
    order = {obj.session_uid: i for i, obj in enumerate(context.visible_objects)}
    items.sort(key=lambda item: order[item[0].session_uid], reverse=True)
    return items, next((item for item in items if contains(context, item, mouse)), None)


class UAI_OT_select_activate(bpy.types.Operator):
    bl_idname = "uai.select_activate"
    bl_label = "Edit Canvas Element"
    last_press = None

    @classmethod
    def poll(cls, context):
        return is_canvas(context) and active_canvas_tool(context) == "builtin.select_box"

    def invoke(self, context, event):
        previous = type(self).last_press
        type(self).last_press = None
        if event.value == "CLICK_DRAG" or event.ctrl or event.shift or event.alt:
            return {"PASS_THROUGH"}
        mouse = Vector((event.mouse_region_x, event.mouse_region_y))
        items, hit = element_at(context, mouse)
        if not hit:
            return {"PASS_THROUGH"}
        obj, face, uv, _ = hit
        over_text = False
        if obj.get("uai_kind") in {"Button", "Label"}:
            corners = [context.region.view2d.view_to_region(*p, clip=False) for p in points(face, uv)]
            layout = TextLayout(context, corners, obj.get("uai_text", obj.name))
            local = layout.basis.inverted_safe() @ Vector((*mouse, 0))
            over_text = (layout.visible and abs(local.x) <= layout.width / 2
                         and layout.bottom <= local.y <= layout.top)
        target = (context.region.as_pointer(), obj.session_uid, over_text)
        now = time.monotonic()
        if not is_second_press(event, previous, target, now, mouse):
            prior_selection = {item[0].session_uid for item in items if item[0].select_get()}
            type(self).last_press = (target, now, mouse, prior_selection)
            return {"PASS_THROUGH"}
        keep = previous[3] if not over_text and obj.session_uid in previous[3] else {obj.session_uid}
        for item in items:
            set_selected(item, item[0].session_uid in keep)
        context.view_layer.objects.active = obj
        if over_text:
            bpy.ops.uai.edit_text("INVOKE_DEFAULT")
        else:
            UAI_OT_select.turn_selection = ()
            bpy.ops.wm.tool_set_by_id(name="builtin.transform")
        context.area.tag_redraw()
        return {"FINISHED"}


class UAI_OT_select(bpy.types.Operator):
    bl_idname = "uai.select_element"
    bl_label = "Transform Canvas Selection"
    bl_options = {"UNDO", "BLOCKING"}
    turn_selection = ()

    @classmethod
    def poll(cls, context):
        return is_canvas(context) and active_canvas_tool(context) == "builtin.transform"

    def invoke(self, context, event):
        self.press = Vector((event.mouse_region_x, event.mouse_region_y))
        # Blender can dispatch to the previous hover target before the next redraw.
        self.action, self.dx, self.dy = handle_at(context, selection(context), self.press)
        self.start = Vector(context.region.view2d.region_to_view(*self.press))
        self.dragged = self.toggle = False
        if self.action == "BODY":
            items, hit = element_at(context, self.press)
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
        self.center = pivot(context, entries)
        self.ids = tuple(sorted(obj.session_uid for obj, _, _, _ in entries))
        self.original = [(obj, points(face, uv), read_pivot(obj)) for obj, face, uv, _ in entries]
        if self.action == "MOVE":
            self.offsets = {obj.session_uid: layout_offset(obj) for obj, _, _, _ in entries}
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
            (settings.use_snap_uv != (self.action in {"BODY", "MOVE", "SHEAR"} and event.ctrl))
            and "GRID" in settings.snap_uv_element
            and uv.show_grid_over_image
            and self.action in {"BODY", "MOVE", "SCALE", "SHEAR"}
        ):
            anchor = self.lo if self.action in {"BODY", "MOVE"} else edge
            divisions = uv.custom_grid_subdivisions
            for i in range(2):
                delta[i] = round((anchor[i] + delta[i]) * divisions[i]) / divisions[i] - anchor[i]
        if self.action == "MOVE":
            delta *= direction
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
            if self.action in {"BODY", "MOVE"}:
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
            if self.action == "MOVE":
                layout_offset(obj, self.offsets[obj.session_uid] +
                              Vector((delta.x * image_size.x, -delta.y * image_size.y)))
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
            if self.action == "MOVE":
                layout_offset(obj, self.offsets[obj.session_uid])


def register(keyconfig, outline):
    global canvas_outline
    canvas_outline = outline
    bpy.utils.register_class(UAI_OT_edit_text)
    bpy.utils.register_class(UAI_OT_select_activate)
    bpy.utils.register_class(UAI_OT_select)
    bpy.utils.register_class(UAI_OT_toggle_tool)
    bpy.utils.register_class(UAI_GT_transform_pick)
    bpy.utils.register_class(UAI_GGT_selector)
    for key in ((bpy.types.WorkSpace, "tools"), (bpy.types.SpaceImageEditor, "show_gizmo")):
        bpy.msgbus.subscribe_rna(key=key, owner=queue_transform_sync, args=(), notify=queue_transform_sync)
    bpy.app.handlers.depsgraph_update_post.append(queue_transform_sync)
    bpy.app.handlers.undo_post.append(queue_transform_sync)
    bpy.app.handlers.redo_post.append(queue_transform_sync)
    if keyconfig:
        image = keyconfig.keymaps.new(name="Image", space_type="IMAGE_EDITOR")
        image.keymap_items.new("uai.toggle_canvas_tool", "TAB", "PRESS", head=True)
        km = keyconfig.keymaps.new(name="UV Editor", space_type="EMPTY")
        for value in ("PRESS", "DOUBLE_CLICK", "CLICK_DRAG"):
            km.keymap_items.new("uai.select_activate", "LEFTMOUSE", value, head=True, any=True)
        for shift in (False, True):
            for ctrl in (False, True):
                km.keymap_items.new("uai.select_element", "LEFTMOUSE", "PRESS", shift=shift, ctrl=ctrl, head=True)
        km.keymap_items.new("uai.select_element", "LEFTMOUSE", "DOUBLE_CLICK", head=True)
