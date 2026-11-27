"""Configure the native Outliner and Object properties for the canvas demo."""

from time import monotonic_ns

import bmesh
import bpy
from bl_ui import properties_object, space_image
from bl_ui.space_outliner import OUTLINER_HT_header
from bl_ui.space_properties import PROPERTIES_HT_header, PROPERTIES_PT_navigation_bar, tabs_attr_infos
from mathutils import Vector


def edit_geometry(data):
    if not data.is_editmode:
        return None
    mesh = bmesh.from_edit_mesh(data)
    uv = mesh.loops.layers.uv.active
    if uv and len(mesh.faces) == 1:
        face = next(iter(mesh.faces))
        if len(face.loops) == 4:
            return mesh, face, uv


def pixel_property(label, axis, dimension):
    def extent(data):
        geometry = edit_geometry(data)
        if not geometry:
            return None
        mesh, face, uv = geometry
        coords = [loop[uv].uv[axis] for loop in face.loops]
        return mesh, face, uv, min(coords), max(coords)

    def get(mesh_data):
        data = extent(mesh_data)
        image = bpy.context.scene.uai_canvas
        if not data or not image:
            return 0.0
        low, high = data[-2:]
        value = high - low if dimension else (1 - high if axis else low)
        return value * image.size[axis]

    def set_value(mesh_data, value):
        data = extent(mesh_data)
        image = bpy.context.scene.uai_canvas
        if not data or not image:
            return
        mesh, face, uv, low, high = data
        value /= image.size[axis]
        origin = high if axis else low
        offset = (1 - value if axis else value) - origin
        pivot_layers = mesh.faces.layers.float_vector
        layer = pivot_layers.get("uai_pivot")
        if dimension and (layer is None or not face[layer].z):
            center = sum((loop[uv].uv for loop in face.loops), Vector((0, 0))) / len(face.loops)
            if layer is None:
                layer = pivot_layers.new("uai_pivot")
            face = next(iter(mesh.faces))
            face[layer] = (*center, 1)
        for index, loop in enumerate(face.loops):
            point = loop[uv].uv
            if dimension and high == low:
                # Restore an axis collapsed by a scale handle from the quad's corner order.
                fraction = (0, 1, 1, 0)[index] if axis == 0 else (-1, -1, 0, 0)[index]
                point[axis] = origin + fraction * value
            elif dimension:
                point[axis] = origin + (point[axis] - origin) * value / (high - low)
            else:
                point[axis] += offset
        if not dimension and layer and face[layer].z:
            face[layer][axis] += offset
        bmesh.update_edit_mesh(mesh_data, loop_triangles=False, destructive=False)

    options = {"min": 0.01} if dimension else {}
    return bpy.props.FloatProperty(name=label, subtype="PIXEL", precision=2, options=set(),
                                   get=get, set=set_value, **options)


def draw_transform(self, context):
    obj = context.object
    if not obj or not obj.get("uai_kind") or not obj.select_get():
        return
    layout = self.layout
    layout.use_property_split = True
    layout.use_property_decorate = False
    for pair in (("x", "y"), ("width", "height")):
        col = layout.column(align=True)
        for key in pair:
            col.prop(obj.data, "uai_" + key)


class UAI_PT_canvas_transform(bpy.types.Panel):
    bl_idname = "IMAGE_PT_uv"
    bl_label = "Transform"
    bl_space_type = "IMAGE_EDITOR"
    bl_region_type = "UI"
    bl_category = "Item"

    @classmethod
    def poll(cls, context):
        return (context.area.ui_type == "UV" and context.scene.uai_canvas
                and context.space_data.image == context.scene.uai_canvas)

    def draw(self, context):
        obj = context.active_object
        layout = self.layout
        if not obj or not obj.get("uai_kind") or not obj.select_get():
            layout.active = False
            layout.label(text="No selection")
            return
        for label, keys in (("Location", ("x", "y")), ("Dimensions", ("width", "height"))):
            layout.label(text=label)
            fields = layout.column(align=True)
            for axis, key in zip(("X", "Y"), keys):
                fields.prop(obj.data, "uai_" + key, text=axis)


def search_header(self, space, prop):
    layout = self.layout
    layout.template_header()
    layout.separator_spacer()
    layout.prop(space, prop, text="", icon="VIEWZOOM")
    layout.separator_spacer()


def configure_item_tab():
    # The standalone demo owns its Image Editor. Blender registers UV Vertex
    # and Metadata in C, so replace their native IDs through panel registration.
    bpy.utils.register_class(UAI_PT_canvas_transform)
    class IMAGE_PT_metadata(bpy.types.Panel):
        bl_label = "Metadata"
        bl_space_type = "IMAGE_EDITOR"
        bl_region_type = "UI"
        bl_category = "Image"

        def draw(self, context):
            pass

    bpy.utils.register_class(IMAGE_PT_metadata)
    bpy.utils.unregister_class(IMAGE_PT_metadata)
    def outside_canvas(stock_poll):
        def poll(cls, context):
            return not UAI_PT_canvas_transform.poll(context) and stock_poll(context)
        return classmethod(poll)

    for panel in (space_image.IMAGE_PT_image_properties, space_image.IMAGE_PT_render_slots,
                  space_image.IMAGE_PT_udim_tiles):
        stock_poll = panel.poll
        bpy.utils.unregister_class(panel)
        panel.poll = outside_canvas(stock_poll)
        bpy.utils.register_class(panel)

    # Register the remaining canvas categories after Item, in toolbar order.
    for panel in (space_image.IMAGE_PT_active_tool, space_image.IMAGE_PT_view_display,
                  space_image.IMAGE_PT_uv_cursor, space_image.IMAGE_PT_annotation):
        bpy.utils.unregister_class(panel)
        bpy.utils.register_class(panel)


def draw_object_tab(self, context):
    # Match Blender's Properties navigation rail, including its tab padding.
    layout = self.layout
    layout.scale_x = layout.scale_y = 1.4
    space = context.space_data
    if space.search_filter:
        layout.prop_tabs_enum(space, "context", icon_only=True,
                              data_highlight=space, property_highlight="tab_search_results")
    else:
        layout.prop_tabs_enum(space, "context", icon_only=True)


def sync_selection(scene, depsgraph):
    # Native Outliner actions change object selection. Native UV commands use faces.
    if not scene.uai_canvas or bpy.context.mode != "EDIT_MESH":
        return
    selected_objects = []
    newly_selected = []
    for obj in bpy.context.objects_in_mode_unique_data:
        if obj.type != "MESH" or not obj.get("uai_kind"):
            continue
        data = edit_geometry(obj.data)
        if not data:
            continue
        mesh, face, _ = data
        selected = obj.select_get()
        previous = selection_state.get(obj.session_uid)
        if selected != face.select:
            if previous is not None and previous == selected:
                selected = face.select
                obj.select_set(selected)
            else:
                face.select_set(selected)
                mesh.uv_select_sync_from_mesh()
                bmesh.update_edit_mesh(obj.data, loop_triangles=False, destructive=False)
        selection_state[obj.session_uid] = selected
        if selected and obj.visible_get() and not face.hide:
            selected_objects.append(obj)
            if previous is False:
                newly_selected.append(obj)

    # UV selection changes faces but leaves Blender's active edit object behind.
    # Keep an existing active member for a box selection with multiple additions.
    objects = bpy.context.view_layer.objects
    if len(newly_selected) == 1:
        active = newly_selected[0]
    elif selected_objects and objects.active not in selected_objects:
        active = max(selected_objects, key=lambda obj: active_order.get(obj.session_uid, 0))
    elif objects.active in selected_objects:
        active = objects.active
    else:
        return
    if objects.active != active:
        objects.active = active
    active_order[active.session_uid] = monotonic_ns()


selection_state = {}
active_order = {}


def canvas_draw(panel, draw):
    stock = panel.draw

    def dispatch(self, context):
        if context.scene and context.scene.uai_canvas:
            return draw(self, context)
        return stock(self, context)

    panel.draw = dispatch


def object_panel_poll(panel, keep):
    stock = getattr(panel, "poll", None)

    def poll(cls, context):
        if context.scene and context.scene.uai_canvas:
            obj = context.object
            return bool(keep and obj and obj.get("uai_kind") and obj.select_get())
        return stock(context) if stock else True

    return classmethod(poll)


def configure(context):
    configure_item_tab()
    for axis, label in enumerate(("X", "Y")):
        setattr(bpy.types.Mesh, "uai_" + label.lower(), pixel_property(label, axis, False))
    for axis, label in enumerate(("Width", "Height")):
        setattr(bpy.types.Mesh, "uai_" + label.lower(), pixel_property(label, axis, True))

    panels = [p for p in properties_object.classes if issubclass(p, bpy.types.Panel)]
    keep = (properties_object.OBJECT_PT_context_object, properties_object.OBJECT_PT_transform)
    # Blender installs poll callbacks when registering each panel. Keep parent order.
    for panel in reversed(panels):
        bpy.utils.unregister_class(panel)
    for panel in panels:
        panel.poll = object_panel_poll(panel, panel in keep)
        bpy.utils.register_class(panel)
    canvas_draw(properties_object.OBJECT_PT_transform, draw_transform)
    canvas_draw(OUTLINER_HT_header, lambda panel, ctx: search_header(panel, ctx.space_data, "filter_text"))
    canvas_draw(PROPERTIES_HT_header, lambda panel, ctx: search_header(panel, ctx.space_data, "search_filter"))
    canvas_draw(PROPERTIES_PT_navigation_bar, draw_object_tab)
    bpy.app.handlers.depsgraph_update_post.append(sync_selection)
    sync_selection(context.scene, None)
    configure_spaces()
    for key in ((bpy.types.Area, "type"), (bpy.types.Window, "workspace")):
        bpy.msgbus.subscribe_rna(key=key, owner=configure_spaces, args=(), notify=configure_spaces)


def configure_spaces():
    for window in bpy.context.window_manager.windows:
        if window.scene.uai_canvas:
            configure_screen(window.screen)


def configure_screen(screen):
    for area in screen.areas:
        space = area.spaces.active
        if area.type == "PROPERTIES":
            space.context = "OBJECT"
            for prop, _, _ in tabs_attr_infos:
                setattr(space, prop, prop == "show_properties_object")
        elif area.type == "OUTLINER":
            space.display_mode = "VIEW_LAYER"
            space.use_filter_view_layers = True
            space.use_filter_collection = False
            space.use_filter_children = True
            space.use_filter_object_content = False
            space.show_mode_column = False
            space.show_restrict_column_enable = False
            space.show_restrict_column_render = False
            space.show_restrict_column_hide = True
