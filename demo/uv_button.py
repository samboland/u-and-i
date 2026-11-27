"""Open a disposable button in Blender's native UV editor."""

import blf
import bpy
from mathutils import Matrix, Vector
import gpu
import math
import os
import runpy
from pathlib import Path
import numpy as np
from types import SimpleNamespace
from bl_ui.space_image import IMAGE_HT_header, IMAGE_PT_overlay_guides
from gpu_extras.batch import batch_for_shader

CANVAS_WIDTH = 640
CANVAS_HEIGHT = 400
GRID_TYPES = (("RECTANGULAR", "Rectangular", ""), ("AXONOMETRIC", "Axonometric", ""),
              ("MODULAR", "Modular", ""))
CANVAS_COLOR = (0.14, 0.15, 0.17, 1)
CANVAS_ELEMENTS = ("Panel", "Button", "Label")


def draw_grid_image(image, grid):
    # Bake guides into the disposable canvas so UV edges always draw above them.
    custom = grid is not None and grid.kind != "RECTANGULAR"
    if not custom and not image.is_dirty:
        return
    width, height = image.size
    x, y = np.meshgrid(np.arange(width) + 0.5, np.arange(height) + 0.5)
    pixels = np.empty((height, width, 4), dtype=np.float32)
    pixels[:] = CANVAS_COLOR
    if custom:
        def distance(axis, period):
            return np.abs((axis + period / 2) % period - period / 2)

        if grid.kind == "AXONOMETRIC":
            left, right = math.tan(grid.left_angle), math.tan(grid.right_angle)
            pitch = grid.line_spacing
            edge = np.minimum.reduce((
                distance(x, pitch / (left + right)),
                distance(y - left * x, pitch) / math.hypot(1, left),
                distance(y + right * x, pitch) / math.hypot(1, right)))
        else:
            mx = x % (grid.module_width + grid.gutter_x)
            my = y % (grid.module_height + grid.gutter_y)
            dx = np.maximum(-mx, mx - grid.module_width)
            dy = np.maximum(-my, my - grid.module_height)
            edge = np.abs(np.hypot(np.maximum(dx, 0), np.maximum(dy, 0))
                          + np.minimum(np.maximum(dx, dy), 0))
        coverage = np.clip(1 - edge, 0, 1)
        pixels[:, :, :3] += coverage[:, :, None] * 0.20
    image.pixels.foreach_set(pixels.ravel())
    image.update()


def sync_grid(image, context):
    # The native UV viewport has one fixed grid. Preview the last visible entry.
    grid = next((item for item in reversed(list(image.uai_grids)) if item.visible), None)
    show_custom = False
    for window in context.window_manager.windows:
        for area in window.screen.areas:
            space = area.spaces.active
            if area.ui_type == "UV" and space.image == image:
                uv = space.uv_editor
                native = grid is not None and grid.kind == "RECTANGULAR"
                uv.show_grid_over_image = native
                show_custom |= space.overlay.show_overlays and space.overlay.show_grid_background
                if native:
                    width, height = image.size
                    uv.grid_shape_source = "FIXED"
                    uv.custom_grid_subdivisions = (max(1, round(width / grid.x)), max(1, round(height / grid.y)))
                area.tag_redraw()
    draw_grid_image(image, grid if show_custom else None)


def refresh_canvas(*_):
    image = bpy.context.scene.uai_canvas
    if image:
        sync_grid(image, bpy.context)


def grid_changed(self, context):
    sync_grid(self.id_data, context)


def pixel_spacing(label):
    return bpy.props.IntProperty(
        name=label, subtype="PIXEL", default=8, min=1, max=max(CANVAS_WIDTH, CANVAS_HEIGHT),
        description="Target cell spacing in pixels, fitted to whole UV subdivisions",
        update=grid_changed)


class UAI_Grid(bpy.types.PropertyGroup):
    kind: bpy.props.EnumProperty(items=GRID_TYPES, default="RECTANGULAR")
    line_spacing: bpy.props.IntProperty(name="Spacing", subtype="PIXEL", default=16, min=1, max=400, update=grid_changed)
    left_angle: bpy.props.FloatProperty(name="Left Angle", subtype="ANGLE", default=math.pi/6, min=math.radians(1), max=math.radians(89), update=grid_changed)
    right_angle: bpy.props.FloatProperty(name="Right Angle", subtype="ANGLE", default=math.pi/6, min=math.radians(1), max=math.radians(89), update=grid_changed)
    module_width: bpy.props.IntProperty(name="Width", subtype="PIXEL", default=64, min=1, max=640, update=grid_changed)
    module_height: bpy.props.IntProperty(name="Height", subtype="PIXEL", default=40, min=1, max=400, update=grid_changed)
    gutter_x: bpy.props.IntProperty(name="Gutter X", subtype="PIXEL", default=8, min=0, max=640, update=grid_changed)
    gutter_y: bpy.props.IntProperty(name="Gutter Y", subtype="PIXEL", default=8, min=0, max=400, update=grid_changed)
    expanded: bpy.props.BoolProperty(default=True)
    visible: bpy.props.BoolProperty(name="Visible", default=True, update=grid_changed)
    x: pixel_spacing("Spacing X")
    y: pixel_spacing("Spacing Y")


class UAI_OT_add_grid(bpy.types.Operator):
    bl_idname = "uai.add_grid"
    bl_label = "Add Grid"
    bl_options = {"UNDO"}
    kind: bpy.props.EnumProperty(items=GRID_TYPES)

    def execute(self, context):
        image = context.space_data.image
        grids = image.uai_grids
        number = 2
        label = dict((key, label) for key, label, _ in GRID_TYPES)[self.kind]
        name = label
        while name in grids:
            name = f"{label} {number}"
            number += 1
        grid = grids.add()
        grid.kind = self.kind
        grid.name = name
        sync_grid(image, context)
        return {"FINISHED"}


class UAI_OT_remove_grid(bpy.types.Operator):
    bl_idname = "uai.remove_grid"
    bl_label = "Remove Grid"
    bl_options = {"UNDO"}
    index: bpy.props.IntProperty()

    def execute(self, context):
        image = context.space_data.image
        if not 0 <= self.index < len(image.uai_grids):
            return {"CANCELLED"}
        image.uai_grids.remove(self.index)
        sync_grid(image, context)
        return {"FINISHED"}


stock_guides = IMAGE_PT_overlay_guides.draw


class UAI_MT_add_grid(bpy.types.Menu):
    bl_label = "Add Grid"
    bl_options = {"SEARCH_ON_KEY_PRESS"}

    def draw(self, context):
        for kind, label, _ in GRID_TYPES:
            self.layout.operator("uai.add_grid", text=label).kind = kind


class UAI_OT_move_grid(bpy.types.Operator):
    bl_idname = "uai.move_grid"
    bl_label = "Move Grid"
    bl_options = {"UNDO"}
    index: bpy.props.IntProperty()
    offset: bpy.props.IntProperty()

    def execute(self, context):
        image = context.space_data.image
        target = self.index + self.offset
        if not all(0 <= i < len(image.uai_grids) for i in (self.index, target)):
            return {"CANCELLED"}
        image.uai_grids.move(self.index, target)
        sync_grid(image, context)
        return {"FINISHED"}


class UAI_MT_grid_actions(bpy.types.Menu):
    bl_label = "Grid Actions"

    def draw(self, context):
        grids = context.space_data.image.uai_grids
        index = next(i for i, grid in enumerate(grids) if grid == context.uai_grid)
        for offset, label, icon in ((-1, "Move Up", "TRIA_UP"), (1, "Move Down", "TRIA_DOWN")):
            row = self.layout.row()
            row.enabled = 0 <= index + offset < len(grids)
            op = row.operator("uai.move_grid", text=label, icon=icon)
            op.index, op.offset = index, offset


def draw_guides(self, context):
    space = context.space_data
    image = space.image
    if image is None or image != context.scene.uai_canvas or context.area.ui_type != "UV":
        return stock_guides(self, context)
    layout = self.layout
    layout.active = space.overlay.show_overlays
    layout.prop(space.overlay, "show_grid_background", text="Grids")
    layout.operator("wm.call_menu", text="Add Grid", icon="ADD").name = "UAI_MT_add_grid"
    for index, grid in enumerate(image.uai_grids):
        box = layout.box()
        header = box.row(align=True)
        header.prop(grid, "expanded", text="", emboss=False,
                    icon="DOWNARROW_HLT" if grid.expanded else "RIGHTARROW")
        header.label(text="", icon="MESH_GRID")
        controls = header.row(align=True)
        controls.context_pointer_set("uai_grid", grid)
        controls.prop(grid, "name", text="")
        controls.prop(grid, "visible", text="", icon="RESTRICT_VIEW_OFF", toggle=True)
        controls.menu("UAI_MT_grid_actions", text="", icon="DOWNARROW_HLT")
        header.operator("uai.remove_grid", text="", icon="X", emboss=False).index = index
        if grid.expanded:
            fields = box.column(align=True)
            fields.use_property_split = True
            fields.use_property_decorate = False
            properties = {"RECTANGULAR": ("x", "y"),
                          "AXONOMETRIC": ("line_spacing", "left_angle", "right_angle"),
                          "MODULAR": ("module_width", "module_height", "gutter_x", "gutter_y")}
            for prop in properties[grid.kind]:
                fields.prop(grid, prop)


stock_header = IMAGE_HT_header.draw


def selected_image_uid(_):
    image = getattr(bpy.context.space_data, "image", None)
    return image.session_uid if image else 0


def select_image_uid(_, uid):
    space = bpy.context.space_data
    if isinstance(space, bpy.types.SpaceImageEditor):
        space.image = next((image for image in bpy.data.images if image.session_uid == uid), None)


def create_canvas_asset(collection, kind, center):
    x, y = center
    half_height = 0.12 if kind == "Panel" else 0.06
    corners = [(x + dx * 0.15, y + dy * half_height)
               for dx, dy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    mesh = bpy.data.meshes.new(kind)
    mesh.from_pydata([(u, v, 0) for u, v in corners], [], [tuple(range(len(corners)))])
    mesh.update()
    layer = mesh.uv_layers.new()
    for index, uv in enumerate(corners):
        layer.uv[index].vector = uv
    obj = bpy.data.objects.new(kind, mesh)
    obj["uai_kind"] = kind
    if kind == "Label":
        obj.uai_caption = kind
    collection.objects.link(obj)
    return obj


class UAI_OT_add_asset(bpy.types.Operator):
    bl_idname = "uai.add_asset"
    bl_label = "Add Canvas Element"
    bl_options = {"UNDO"}
    kind: bpy.props.EnumProperty(items=[(kind, kind, "") for kind in CANVAS_ELEMENTS])

    @classmethod
    def poll(cls, context):
        return (context.area and context.area.ui_type == "UV"
                and context.scene.uai_canvas and context.space_data.image == context.scene.uai_canvas
                and context.mode in {"OBJECT", "EDIT_MESH"})

    def execute(self, context):
        center = tuple(context.space_data.cursor_location)
        editing = [member for member in context.view_layer.objects
                   if member.type == "MESH" and member.data.is_editmode]
        hidden = [member for member in editing if member.hide_get()]
        if editing:
            bpy.ops.mesh.select_all(action="DESELECT")
            bpy.ops.object.mode_set(mode="OBJECT")
        bpy.ops.object.select_all(action="DESELECT")
        obj = create_canvas_asset(context.collection, self.kind, center)
        for polygon in obj.data.polygons:
            polygon.select = True
        try:
            for member in hidden:
                member.hide_set(False)
            for member in editing:
                member.select_set(True)
            obj.select_set(True)
            context.view_layer.objects.active = obj
            bpy.ops.object.mode_set(mode="EDIT")
        finally:
            for member in editing:
                member.select_set(False)
            for member in hidden:
                member.hide_set(True)
        return {"FINISHED"}


class UAI_MT_add_asset(bpy.types.Menu):
    bl_label = "Add"
    bl_options = {"SEARCH_ON_KEY_PRESS"}

    def draw(self, context):
        for kind in CANVAS_ELEMENTS:
            self.layout.operator("uai.add_asset", text=kind).kind = kind



class UAI_MT_canvas_menus(bpy.types.Menu):
    bl_label = ""

    def draw(self, context):
        self.layout.menu("IMAGE_MT_view")
        if context.space_data.show_uvedit:
            self.layout.menu("IMAGE_MT_select")
        image = context.space_data.image
        self.layout.menu("IMAGE_MT_image", text="* Image" if image and image.is_dirty else "Image")
        self.layout.menu("UAI_MT_add_asset")


class CanvasHeaderLayout:
    def __init__(self, layout):
        self.layout = layout

    def __getattr__(self, name):
        return getattr(self.layout, name)

    def template_edit_mode_selection(self):
        # The canvas selects whole elements.
        pass

    def row(self, **options):
        return CanvasHeaderLayout(self.layout.row(**options))

    @property
    def active(self):
        return self.layout.active

    @active.setter
    def active(self, value):
        self.layout.active = value

    def menu_contents(self, name):
        return self.layout.menu_contents("UAI_MT_canvas_menus" if name == "IMAGE_MT_editor_menus" else name)

    def menu(self, name, **options):
        return self.layout.menu("UAI_MT_canvas_menus" if name == "IMAGE_MT_editor_menus" else name, **options)

    def prop(self, data, property_name, **options):
        if property_name in {"use_uv_select_sync", "use_uv_select_island", "uv_sticky_select_mode",
                             "use_proportional_edit", "display_channels"}:
            return
        if property_name == "show_overlays":
            options["icon"] = "GRID"
        return self.layout.prop(data, property_name, **options)

    def prop_with_popover(self, data, property_name, **options):
        if property_name != "proportional_edit_falloff":
            return self.layout.prop_with_popover(data, property_name, **options)

    def template_ID(self, data, property_name, **options):
        if property_name != "image":
            return self.layout.template_ID(data, property_name, **options)
        row = self.layout.row(align=True)
        browse = row.row(align=True)
        browse.ui_units_x = 1.6
        browse.template_ID_session_uid(bpy.context.window_manager, "uai_image_uid", "IMAGE")
        image = data.image
        if image:
            field = row.row(align=True)
            prefs = bpy.context.preferences
            blf.size(0, prefs.ui_styles[0].widget.points)
            width, _ = blf.dimensions(0, image.name)
            field.ui_units_x = min(16, max(4, width / 20 + 0.75))
            field.prop(image, "name", text="")
        row.operator("image.new", text="" if image else "New", icon="DUPLICATE" if image else "ADD")
        if image and image.packed_file:
            unpack = row.operator("file.unpack_item", text="", icon="PACKAGE")
            unpack.id_type = "IMAGE"
            unpack.id_name = image.name
        else:
            row.operator("image.open", text="" if image else "Open", icon="FILEBROWSER")
        if image:
            unlink = row.operator("wm.context_set_id", text="", icon="X")
            unlink.data_path = "space_data.image"
            unlink.value = ""


def draw_header(self, context):
    if (context.area.ui_type == "UV" and context.scene.uai_canvas
            and context.space_data.image == context.scene.uai_canvas):
        return stock_header(SimpleNamespace(layout=CanvasHeaderLayout(self.layout)), context)
    return stock_header(self, context)


def enforce_canvas_sync(*_):
    scene = bpy.context.scene
    if scene and scene.uai_canvas and not scene.tool_settings.use_uv_select_sync:
        scene.tool_settings.use_uv_select_sync = True


def restore_canvas_edit_mode():
    # Native mode commands can also run from search or the Outliner.
    # Wait until the command ends: Add briefly uses Object Mode itself.
    context = bpy.context
    if not context.scene or not context.scene.uai_canvas or context.mode != "OBJECT":
        return
    members = [obj for obj in context.view_layer.objects if obj.type == "MESH" and obj.get("uai_kind")]
    if not members:
        return
    selected = [obj for obj in context.view_layer.objects if obj.select_get()]
    hidden = [obj for obj in members if obj.hide_get()]
    active = context.view_layer.objects.active
    for obj in selected:
        if obj not in members:
            obj.select_set(False)
    try:
        for obj in hidden:
            obj.hide_set(False)
        for obj in members:
            obj.select_set(True)
        context.view_layer.objects.active = active if active in members else members[0]
        bpy.ops.object.mode_set(mode="EDIT")
    finally:
        for obj in members:
            obj.select_set(obj in selected)
        for obj in selected:
            obj.select_set(True)
        for obj in hidden:
            obj.hide_set(True)


def guard_canvas_edit_mode(scene, *_):
    if scene.uai_canvas and bpy.context.mode == "OBJECT" and not bpy.app.timers.is_registered(restore_canvas_edit_mode):
        bpy.app.timers.register(restore_canvas_edit_mode)


@bpy.app.handlers.persistent
def retain_canvas_images(*_):
    if not any(scene.uai_canvas for scene in bpy.data.scenes):
        return
    for image in bpy.data.images:
        if image.library or image.source not in {"FILE", "GENERATED"}:
            continue
        image.use_fake_user = True
        if image.is_dirty and image.has_data:
            image.pack()


def redraw_canvas(_, context):
    for window in context.window_manager.windows:
        for area in window.screen.areas:
            if area.ui_type == "UV":
                area.tag_redraw()


class UAI_PT_element(bpy.types.Panel):
    bl_label = "Canvas Element"
    bl_space_type = "PROPERTIES"
    bl_region_type = "WINDOW"
    bl_context = "object"
    bl_order = 1

    @classmethod
    def poll(cls, context):
        return context.object and context.object.select_get() and context.object.get("uai_kind") in CANVAS_ELEMENTS

    def draw(self, context):
        obj = context.object
        layout = self.layout
        layout.use_property_split = True
        layout.use_property_decorate = False
        if obj.get("uai_kind") != "Label":
            layout.prop(obj, "uai_shape")
        if obj.get("uai_kind") != "Panel":
            layout.prop(obj, "uai_caption", text="Caption" if obj.get("uai_kind") == "Button" else "Text")


def quad_point(corners, x, y):
    return corners[0].lerp(corners[1], x).lerp(corners[3].lerp(corners[2], x), y)


def shape_outline(obj, points):
    corners = [Vector(p) for p in points]
    width = max(0.001, (corners[1] - corners[0]).length)
    height = max(0.001, (corners[3] - corners[0]).length)
    if obj.uai_shape == "PILL":
        radius = min(width, height) / 2
        rx, ry = radius / width, radius / height
        outline = []
        for quarter, (x, y) in enumerate(((1-rx, 1-ry), (rx, 1-ry), (rx, ry), (1-rx, ry))):
            for step in range(17):
                angle = (quarter + step / 16) * math.pi / 2
                outline.append(quad_point(corners, x + rx * math.cos(angle), y + ry * math.sin(angle)))
        return outline
    return [quad_point(corners, (1 + math.cos(angle)) / 2, (1 + math.sin(angle)) / 2)
            for angle in (math.tau * i / 64 for i in range(64))]


def draw_canvas(draw_canvas_text, draw_bounds):
    region = bpy.context.region
    if bpy.context.space_data.image != bpy.context.scene.uai_canvas or not bpy.context.scene.uai_canvas:
        return
    # Paint assets in pixel coordinates before the Image Editor draws native gizmos.
    with gpu.matrix.push_pop(), gpu.matrix.push_pop_projection():
        gpu.matrix.load_identity()
        gpu.matrix.load_projection_matrix(Matrix(((2/region.width, 0, 0, -1),
                                                  (0, 2/region.height, 0, -1),
                                                  (0, 0, -1, 0), (0, 0, 0, 1))))
        draw_assets(draw_canvas_text)
        draw_bounds()


def draw_assets(draw_canvas_text):
    context = bpy.context
    if (context.area.ui_type != "UV" or not context.scene.uai_canvas
            or context.space_data.image != context.scene.uai_canvas):
        return
    depsgraph = context.evaluated_depsgraph_get()
    view = context.region.view2d
    for obj in context.visible_objects:
        if obj.type != "MESH" or not obj.data.uv_layers.active:
            continue
        evaluated = obj.evaluated_get(depsgraph)
        # Read a snapshot while Blender's modal transform owns the edit mesh.
        mesh = evaluated.to_mesh()
        try:
            layer = mesh.uv_layers.active
            if layer is None:
                continue
            mesh.calc_loop_triangles()
            faces = {}
            for tri in mesh.loop_triangles:
                faces.setdefault(tri.polygon_index, []).append(tuple(tri.loops))
            for face_index, triangles in faces.items():
                face = mesh.polygons[face_index]
                if face.hide:
                    continue
                points = [view.view_to_region(*layer.uv[i].vector, clip=False)
                          for i in face.loop_indices]
                indices = [tuple(i - face.loop_start for i in tri) for tri in triangles]
                kind = obj.get("uai_kind")
                if kind in {"Panel", "Button"} and len(points) == 4 and obj.uai_shape != "RECTANGLE":
                    outline = shape_outline(obj, points)
                    triangles = [(0, i, i + 1) for i in range(1, len(outline) - 1)]
                    draw_face(outline, triangles, kind)
                    kind = "Label"
                draw_face(points, indices, kind)
                if len(points) == 4 and len(mesh.polygons) == 1 and obj.get("uai_kind") in {"Button", "Label"}:
                    draw_canvas_text(context, obj, points, obj.get("uai_text", obj.name))
        finally:
            evaluated.to_mesh_clear()


def draw_face(points, indices, kind):
    cx = sum(x for x, _ in points) / len(points)
    cy = sum(y for _, y in points) / len(points)
    # Leave Blender's selected edges and vertex handles visible.
    # Use a uniform scale so rotated and skewed edges stay parallel.
    radius = max(1, max(abs(y - cy) for _, y in points))
    scale = max(0, 1 - 2 / radius)
    inset = [(cx + (x - cx) * scale, cy + (y - cy) * scale) for x, y in points]
    if kind == "Divider" and len(points) == 4:
        # Inset along each edge independently so a thin divider retains its length.
        inset = []
        for i, (x, y) in enumerate(points):
            px, py = x, y
            for neighbor in (points[i - 1], points[(i + 1) % 4]):
                dx, dy = neighbor[0] - x, neighbor[1] - y
                fraction = min(0.2, 1 / max(1, math.hypot(dx, dy)))
                px += dx * fraction
                py += dy * fraction
            inset.append((px, py))
    if kind != "Label":
        shader = gpu.shader.from_builtin("UNIFORM_COLOR")
        batch = batch_for_shader(shader, "TRIS", {"pos": inset}, indices=indices)
        shader.bind()
        shader.uniform_float("color", (0.19, 0.32, 0.43, 1))
        batch.draw(shader)


class UAI_OT_canvas_wheel(bpy.types.Operator):
    bl_idname = "uai.canvas_wheel"
    bl_label = "Navigate Canvas"

    @classmethod
    def poll(cls, context):
        return (context.area.ui_type == "UV" and context.scene.uai_canvas is not None
                and context.space_data.image == context.scene.uai_canvas)

    def invoke(self, context, event):
        up = event.type == "WHEELUPMOUSE"
        if event.ctrl:
            zoom = bpy.ops.image.view_zoom_in if up else bpy.ops.image.view_zoom_out
            return zoom("INVOKE_DEFAULT")
        step = (40 if up else -40) * context.preferences.system.ui_scale
        zoom_x, zoom_y = context.space_data.zoom
        offset = (-step / zoom_x, 0) if event.shift else (0, step / zoom_y)
        return bpy.ops.image.view_pan(offset=offset)


def setup():
    bpy.types.Object.uai_caption = bpy.props.StringProperty(
        name="Text", get=lambda obj: obj.get("uai_text", ""),
        set=lambda obj, text: obj.__setitem__("uai_text", text), update=redraw_canvas)
    bpy.types.Object.uai_shape = bpy.props.EnumProperty(name="Shape", items=[
        ("RECTANGLE", "Rectangle", ""), ("PILL", "Pill", ""), ("ELLIPSE", "Ellipse", "")],
        update=redraw_canvas)
    bpy.utils.register_class(UAI_PT_element)
    bpy.utils.register_class(UAI_OT_add_asset)
    bpy.utils.register_class(UAI_MT_add_asset)
    bpy.utils.register_class(UAI_MT_canvas_menus)
    bpy.types.WindowManager.uai_image_uid = bpy.props.IntProperty(
        get=selected_image_uid, set=select_image_uid, options={"SKIP_SAVE"})
    for cls in (UAI_Grid, UAI_OT_add_grid, UAI_MT_add_grid, UAI_OT_remove_grid, UAI_OT_move_grid, UAI_MT_grid_actions):
        bpy.utils.register_class(cls)
    bpy.types.Image.uai_grids = bpy.props.CollectionProperty(type=UAI_Grid)
    IMAGE_PT_overlay_guides.draw = draw_guides
    bpy.types.Scene.uai_canvas = bpy.props.PointerProperty(type=bpy.types.Image)
    bpy.app.handlers.save_pre.append(retain_canvas_images)
    bpy.utils.register_class(UAI_OT_canvas_wheel)
    keyconfig = bpy.context.window_manager.keyconfigs.addon
    if keyconfig:
        keymap = keyconfig.keymaps.new(name="Image", space_type="IMAGE_EDITOR")
        for wheel in ("WHEELUPMOUSE", "WHEELDOWNMOUSE"):
            for modifiers in ({}, {"shift": True}, {"ctrl": True}):
                keymap.keymap_items.new("uai.canvas_wheel", wheel, "PRESS", **modifiers)
    bpy.context.preferences.inputs.use_zoom_to_mouse = True
    # This standalone demo uses the modifier surface for its boxed layouts.
    profile = os.environ.get("UAI_BLENDER_CONFIG")
    bpy.context.preferences.use_preferences_save = bool(
        profile and Path(profile).resolve() == Path(bpy.utils.user_resource("CONFIG")).resolve())
    theme = bpy.context.preferences.themes[0].user_interface
    theme.wcol_box.inner = theme.panel_back
    bpy.context.preferences.view.show_splash = False
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    bpy.context.view_layer.name = "Canvas"
    bpy.context.scene.tool_settings.lock_object_mode = False
    for name, cy in (("Button", 0.5), ("Label", 0.72)):
        obj = create_canvas_asset(bpy.context.collection, name, (0.5, cy))
        obj.select_set(True)
    bpy.context.view_layer.objects.active = bpy.data.objects["Button"]
    bpy.ops.object.mode_set(mode="EDIT")
    area = next(a for a in bpy.context.screen.areas if a.type == "VIEW_3D")
    area.type = "IMAGE_EDITOR"
    area.ui_type = "UV"
    image = bpy.data.images.new("Canvas", width=CANVAS_WIDTH, height=CANVAS_HEIGHT)
    image.generated_color = CANVAS_COLOR
    area.spaces.active.image = image
    bpy.context.scene.uai_canvas = image
    space = area.spaces.active
    space.show_region_toolbar = True
    space.cursor_location = (0.5, 0.28)
    space.use_image_pin = True
    space.uv_editor.show_faces = False
    space.uv_editor.show_uv = False
    space.overlay.show_grid_background = True
    image.uai_grids.add().name = "Rectangular"
    sync_grid(image, bpy.context)
    for prop in ("show_overlays", "show_grid_background"):
        bpy.msgbus.subscribe_rna(key=(type(space.overlay), prop), owner=refresh_canvas,
                                 args=(), notify=refresh_canvas)
    bpy.app.handlers.undo_post.append(refresh_canvas)
    bpy.app.handlers.redo_post.append(refresh_canvas)
    bpy.context.scene.tool_settings.snap_uv_element = {"GRID"}
    bpy.context.scene.tool_settings.use_snap_uv = False
    enforce_canvas_sync()
    bpy.context.scene.tool_settings.mesh_select_mode = (False, False, True)
    IMAGE_HT_header.draw = draw_header
    bpy.msgbus.subscribe_rna(key=(bpy.types.ToolSettings, "use_uv_select_sync"),
                             owner=enforce_canvas_sync, args=(), notify=enforce_canvas_sync)
    bpy.app.handlers.undo_post.append(enforce_canvas_sync)
    bpy.app.handlers.redo_post.append(enforce_canvas_sync)
    region = next(r for r in area.regions if r.type == "WINDOW")
    with bpy.context.temp_override(area=area, region=region):
        bpy.ops.uv.select_all(action="DESELECT")
        for member in bpy.context.objects_in_mode:
            member.select_set(member == bpy.context.view_layer.objects.active)
        if not bpy.app.background:
            bpy.ops.image.view_all(fit_view=True)
    selector = runpy.run_path(str(Path(__file__).with_name("canvas_selector.py")), run_name="uai_canvas_selector")
    bpy.types.SpaceImageEditor.draw_handler_add(
        draw_canvas, (selector["draw_canvas_text"], selector["draw_bounds"]), "WINDOW", "POST_VIEW")
    selector["register"](keyconfig, shape_outline)
    selector["configure_toolbar"]()
    if not bpy.app.background:
        with bpy.context.temp_override(area=area, region=region):
            bpy.ops.wm.tool_set_by_id(name="builtin.select_box")
    sidebar = runpy.run_path(str(Path(__file__).with_name("canvas_sidebar.py")), run_name="uai_canvas_sidebar")
    sidebar["configure"](bpy.context)
    bpy.app.handlers.depsgraph_update_post.append(guard_canvas_edit_mode)
    bpy.ops.ed.undo_push(message="Button canvas")


setup()
