"""Open a disposable button in Blender's native UV editor."""

import blf
import bpy
import gpu
from bl_ui.space_image import IMAGE_PT_overlay_guides
from gpu_extras.batch import batch_for_shader

CANVAS_WIDTH = 640
CANVAS_HEIGHT = 400


def pixel_spacing(label, key, size):
    steps = tuple(n for n in range(1, size + 1) if size % n == 0)

    def get(grid):
        return grid.get(key, 8)

    def set_value(grid, value):
        previous = get(grid)
        if value == previous + 1:
            grid[key] = next(n for n in steps if n >= value)
        elif value == previous - 1:
            grid[key] = next(n for n in reversed(steps) if n <= value)
        else:
            grid[key] = min(steps, key=lambda n: abs(n - value))

    return bpy.props.IntProperty(name=label, subtype="PIXEL", min=1, max=size,
                                 get=get, set=set_value, update=grid_changed,
                                 description="Cell spacing in whole pixels that divide the canvas")


def sync_grid(image, context):
    # The native UV viewport has one fixed grid. Preview the last visible entry.
    grid = next((item for item in reversed(list(image.uai_grids)) if item.visible), None)
    for window in context.window_manager.windows:
        for area in window.screen.areas:
            space = area.spaces.active
            if area.ui_type == "UV" and space.image == image:
                uv = space.uv_editor
                uv.show_grid_over_image = grid is not None
                if grid:
                    width, height = image.size
                    uv.grid_shape_source = "FIXED"
                    uv.custom_grid_subdivisions = (width // int(grid.x), height // int(grid.y))
                area.tag_redraw()


def grid_changed(self, context):
    sync_grid(self.id_data, context)


class UAI_Grid(bpy.types.PropertyGroup):
    expanded: bpy.props.BoolProperty(default=True)
    visible: bpy.props.BoolProperty(name="Visible", default=True, update=grid_changed)
    x: pixel_spacing("Spacing X", "spacing_x", CANVAS_WIDTH)
    y: pixel_spacing("Spacing Y", "spacing_y", CANVAS_HEIGHT)


class UAI_OT_add_grid(bpy.types.Operator):
    bl_idname = "uai.add_grid"
    bl_label = "Add Grid"
    bl_options = {"UNDO"}

    def execute(self, context):
        image = context.space_data.image
        grids = image.uai_grids
        number = 2
        name = "Rectangular"
        while name in grids:
            name = f"Rectangular {number}"
            number += 1
        grids.add().name = name
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
    layout.operator("uai.add_grid", icon="ADD")
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
            fields.prop(grid, "x")
            fields.prop(grid, "y")


def button_corners(mesh):
    if not mesh.polygons or mesh.uv_layers.active is None:
        return []
    coords = mesh.uv_layers.active.uv
    return [tuple(coords[i].vector) for i in mesh.polygons[0].loop_indices]


def draw_button():
    obj = bpy.context.edit_object
    if obj is None or obj.name != "Button" or bpy.context.area.ui_type != "UV":
        return
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    # Read a snapshot while Blender's modal transform owns the edit mesh.
    mesh = evaluated.to_mesh()
    try:
        corners = button_corners(mesh)
    finally:
        evaluated.to_mesh_clear()
    if len(corners) != 4:
        return
    view = bpy.context.region.view2d
    points = [view.view_to_region(x, y, clip=False) for x, y in corners]
    cx = sum(x for x, _ in points) / 4
    cy = sum(y for _, y in points) / 4
    # Leave Blender's selected edges and vertex handles visible.
    # Use a uniform scale so rotated and skewed edges stay parallel.
    radius = max(1, max(abs(y - cy) for _, y in points))
    scale = max(0, 1 - 2 / radius)
    inset = [(cx + (x - cx) * scale, cy + (y - cy) * scale) for x, y in points]
    shader = gpu.shader.from_builtin("UNIFORM_COLOR")
    batch = batch_for_shader(shader, "TRIS", {"pos": inset},
                             indices=((0, 1, 2), (0, 2, 3)))
    shader.bind()
    shader.uniform_float("color", (0.19, 0.32, 0.43, 1))
    batch.draw(shader)
    blf.size(0, 16 * bpy.context.preferences.system.ui_scale)
    width, height = blf.dimensions(0, "Button")
    if max(x for x, _ in inset) - min(x for x, _ in inset) > width + 8:
        blf.position(0, cx - width / 2, cy - height / 2, 0)
        blf.color(0, 1, 1, 1, 1)
        blf.draw(0, "Button")


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
    for cls in (UAI_Grid, UAI_OT_add_grid, UAI_OT_remove_grid, UAI_OT_move_grid, UAI_MT_grid_actions):
        bpy.utils.register_class(cls)
    bpy.types.Image.uai_grids = bpy.props.CollectionProperty(type=UAI_Grid)
    IMAGE_PT_overlay_guides.draw = draw_guides
    bpy.types.Scene.uai_canvas = bpy.props.PointerProperty(type=bpy.types.Image)
    bpy.utils.register_class(UAI_OT_canvas_wheel)
    keyconfig = bpy.context.window_manager.keyconfigs.addon
    if keyconfig:
        keymap = keyconfig.keymaps.new(name="Image", space_type="IMAGE_EDITOR")
        for wheel in ("WHEELUPMOUSE", "WHEELDOWNMOUSE"):
            for modifiers in ({}, {"shift": True}, {"ctrl": True}):
                keymap.keymap_items.new("uai.canvas_wheel", wheel, "PRESS", **modifiers)
    bpy.context.preferences.inputs.use_zoom_to_mouse = True
    # This standalone demo uses the modifier surface for its boxed layouts.
    bpy.context.preferences.use_preferences_save = False
    theme = bpy.context.preferences.themes[0].user_interface
    theme.wcol_box.inner = theme.panel_back
    bpy.context.preferences.view.show_splash = False
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    mesh = bpy.data.meshes.new("Button")
    mesh.from_pydata([(-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)],
                     [], [(0, 1, 2, 3)])
    mesh.update()
    obj = bpy.data.objects.new("Button", mesh)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    layer = mesh.uv_layers.new()
    for index, uv in enumerate([(0.35, 0.44), (0.65, 0.44),
                                (0.65, 0.56), (0.35, 0.56)]):
        layer.uv[index].vector = uv
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    area = next(a for a in bpy.context.screen.areas if a.type == "VIEW_3D")
    area.type = "IMAGE_EDITOR"
    area.ui_type = "UV"
    image = bpy.data.images.new("Canvas", width=CANVAS_WIDTH, height=CANVAS_HEIGHT)
    image.generated_color = (0.14, 0.15, 0.17, 1)
    area.spaces.active.image = image
    bpy.context.scene.uai_canvas = image
    space = area.spaces.active
    space.overlay.show_grid_background = True
    image.uai_grids.add().name = "Rectangular"
    sync_grid(image, bpy.context)
    bpy.context.scene.tool_settings.snap_uv_element = {"GRID"}
    bpy.context.scene.tool_settings.use_snap_uv = False
    bpy.context.scene.tool_settings.use_uv_select_sync = False
    bpy.context.scene.tool_settings.uv_select_mode = "EDGE"
    region = next(r for r in area.regions if r.type == "WINDOW")
    with bpy.context.temp_override(area=area, region=region):
        bpy.ops.uv.select_all(action="DESELECT")
        if not bpy.app.background:
            bpy.ops.image.view_all(fit_view=True)
    bpy.types.SpaceImageEditor.draw_handler_add(draw_button, (), "WINDOW", "POST_PIXEL")
    bpy.ops.ed.undo_push(message="Button canvas")


setup()
