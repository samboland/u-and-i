"""Open a disposable button in Blender's native UV editor."""

import blf
import bpy
import gpu
import math
import os
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


class CanvasHeaderLayout:
    def __init__(self, layout):
        self.layout = layout

    def __getattr__(self, name):
        return getattr(self.layout, name)

    def prop(self, data, property_name, **options):
        if property_name != "use_uv_select_sync":
            return self.layout.prop(data, property_name, **options)

    def template_ID(self, data, property_name, **options):
        if property_name != "image":
            return self.layout.template_ID(data, property_name, **options)
        row = self.layout.row(align=True)
        row.prop(data, "image", text="", icon="IMAGE_DATA", icon_only=True)
        image = data.image
        if image:
            row.prop(image, "name", text="")
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
    if context.area.ui_type == "UV" and context.scene.uai_canvas:
        return stock_header(SimpleNamespace(layout=CanvasHeaderLayout(self.layout)), context)
    return stock_header(self, context)


def enforce_canvas_sync(*_):
    scene = bpy.context.scene
    if scene and scene.uai_canvas and not scene.tool_settings.use_uv_select_sync:
        scene.tool_settings.use_uv_select_sync = True


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


def draw_assets():
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
                draw_face(points, indices, obj.name if len(mesh.polygons) == 1 else "")
        finally:
            evaluated.to_mesh_clear()


def draw_face(points, indices, label):
    cx = sum(x for x, _ in points) / len(points)
    cy = sum(y for _, y in points) / len(points)
    # Leave Blender's selected edges and vertex handles visible.
    # Use a uniform scale so rotated and skewed edges stay parallel.
    radius = max(1, max(abs(y - cy) for _, y in points))
    scale = max(0, 1 - 2 / radius)
    inset = [(cx + (x - cx) * scale, cy + (y - cy) * scale) for x, y in points]
    shader = gpu.shader.from_builtin("UNIFORM_COLOR")
    batch = batch_for_shader(shader, "TRIS", {"pos": inset},
                             indices=indices)
    shader.bind()
    shader.uniform_float("color", (0.19, 0.32, 0.43, 1))
    batch.draw(shader)
    blf.size(0, 16 * bpy.context.preferences.system.ui_scale)
    width, height = blf.dimensions(0, label)
    if max(x for x, _ in inset) - min(x for x, _ in inset) > width + 8:
        blf.position(0, cx - width / 2, cy - height / 2, 0)
        blf.color(0, 1, 1, 1, 1)
        blf.draw(0, label)


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
    for name, cy in (("Button", 0.5), ("Label", 0.72)):
        mesh = bpy.data.meshes.new(name)
        corners = [(0.35, cy - 0.06), (0.65, cy - 0.06),
                   (0.65, cy + 0.06), (0.35, cy + 0.06)]
        mesh.from_pydata([(x, y, 0) for x, y in corners], [], [(0, 1, 2, 3)])
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        layer = mesh.uv_layers.new()
        for index, uv in enumerate(corners):
            layer.uv[index].vector = uv
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
    space.use_image_pin = True
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
    bpy.context.scene.tool_settings.mesh_select_mode = (False, True, False)
    IMAGE_HT_header.draw = draw_header
    bpy.msgbus.subscribe_rna(key=(bpy.types.ToolSettings, "use_uv_select_sync"),
                             owner=enforce_canvas_sync, args=(), notify=enforce_canvas_sync)
    bpy.app.handlers.undo_post.append(enforce_canvas_sync)
    bpy.app.handlers.redo_post.append(enforce_canvas_sync)
    region = next(r for r in area.regions if r.type == "WINDOW")
    with bpy.context.temp_override(area=area, region=region):
        bpy.ops.uv.select_all(action="DESELECT")
        if not bpy.app.background:
            bpy.ops.image.view_all(fit_view=True)
    bpy.types.SpaceImageEditor.draw_handler_add(draw_assets, (), "WINDOW", "POST_PIXEL")
    bpy.ops.ed.undo_push(message="Button canvas")


setup()
