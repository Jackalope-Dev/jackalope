#define _POSIX_C_SOURCE 200809L
#include <X11/Xatom.h>
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <X11/extensions/XInput2.h>
#include <X11/extensions/XTest.h>
#include <X11/extensions/Xcomposite.h>
#include <X11/keysym.h>
#include <atspi/atspi.h>
#include <gdk/gdkx.h>
#include <glib-unix.h>
#include <gtk/gtk.h>
#include <json-glib/json-glib.h>
#include <signal.h>
#include <stdio.h>
#include <sys/stat.h>
#include <unistd.h>

typedef struct {
  int x, y, width, height;
} Bounds;
static gboolean wayland_backend;
static JsonObject *wayland_info;
static gboolean wayland_coordinates;
static gint64 wayland_origin_x, wayland_origin_y;
static void wayland_input_check(Bounds expected);
static int wayland_main(const char *action);
static Display *display;
static Window root, selected;
static long selected_pid;
static char *selected_start, *selected_class;
static int xerror;
static JsonObject *request;
static const char *state_file;
static guint64 epoch = 1;
static const char *status = "paused", *reason = "Click Resume to begin";
static GtkWidget *bar, *label, *toggle;
static Bounds previous;
static pid_t parent;
static int xi_opcode;
static GArray *synthetic_devices;
static guint resume_source;
static guint32 resume_after;
static GtkCssProvider *style;
static char *previous_theme;

static void fail(const char *message) {
  g_printerr("%s", message);
  exit(1);
}
static void check(gboolean ok, const char *message) {
  if (!ok)
    fail(message);
}
static int x_error(Display *unused, XErrorEvent *event) {
  (void)unused;
  xerror = event->error_code;
  return 0;
}
static gboolean x_ok(void) {
  XSync(display, False);
  gboolean ok = !xerror;
  xerror = 0;
  return ok;
}
static const char *string(JsonObject *object, const char *key) {
  if (!object || !json_object_has_member(object, key))
    return "";
  JsonNode *node = json_object_get_member(object, key);
  return JSON_NODE_HOLDS_VALUE(node) &&
                 json_node_get_value_type(node) == G_TYPE_STRING
             ? json_node_get_string(node)
             : "";
}
static gint64 number(JsonObject *object, const char *key) {
  check(object && json_object_has_member(object, key),
        "Missing numeric parameter.");
  return json_object_get_int_member(object, key);
}
static JsonObject *object(JsonObject *value, const char *key) {
  check(value && json_object_has_member(value, key) &&
            JSON_NODE_HOLDS_OBJECT(json_object_get_member(value, key)),
        "Missing object parameter.");
  return json_object_get_object_member(value, key);
}
static void output(JsonObject *result) {
  JsonNode *node = json_node_new(JSON_NODE_OBJECT);
  json_node_take_object(node, result);
  char *json = json_to_string(node, FALSE);
  check(fwrite(json, 1, strlen(json), stdout) == strlen(json),
        "Cannot write helper response.");
  check(fflush(stdout) == 0, "Cannot flush helper response.");
  g_free(json);
  json_node_free(node);
}
static char *process_start(long pid) {
  char *path = g_strdup_printf("/proc/%ld/stat", pid), *text = NULL;
  struct stat metadata;
  gboolean owned = stat(path, &metadata) == 0 && metadata.st_uid == geteuid();
  if (owned)
    g_file_get_contents(path, &text, NULL, NULL);
  g_free(path);
  if (!text)
    return NULL;
  char *end = strrchr(text, ')');
  if (!end || end[1] != ' ') {
    g_free(text);
    return NULL;
  }
  char **fields = g_strsplit(end + 2, " ", 0);
  char *result = g_strv_length(fields) > 19 ? g_strdup(fields[19]) : NULL;
  g_strfreev(fields);
  g_free(text);
  return result;
}
static unsigned char *property(Window window, const char *name, Atom type,
                               unsigned long *count) {
  Atom actual;
  int format;
  unsigned long remaining;
  unsigned char *data = NULL;
  int result = XGetWindowProperty(
      display, window, XInternAtom(display, name, False), 0, 16384, False, type,
      &actual, &format, count, &remaining, &data);
  int expected_format =
      type == XInternAtom(display, "UTF8_STRING", False) ? 8 : 32;
  if (!x_ok() || result != Success || actual != type ||
      format != expected_format || remaining) {
    if (data)
      XFree(data);
    *count = 0;
    return NULL;
  }
  return data;
}
static long window_pid(Window window) {
  unsigned long count;
  unsigned char *data = property(window, "_NET_WM_PID", XA_CARDINAL, &count);
  long pid = data && count == 1 ? ((unsigned long *)data)[0] : 0;
  if (data)
    XFree(data);
  return pid;
}
static char *window_class(Window window) {
  XClassHint hint = {0};
  char *result = NULL;
  if (XGetClassHint(display, window, &hint) && x_ok() && hint.res_class)
    result = g_strdup(hint.res_class);
  if (hint.res_name)
    XFree(hint.res_name);
  if (hint.res_class)
    XFree(hint.res_class);
  return result;
}
static gboolean window_bounds(Window window, Bounds *result) {
  XWindowAttributes attrs;
  Window child;
  int x, y;
  if (!XGetWindowAttributes(display, window, &attrs) || !x_ok() ||
      attrs.map_state != IsViewable || attrs.width <= 0 || attrs.height <= 0)
    return FALSE;
  if (!XTranslateCoordinates(display, window, root, 0, 0, &x, &y, &child) ||
      !x_ok())
    return FALSE;
  *result = (Bounds){x, y, attrs.width, attrs.height};
  return TRUE;
}
static gboolean same_bounds(Bounds a, Bounds b) {
  return a.x == b.x && a.y == b.y && a.width == b.width && a.height == b.height;
}
static Window window_frame(Window window) {
  for (int depth = 0; depth < 32; depth++) {
    Window r, p, *children = NULL;
    unsigned int count;
    if (!XQueryTree(display, window, &r, &p, &children, &count) || !x_ok())
      return None;
    if (children)
      XFree(children);
    if (p == root)
      return window;
    window = p;
  }
  return None;
}
static gboolean identity(Bounds *bounds) {
  char *start = process_start(selected_pid), *class = window_class(selected);
  gboolean valid = start && class && !strcmp(start, selected_start) &&
                   !strcmp(class, selected_class) &&
                   window_pid(selected) == selected_pid &&
                   window_bounds(selected, bounds);
  g_free(start);
  g_free(class);
  return valid;
}
static gboolean descendant(Window window, Window ancestor) {
  for (int depth = 0; depth < 32 && window != None && window != root; depth++) {
    if (window == ancestor)
      return TRUE;
    Window r, p, *children = NULL;
    unsigned int count;
    if (!XQueryTree(display, window, &r, &p, &children, &count) || !x_ok())
      return FALSE;
    if (children)
      XFree(children);
    window = p;
  }
  return FALSE;
}
static gboolean foreground(void) {
  unsigned long count;
  unsigned char *data = property(root, "_NET_ACTIVE_WINDOW", XA_WINDOW, &count);
  gboolean active = data && count == 1 && ((Window *)data)[0] == selected;
  if (data)
    XFree(data);
  Window focus;
  int revert;
  XGetInputFocus(display, &focus, &revert);
  return x_ok() && active && descendant(focus, selected);
}
static void focus_selected(void) {
  XEvent event = {0};
  event.xclient.type = ClientMessage;
  event.xclient.window = selected;
  event.xclient.message_type =
      XInternAtom(display, "_NET_ACTIVE_WINDOW", False);
  event.xclient.format = 32;
  event.xclient.data.l[0] = 2;
  event.xclient.data.l[1] = CurrentTime;
  XSendEvent(display, root, False,
             SubstructureNotifyMask | SubstructureRedirectMask, &event);
  XFlush(display);
}
static JsonObject *bounds_json(Bounds bounds) {
  JsonObject *value = json_object_new();
  json_object_set_int_member(value, "x", bounds.x);
  json_object_set_int_member(value, "y", bounds.y);
  json_object_set_int_member(value, "width", bounds.width);
  json_object_set_int_member(value, "height", bounds.height);
  return value;
}
static void guard_check(void) {
  JsonObject *guard = object(request, "guard");
  const char *file = string(guard, "file");
  char *text = NULL;
  gsize length = 0;
  check(g_file_get_contents(file, &text, &length, NULL) && length < 4096,
        "Desktop indicator is unavailable.");
  char **fields = g_strsplit(text, "|", 0);
  check(g_strv_length(fields) == 6, "Desktop indicator state is invalid.");
  char *start = process_start(g_ascii_strtoll(fields[3], NULL, 10));
  gint64 age = g_get_real_time() / 1000 - g_ascii_strtoll(fields[2], NULL, 10);
  gboolean valid = !strcmp(fields[0], "active") &&
                   g_ascii_strtoull(fields[1], NULL, 10) ==
                       (guint64)number(guard, "epoch") &&
                   age >= 0 && age <= 3000 && start &&
                   !strcmp(start, fields[4]);
  g_free(start);
  g_strfreev(fields);
  g_free(text);
  check(valid, "Desktop control paused, changed or ended. Wait for the human "
               "to Resume.");
}
static gboolean held_input(void) {
  char keys[32];
  XQueryKeymap(display, keys);
  for (int i = 0; i < 32; i++)
    if (keys[i])
      return TRUE;
  Window r, child;
  int rx, ry, wx, wy;
  unsigned int mask;
  if (!XQueryPointer(display, root, &r, &child, &rx, &ry, &wx, &wy, &mask) ||
      !x_ok())
    return TRUE;
  return (mask & (ShiftMask | ControlMask | Mod1Mask | Mod4Mask | Button1Mask |
                  Button2Mask | Button3Mask | Button4Mask | Button5Mask)) != 0;
}
static void input_check(Bounds expected) {
  if (wayland_backend) {
    wayland_input_check(expected);
    return;
  }
  Bounds current;
  guard_check();
  check(identity(&current) && same_bounds(expected, current),
        "Window identity or bounds changed. Take a fresh snapshot.");
  check(foreground(),
        "The selected window lost focus. Wait for the human to Resume.");
}

static AtspiAccessible *accessible_window(Bounds bounds) {
  Bounds frame_bounds = bounds;
  if (!wayland_backend) {
    Window frame = window_frame(selected);
    check(frame && window_bounds(frame, &frame_bounds),
          "Cannot identify selected window frame.");
  }
  check(atspi_init() == 0, "Accessibility service is unavailable.");
  atspi_set_timeout(400, 400);
  AtspiAccessible *desktop = atspi_get_desktop(0), *match = NULL;
  check(desktop != NULL, "Accessibility desktop is unavailable.");
  int apps = MIN(atspi_accessible_get_child_count(desktop, NULL), 100);
  for (int i = 0; i < apps; i++) {
    AtspiAccessible *app =
        atspi_accessible_get_child_at_index(desktop, i, NULL);
    if (!app)
      continue;
    if (atspi_accessible_get_process_id(app, NULL) == (guint)selected_pid) {
      int windows = MIN(atspi_accessible_get_child_count(app, NULL), 100);
      for (int j = 0; j < windows; j++) {
        AtspiAccessible *window =
            atspi_accessible_get_child_at_index(app, j, NULL);
        if (!window)
          continue;
        AtspiComponent *component =
            atspi_accessible_get_component_iface(window);
        AtspiRect *rect = component
                              ? atspi_component_get_extents(
                                    component, wayland_backend ? ATSPI_COORD_TYPE_WINDOW : ATSPI_COORD_TYPE_SCREEN, NULL)
                              : NULL;
        Bounds accessible =
            rect ? (Bounds){rect->x, rect->y, rect->width, rect->height}
                 : (Bounds){0};
        char *title = wayland_backend ? atspi_accessible_get_name(window, NULL) : NULL;
        gboolean matches = wayland_backend
            ? title && !strcmp(title, string(wayland_info, "title"))
            : rect && (same_bounds(bounds, accessible) || same_bounds(frame_bounds, accessible));
        g_free(title);
        if (matches) {
          check(match == NULL, "Accessible window identity is ambiguous.");
          match = g_object_ref(window);
          if (wayland_backend && rect) {
            JsonObject *buffer = object(wayland_info, "buffer");
            gboolean surface = rect->width == number(buffer, "width") && rect->height == number(buffer, "height");
            wayland_coordinates = surface || (rect->width == bounds.width && rect->height == bounds.height);
            wayland_origin_x = rect->x + (surface ? bounds.x - number(buffer, "x") : 0);
            wayland_origin_y = rect->y + (surface ? bounds.y - number(buffer, "y") : 0);
          }
        }
        g_free(rect);
        if (component)
          g_object_unref(component);
        g_object_unref(window);
      }
    }
    g_object_unref(app);
  }
  g_object_unref(desktop);
  check(match != NULL, "This app does not expose an accessible window matching "
                       "the selected window.");
  return match;
}
static void tree(AtspiAccessible *item, JsonArray *nodes, int depth,
                 Bounds bounds, gint64 deadline, AtspiAccessible **focused,
                 gboolean protected_parent) {
  if (depth > 12 || json_array_get_length(nodes) >= 160 ||
      g_get_monotonic_time() > deadline)
    return;
  if (wayland_backend) { bounds.x = 0; bounds.y = 0; }
  atspi_accessible_set_cache_mask(item, ATSPI_CACHE_NONE);
  atspi_accessible_clear_cache(item);
  gboolean password =
      protected_parent ||
      atspi_accessible_get_role(item, NULL) == ATSPI_ROLE_PASSWORD_TEXT;
  JsonObject *node = json_object_new();
  char *role = atspi_accessible_get_role_name(item, NULL);
  char *name = password ? g_strdup("[redacted password control]")
                        : atspi_accessible_get_name(item, NULL);
  json_object_set_string_member(node, "role", role ? role : "unknown");
  if (name && g_utf8_validate(name, -1, NULL)) {
    char *limited =
        g_utf8_substring(name, 0, MIN(g_utf8_strlen(name, -1), 200));
    json_object_set_string_member(node, "name", limited);
    g_free(limited);
  }
  if (!password) {
    AtspiText *view = atspi_accessible_get_text_iface(item);
    if (view) {
      int count = atspi_text_get_character_count(view, NULL);
      char *text = count > 0
                       ? atspi_text_get_text(view, 0, MIN(count, 200), NULL)
                       : NULL;
      if (text && g_utf8_validate(text, -1, NULL))
        json_object_set_string_member(node, "value", text);
      g_free(text);
      g_object_unref(view);
    }
  }
  json_object_set_boolean_member(node, "password", password);
  json_object_set_int_member(node, "depth", depth);
  AtspiStateSet *states = atspi_accessible_get_state_set(item);
  if (focused && states &&
      atspi_state_set_contains(states, ATSPI_STATE_FOCUSED)) {
    check(!password, "Typing and keypresses are blocked in password controls.");
    check(*focused == NULL, "Focused control is ambiguous.");
    *focused = g_object_ref(item);
  }
  if (states)
    g_object_unref(states);
  AtspiComponent *component = atspi_accessible_get_component_iface(item);
  AtspiRect *rect = component ? atspi_component_get_extents(
                                    component, wayland_backend ? ATSPI_COORD_TYPE_WINDOW : ATSPI_COORD_TYPE_SCREEN, NULL)
                              : NULL;
  if (rect && rect->width > 0 && rect->height > 0 && (!wayland_backend || wayland_coordinates)) {
    gint64 origin_x = (gint64)rect->x - (wayland_backend ? wayland_origin_x : 0);
    gint64 origin_y = (gint64)rect->y - (wayland_backend ? wayland_origin_y : 0);
    gint64 left = MAX(origin_x, bounds.x), top = MAX(origin_y, bounds.y);
    gint64 right =
        MIN(origin_x + rect->width, (gint64)bounds.x + bounds.width);
    gint64 bottom =
        MIN(origin_y + rect->height, (gint64)bounds.y + bounds.height);
    if (right > left && bottom > top)
      json_object_set_object_member(
          node, "bounds",
          bounds_json((Bounds){left - bounds.x, top - bounds.y, right - left,
                               bottom - top}));
  }
  g_free(rect);
  if (component)
    g_object_unref(component);
  json_array_add_object_element(nodes, node);
  g_free(role);
  g_free(name);
  if (!password) {
    int count = MIN(atspi_accessible_get_child_count(item, NULL), 160);
    for (int i = 0; i < count && json_array_get_length(nodes) < 160; i++) {
      AtspiAccessible *child =
          atspi_accessible_get_child_at_index(item, i, NULL);
      if (child) {
        tree(child, nodes, depth + 1, bounds, deadline, focused, password);
        g_object_unref(child);
      }
    }
  }
}
static AtspiAccessible *focused_control(Bounds bounds) {
  AtspiAccessible *window = accessible_window(bounds), *focused = NULL;
  JsonArray *nodes = json_array_new();
  tree(window, nodes, 0, bounds, g_get_monotonic_time() + 4 * G_USEC_PER_SEC,
       &focused, FALSE);
  json_array_unref(nodes);
  g_object_unref(window);
  check(focused != NULL,
        "The focused control cannot be verified inside the selected window.");
  return focused;
}

static unsigned char channel(unsigned long pixel, unsigned long mask) {
  if (!mask)
    return 0;
  while (!(mask & 1)) {
    pixel >>= 1;
    mask >>= 1;
  }
  return (unsigned char)((pixel & mask) * 255 / mask);
}
static void screenshot(Bounds bounds) {
  check((gint64)bounds.width * bounds.height <= 20000000,
        "Selected window is too large to capture.");
  int event, error;
  check(XCompositeQueryExtension(display, &event, &error),
        "XComposite window capture is unavailable.");
  XCompositeRedirectWindow(display, selected, CompositeRedirectAutomatic);
  check(x_ok(), "Cannot prepare selected-window capture.");
  Pixmap pixmap = XCompositeNameWindowPixmap(display, selected);
  check(x_ok() && pixmap, "Selected-window capture is unavailable.");
  XWindowAttributes attrs;
  check(XGetWindowAttributes(display, selected, &attrs) && x_ok() &&
            attrs.visual->class == TrueColor,
        "Unsupported window pixel format.");
  Window image_root;
  int px, py;
  unsigned int pw, ph, border, depth;
  check(XGetGeometry(display, pixmap, &image_root, &px, &py, &pw, &ph, &border,
                     &depth) &&
            x_ok() &&
            pw == (unsigned int)(bounds.width + 2 * attrs.border_width) &&
            ph == (unsigned int)(bounds.height + 2 * attrs.border_width),
        "Capture dimensions do not match window coordinates.");
  XImage *image =
      XGetImage(display, pixmap, attrs.border_width, attrs.border_width,
                bounds.width, bounds.height, AllPlanes, ZPixmap);
  check(x_ok() && image, "Selected-window capture failed.");
  GdkPixbuf *pixels =
      gdk_pixbuf_new(GDK_COLORSPACE_RGB, FALSE, 8, bounds.width, bounds.height);
  check(pixels != NULL, "Cannot allocate window capture.");
  unsigned char *data = gdk_pixbuf_get_pixels(pixels);
  int stride = gdk_pixbuf_get_rowstride(pixels);
  for (int y = 0; y < bounds.height; y++)
    for (int x = 0; x < bounds.width; x++) {
      unsigned long pixel = XGetPixel(image, x, y);
      unsigned char *dest = data + y * stride + x * 3;
      dest[0] = channel(pixel, attrs.visual->red_mask);
      dest[1] = channel(pixel, attrs.visual->green_mask);
      dest[2] = channel(pixel, attrs.visual->blue_mask);
    }
  XDestroyImage(image);
  XFreePixmap(display, pixmap);
  XCompositeUnredirectWindow(display, selected, CompositeRedirectAutomatic);
  char *png = NULL;
  gsize size;
  check(gdk_pixbuf_save_to_buffer(pixels, &png, &size, "png", NULL, NULL) &&
            size <= 8 * 1024 * 1024,
        "Window capture exceeds the PNG limit.");
  input_check(bounds);
  GFile *file = g_file_new_for_path(string(request, "path"));
  GFileOutputStream *stream =
      g_file_create(file, G_FILE_CREATE_PRIVATE, NULL, NULL);
  check(stream &&
            g_output_stream_write_all(G_OUTPUT_STREAM(stream), png, size, NULL,
                                      NULL, NULL) &&
            g_output_stream_close(G_OUTPUT_STREAM(stream), NULL, NULL),
        "Cannot save window capture.");
  g_object_unref(stream);
  g_object_unref(file);
  g_free(png);
  g_object_unref(pixels);
}
static void point(Bounds bounds, int *x, int *y) {
  gint64 rx = number(request, "x"), ry = number(request, "y");
  check(rx >= 0 && ry >= 0 && rx < bounds.width && ry < bounds.height,
        "Point lies outside the selected window.");
  *x = bounds.x + (int)rx;
  *y = bounds.y + (int)ry;
  Window child = None;
  int tx, ty;
  check(XTranslateCoordinates(display, root, root, *x, *y, &tx, &ty, &child) &&
            x_ok() && child != None,
        "Cannot identify target point.");
  Window top = selected;
  for (int depth = 0; depth < 32; depth++) {
    Window r, p, *children = NULL;
    unsigned int count;
    check(XQueryTree(display, top, &r, &p, &children, &count) && x_ok(),
          "Cannot identify selected window frame.");
    if (children)
      XFree(children);
    if (p == root)
      break;
    top = p;
  }
  check(child == top, "Another window covers the target point.");
}

static void list_windows(void) {
  unsigned long count;
  Window *windows =
      (Window *)property(root, "_NET_CLIENT_LIST_STACKING", XA_WINDOW, &count);
  JsonObject *result = json_object_new();
  JsonArray *items = json_array_new();
  for (unsigned long i = count;
       windows && i > 0 && json_array_get_length(items) < 20; i--) {
    Window window = windows[i - 1];
    Bounds bounds;
    long pid = window_pid(window);
    char *start = process_start(pid), *class = window_class(window);
    unsigned long length;
    unsigned char *title =
        property(window, "_NET_WM_NAME",
                 XInternAtom(display, "UTF8_STRING", False), &length);
    if (pid && pid != getpid() && start && class && title && length &&
        g_utf8_validate((char *)title, length, NULL) &&
        window_bounds(window, &bounds)) {
      JsonObject *item = json_object_new();
      char *id = g_strdup_printf("%lu", window),
           *text = g_strndup((char *)title, length);
      json_object_set_string_member(item, "handle", id);
      json_object_set_int_member(item, "pid", pid);
      json_object_set_string_member(item, "started", start);
      json_object_set_string_member(item, "class", class);
      json_object_set_string_member(item, "title", text);
      json_array_add_object_element(items, item);
      g_free(id);
      g_free(text);
    }
    g_free(start);
    g_free(class);
    if (title)
      XFree(title);
  }
  if (windows)
    XFree(windows);
  json_object_set_array_member(result, "windows", items);
  output(result);
}

static void type_literal(Bounds bounds) {
      const char *text = string(request, "text");
      check(g_utf8_validate(text, -1, NULL) && g_utf8_strlen(text, -1) > 0 &&
                g_utf8_strlen(text, -1) <= 1000,
            "Invalid literal text.");
      for (const char *p = text; *p; p = g_utf8_next_char(p))
        check(!g_unichar_iscntrl(g_utf8_get_char(p)),
              "Control characters are not allowed.");
      AtspiAccessible *focused = focused_control(bounds);
      AtspiEditableText *editable =
          atspi_accessible_get_editable_text_iface(focused);
      AtspiText *view = atspi_accessible_get_text_iface(focused);
      check(editable && view, "The focused app does not expose editable text. "
                              "Literal typing is unavailable.");
      int offset = atspi_text_get_caret_offset(view, NULL);
      check(offset >= 0, "Cannot identify text caret.");
      int selections = atspi_text_get_n_selections(view, NULL);
      check(selections <= 1, "Multiple text selections are not supported.");
      if (selections == 1) {
        AtspiRange *range = atspi_text_get_selection(view, 0, NULL);
        check(range && range->start_offset >= 0 &&
                  range->end_offset >= range->start_offset,
              "Cannot identify selected text.");
        offset = range->start_offset;
        input_check(bounds);
        check(atspi_editable_text_delete_text(editable, range->start_offset,
                                              range->end_offset, NULL),
              "The app refused to replace selected text. Inspect before "
              "retrying.");
        g_free(range);
      }
      input_check(bounds);
      check(atspi_editable_text_insert_text(editable, offset, text,
                                            strlen(text), NULL),
            "The app refused literal text insertion. Inspect before retrying.");
      input_check(bounds);
      check(atspi_text_set_caret_offset(view, offset + g_utf8_strlen(text, -1),
                                        NULL),
            "Text was inserted but the caret could not be updated. Inspect "
            "before further input.");
      g_object_unref(editable);
      g_object_unref(view);
      g_object_unref(focused);
}

static void operate(const char *action) {
  guard_check();
  Bounds bounds;
  check(identity(&bounds),
        "Selected window identity changed or became unavailable.");
  check(foreground(),
        "Selected window lost focus. Wait for the human to Resume.");
  JsonObject *result = json_object_new();
  if (!strcmp(action, "snapshot")) {
    AtspiAccessible *window = accessible_window(bounds);
    JsonArray *nodes = json_array_new();
    tree(window, nodes, 0, bounds, g_get_monotonic_time() + 8 * G_USEC_PER_SEC,
         NULL, FALSE);
    g_object_unref(window);
    json_object_set_array_member(result, "controls", nodes);
    json_object_set_object_member(result, "bounds", bounds_json(bounds));
  } else if (!strcmp(action, "screenshot")) {
    screenshot(bounds);
    json_object_set_object_member(result, "bounds", bounds_json(bounds));
  } else if (!strcmp(action, "focus")) {
    focus_selected();
    json_object_set_string_member(result, "status", "focused");
  } else {
    JsonObject *prior = object(request, "bounds");
    check(same_bounds(bounds, (Bounds){number(prior, "x"), number(prior, "y"),
                                       number(prior, "width"),
                                       number(prior, "height")}),
          "Window moved or resized. Take a new snapshot.");
    check(!held_input(),
          "Release keyboard keys and mouse buttons before input.");
    input_check(bounds);
    if (!strcmp(action, "click") || !strcmp(action, "scroll")) {
      int x, y;
      point(bounds, &x, &y);
      input_check(bounds);
      check(XTestFakeMotionEvent(display, DefaultScreen(display), x, y,
                                 CurrentTime),
            "Cannot position pointer.");
      XSync(display, False);
      input_check(bounds);
      point(bounds, &x, &y);
      int count = !strcmp(action, "click") ? 1 : (int)number(request, "wheel");
      check(count && abs(count) <= 10, "Invalid scroll input.");
      unsigned int button = !strcmp(action, "click") ? 1 : count > 0 ? 4 : 5;
      for (int i = 0; i < abs(count); i++) {
        input_check(bounds);
        XTestFakeButtonEvent(display, button, True, CurrentTime);
        XTestFakeButtonEvent(display, button, False, CurrentTime);
        XSync(display, False);
      }
    } else if (!strcmp(action, "type")) {
      type_literal(bounds);
    } else if (!strcmp(action, "press")) {
      AtspiAccessible *focused = focused_control(bounds);
      g_object_unref(focused);
      const char *key = string(request, "key");
      KeySym symbol = NoSymbol, modifier = NoSymbol;
      const char *names[] = {"Tab",       "Enter",      "Escape",  "Space",
                             "Backspace", "Delete",     "ArrowUp", "ArrowDown",
                             "ArrowLeft", "ArrowRight", "Home",    "End",
                             "PageUp",    "PageDown"};
      KeySym symbols[] = {XK_Tab,       XK_Return,   XK_Escape, XK_space,
                          XK_BackSpace, XK_Delete,   XK_Up,     XK_Down,
                          XK_Left,      XK_Right,    XK_Home,   XK_End,
                          XK_Page_Up,   XK_Page_Down};
      for (unsigned int i = 0; i < G_N_ELEMENTS(names); i++)
        if (!strcmp(key, names[i]))
          symbol = symbols[i];
      if (!strcmp(key, "Shift+Tab")) {
        symbol = XK_Tab;
        modifier = XK_Shift_L;
      }
      if (g_str_has_prefix(key, "Control+") && strlen(key) == 9 &&
          strchr("aszy", key[8])) {
        symbol = key[8];
        modifier = XK_Control_L;
      }
      KeyCode code = XKeysymToKeycode(display, symbol),
              mod = modifier == NoSymbol ? 0
                                         : XKeysymToKeycode(display, modifier);
      check(symbol != NoSymbol && code && (modifier == NoSymbol || mod),
            "Unsupported key or keyboard mapping.");
      input_check(bounds);
      if (mod)
        XTestFakeKeyEvent(display, mod, True, CurrentTime);
      XTestFakeKeyEvent(display, code, True, CurrentTime);
      XTestFakeKeyEvent(display, code, False, CurrentTime);
      if (mod)
        XTestFakeKeyEvent(display, mod, False, CurrentTime);
      XSync(display, False);
    } else
      fail("Unsupported desktop action.");
    check(x_ok(), "Input failed. Inspect the window before retrying; partial "
                  "input may have occurred.");
    json_object_set_string_member(result, "status", "sent");
  }
  output(result);
}

static void save_state(void) {
  char *start = process_start(getpid());
  check(start != NULL, "Cannot identify indicator process.");
  char *text = g_strdup_printf(
      "%s|%" G_GUINT64_FORMAT "|%" G_GINT64_FORMAT "|%d|%s|%s", status, epoch,
      g_get_real_time() / 1000, getpid(), start, reason);
  check(g_file_set_contents(state_file, text, -1, NULL),
        "Cannot update indicator state.");
  g_free(text);
  g_free(start);
  if (label) {
    char *title =
        !strcmp(status, "active")
            ? g_strdup("Jackalope controls this window · Esc to cancel")
            : g_strdup_printf("Paused · %s", reason);
    gtk_label_set_text(GTK_LABEL(label), title);
    gtk_button_set_label(GTK_BUTTON(toggle),
                         !strcmp(status, "active") ? "Pause" : "Resume");
    g_free(title);
  }
}
static void pause_control(const char *message) {
  if (resume_source) {
    g_source_remove(resume_source);
    resume_source = 0;
  }
  if (!strcmp(status, "active")) {
    status = "paused";
    reason = message;
    epoch++;
    save_state();
  }
}
static void cancel_control(void) {
  status = "canceled";
  reason = "Canceled by the user";
  epoch++;
  save_state();
  gtk_main_quit();
}
static gboolean resume_control(gpointer unused) {
  (void)unused;
  resume_source = 0;
  Bounds bounds;
  if (identity(&bounds) && foreground() && !held_input()) {
    previous = bounds;
    status = "active";
    reason = "";
    epoch++;
  } else
    reason = "Select the window and release held keys";
  save_state();
  return G_SOURCE_REMOVE;
}
static void toggle_control(void) {
  if (!strcmp(status, "active")) {
    pause_control("Paused by the user");
    return;
  }
  if (resume_source)
    return;
  resume_after = gtk_get_current_event_time();
  focus_selected();
  resume_source = g_timeout_add(250, resume_control, NULL);
}
static gboolean synthetic(int source) {
  for (guint i = 0; i < synthetic_devices->len; i++)
    if (g_array_index(synthetic_devices, int, i) == source)
      return TRUE;
  return FALSE;
}
static gboolean xwayland_server(Display *probe) {
  int opcode, event, error;
  if (XQueryExtension(probe, "XWAYLAND", &opcode, &event, &error))
    return TRUE;
  if (!XQueryExtension(probe, "XInputExtension", &opcode, &event, &error))
    return TRUE;
  int count;
  XIDeviceInfo *devices = XIQueryDevice(probe, XIAllDevices, &count);
  if (!devices)
    return TRUE;
  gboolean found = FALSE;
  for (int i = 0; i < count; i++)
    if (g_ascii_strncasecmp(devices[i].name, "xwayland", 8) == 0)
      found = TRUE;
  XIFreeDeviceInfo(devices);
  return found;
}
static void update_devices(void) {
  g_array_set_size(synthetic_devices, 0);
  int count;
  XIDeviceInfo *devices = XIQueryDevice(display, XIAllDevices, &count);
  check(devices && x_ok(), "Input device inventory is unavailable.");
  for (int i = 0; i < count; i++) {
    check(g_ascii_strncasecmp(devices[i].name, "xwayland", 8) != 0,
          "XWayland cannot monitor physical input across a Wayland desktop.");
    if (strstr(devices[i].name, "XTEST"))
      g_array_append_val(synthetic_devices, devices[i].deviceid);
  }
  XIFreeDeviceInfo(devices);
  check(synthetic_devices->len >= 2, "XTEST input devices are unavailable.");
}
static void input_events(void) {
  while (XPending(display)) {
    XEvent event;
    XNextEvent(display, &event);
    if (event.type != GenericEvent || event.xcookie.extension != xi_opcode ||
        !XGetEventData(display, &event.xcookie))
      continue;
    if (event.xcookie.evtype == XI_HierarchyChanged) {
      pause_control("Input devices changed");
      update_devices();
    } else {
      XIRawEvent *raw = event.xcookie.data;
      if (!synthetic(raw->sourceid)) {
        if (resume_source && (gint32)(raw->time - resume_after) <= 0) {
          XFreeEventData(display, &event.xcookie);
          continue;
        }
        if (event.xcookie.evtype == XI_RawKeyPress &&
            raw->detail == XKeysymToKeycode(display, XK_Escape))
          cancel_control();
        else
          pause_control("Physical input detected");
      }
    }
    XFreeEventData(display, &event.xcookie);
  }
}
static gboolean input_ready(gint fd, GIOCondition condition, gpointer unused) {
  (void)fd;
  (void)unused;
  if (condition & (G_IO_ERR | G_IO_HUP | G_IO_NVAL)) {
    cancel_control();
    return G_SOURCE_REMOVE;
  }
  input_events();
  return G_SOURCE_CONTINUE;
}
static gboolean monitor(gpointer unused) {
  (void)unused;
  input_events();
  Bounds bounds;
  if (getppid() != parent || !gtk_widget_get_visible(bar)) {
    cancel_control();
    return G_SOURCE_REMOVE;
  }
  if (!identity(&bounds))
    pause_control("Window identity changed or closed");
  else if (!strcmp(status, "active") &&
           (!same_bounds(bounds, previous) || !foreground()))
    pause_control("Window moved, resized or lost focus");
  char *theme = NULL;
  if (g_file_get_contents(string(request, "theme"), &theme, NULL, NULL) &&
      strlen(theme) == 7 && theme[0] == '#' &&
      strspn(theme + 1, "0123456789abcdefABCDEF") == 6 &&
      g_strcmp0(theme, previous_theme)) {
    char *css = g_strdup_printf(
        "window { background: #000; color: #fff; border-bottom: 3px solid %s; "
        "} label { color: #fff; } button { color: #000; background: #fff; } "
        "button:focus { outline: 2px solid %s; }",
        theme, theme);
    gtk_css_provider_load_from_data(style, css, -1, NULL);
    g_free(css);
    g_free(previous_theme);
    previous_theme = g_strdup(theme);
  }
  g_free(theme);
  save_state();
  return G_SOURCE_CONTINUE;
}
static void indicator(void) {
  state_file = string(request, "file");
  parent = getppid();
  check(gtk_init_check(NULL, NULL), "Cannot open native indicator.");
  int event, error, major = 2, minor = 0;
  check(
      XQueryExtension(display, "XInputExtension", &xi_opcode, &event, &error) &&
          XIQueryVersion(display, &major, &minor) == Success,
      "XInput2 physical-input monitoring is required.");
  synthetic_devices = g_array_new(FALSE, FALSE, sizeof(int));
  update_devices();
  unsigned char raw_mask[XIMaskLen(XI_LASTEVENT)] = {0},
                hierarchy[XIMaskLen(XI_LASTEVENT)] = {0};
  XISetMask(raw_mask, XI_RawKeyPress);
  XISetMask(raw_mask, XI_RawKeyRelease);
  XISetMask(raw_mask, XI_RawButtonPress);
  XISetMask(raw_mask, XI_RawButtonRelease);
  XISetMask(raw_mask, XI_RawMotion);
  XISetMask(hierarchy, XI_HierarchyChanged);
  XIEventMask masks[] = {{XIAllMasterDevices, sizeof(raw_mask), raw_mask},
                         {XIAllDevices, sizeof(hierarchy), hierarchy}};
  check(XISelectEvents(display, root, masks, 2) == Success && x_ok(),
        "Cannot monitor physical input.");
  bar = gtk_window_new(GTK_WINDOW_TOPLEVEL);
  style = gtk_css_provider_new();
  gtk_style_context_add_provider_for_screen(
      gdk_screen_get_default(), GTK_STYLE_PROVIDER(style),
      GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
  gtk_window_set_title(GTK_WINDOW(bar), "Jackalope window control");
  gtk_window_set_decorated(GTK_WINDOW(bar), FALSE);
  gtk_window_set_keep_above(GTK_WINDOW(bar), TRUE);
  gtk_window_set_skip_taskbar_hint(GTK_WINDOW(bar), TRUE);
  gtk_window_set_skip_pager_hint(GTK_WINDOW(bar), TRUE);
  gtk_window_set_accept_focus(GTK_WINDOW(bar), TRUE);
  gtk_window_set_focus_on_map(GTK_WINDOW(bar), FALSE);
  gtk_window_set_type_hint(GTK_WINDOW(bar), GDK_WINDOW_TYPE_HINT_DOCK);
  GtkWidget *box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 12);
  gtk_container_set_border_width(GTK_CONTAINER(box), 12);
  label = gtk_label_new("");
  gtk_label_set_ellipsize(GTK_LABEL(label), PANGO_ELLIPSIZE_END);
  gtk_widget_set_size_request(label, 335, -1);
  toggle = gtk_button_new_with_label("Resume");
  GtkWidget *cancel = gtk_button_new_with_label("Cancel");
  gtk_box_pack_start(GTK_BOX(box), label, TRUE, TRUE, 0);
  gtk_box_pack_start(GTK_BOX(box), toggle, FALSE, FALSE, 0);
  gtk_box_pack_start(GTK_BOX(box), cancel, FALSE, FALSE, 0);
  gtk_container_add(GTK_CONTAINER(bar), box);
  g_signal_connect(toggle, "clicked", G_CALLBACK(toggle_control), NULL);
  g_signal_connect(cancel, "clicked", G_CALLBACK(cancel_control), NULL);
  g_signal_connect(bar, "destroy", G_CALLBACK(cancel_control), NULL);
  Bounds bounds;
  check(identity(&bounds), "Selected window is unavailable.");
  GdkMonitor *screen = gdk_display_get_monitor_at_point(
      gdk_display_get_default(), bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2);
  GdkRectangle area;
  gdk_monitor_get_workarea(screen, &area);
  gtk_window_move(GTK_WINDOW(bar), area.x + MAX(0, (area.width - 560) / 2),
                  area.y);
  gtk_widget_show_all(bar);
  save_state();
  g_unix_fd_add(ConnectionNumber(display),
                G_IO_IN | G_IO_ERR | G_IO_HUP | G_IO_NVAL, input_ready, NULL);
  g_timeout_add(100, monitor, NULL);
  gtk_main();
}

#include "linux-wayland.h"

int main(void) {
  const char *raw = g_getenv("JACKALOPE_DESKTOP_REQUEST");
  check(raw && strlen(raw) <= 128000, "Invalid desktop helper request.");
  JsonParser *parser = json_parser_new();
  check(json_parser_load_from_data(parser, raw, -1, NULL) &&
            JSON_NODE_HOLDS_OBJECT(json_parser_get_root(parser)),
        "Invalid desktop helper JSON.");
  request = json_node_get_object(json_parser_get_root(parser));
  const char *action = string(request, "action");
  gboolean wayland =
      g_strcmp0(g_getenv("XDG_SESSION_TYPE"), "wayland") == 0 ||
      (g_getenv("WAYLAND_DISPLAY") && *g_getenv("WAYLAND_DISPLAY"));
  if (wayland) {
    wayland_backend = TRUE;
    return wayland_main(action);
  }
  if (!strcmp(action, "permissions")) {
    gboolean available = FALSE;
    Display *probe = wayland ? NULL : XOpenDisplay(NULL);
    if (probe) {
      int event, error, opcode, major = 2, minor = 0, composite_major,
                                composite_minor;
      available =
          !xwayland_server(probe) &&
          XTestQueryExtension(probe, &event, &error, &composite_major,
                              &composite_minor) &&
          XQueryExtension(probe, "XInputExtension", &opcode, &event, &error) &&
          XIQueryVersion(probe, &major, &minor) == Success &&
          XCompositeQueryVersion(probe, &composite_major, &composite_minor) &&
          (composite_major > 0 || composite_minor >= 2) && atspi_init() == 0;
      XCloseDisplay(probe);
    }
    JsonObject *result = json_object_new();
    json_object_set_string_member(result, "session",
                                  wayland ? "wayland" : "x11");
    json_object_set_boolean_member(result, "available", available);
    output(result);
    return 0;
  }
  check(
      !wayland,
      "Guarded desktop control requires an X11 session. Wayland physical-input "
      "monitoring is not implemented; use task browser automation separately.");
  display = XOpenDisplay(NULL);
  check(display != NULL, "Cannot connect to the X11 desktop.");
  root = DefaultRootWindow(display);
  XSetErrorHandler(x_error);
  int event, error, major, minor;
  check(!xwayland_server(display),
        "XWayland cannot monitor physical input across a Wayland desktop. Use "
        "an X11 session.");
  check(XTestQueryExtension(display, &event, &error, &major, &minor),
        "XTEST input support is unavailable.");
  if (!strcmp(action, "list"))
    list_windows();
  else {
    JsonObject *window = object(request, "window");
    selected = g_ascii_strtoull(string(window, "handle"), NULL, 10);
    selected_pid = number(window, "pid");
    selected_start = g_strdup(string(window, "started"));
    selected_class = g_strdup(string(window, "class"));
    check(selected && selected_pid > 0 && *selected_start && *selected_class,
          "Invalid selected-window identity.");
    if (!strcmp(action, "indicator"))
      indicator();
    else
      operate(action);
  }
  XCloseDisplay(display);
  g_object_unref(parser);
  return 0;
}
