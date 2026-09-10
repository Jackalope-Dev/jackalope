static GDBusConnection *wayland_bus;
static char *wayland_token;

static JsonObject *wayland_call(JsonObject *payload, GError **error) {
  if (!wayland_bus)
    wayland_bus = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, error);
  if (!wayland_bus)
    return NULL;
  JsonNode *node = json_node_new(JSON_NODE_OBJECT);
  json_node_set_object(node, payload);
  char *raw = json_to_string(node, FALSE);
  GVariant *reply = g_dbus_connection_call_sync(
      wayland_bus, "org.gnome.Shell", "/org/jackalope/DesktopControl",
      "org.jackalope.DesktopControl1", "Call", g_variant_new("(s)", raw),
      G_VARIANT_TYPE("(s)"), G_DBUS_CALL_FLAGS_NO_AUTO_START, 10000, NULL, error);
  g_free(raw);
  json_node_free(node);
  if (!reply)
    return NULL;
  const char *text;
  g_variant_get(reply, "(&s)", &text);
  JsonParser *parser = json_parser_new();
  JsonObject *result = NULL;
  if (strlen(text) <= 12 * 1024 * 1024 &&
      json_parser_load_from_data(parser, text, -1, error) &&
      JSON_NODE_HOLDS_OBJECT(json_parser_get_root(parser)))
    result = json_object_ref(json_node_get_object(json_parser_get_root(parser)));
  g_object_unref(parser);
  g_variant_unref(reply);
  return result;
}

static JsonObject *wayland_send(JsonObject *payload) {
  GError *error = NULL;
  JsonObject *result = wayland_call(payload, &error);
  if (!result) {
    char *message = g_strdup_printf("GNOME window control failed: %.1000s",
        error ? error->message : "invalid bridge response");
    fail(message);
  }
  return result;
}

static Bounds wayland_bounds(JsonObject *value) {
  JsonObject *bounds = object(value, "bounds");
  gint64 x = number(bounds, "x"), y = number(bounds, "y"),
         w = number(bounds, "width"), h = number(bounds, "height");
  check(x >= G_MININT && x <= G_MAXINT && y >= G_MININT && y <= G_MAXINT &&
            w > 0 && w <= G_MAXINT && h > 0 && h <= G_MAXINT && w * h <= 20000000,
        "Invalid GNOME window bounds.");
  return (Bounds){x, y, w, h};
}

static JsonObject *wayland_payload(const char *action) {
  JsonNode *node = json_node_new(JSON_NODE_OBJECT);
  json_node_set_object(node, request);
  char *raw = json_to_string(node, FALSE);
  JsonParser *parser = json_parser_new();
  check(json_parser_load_from_data(parser, raw, -1, NULL), "Invalid desktop request.");
  JsonObject *value = json_object_ref(json_node_get_object(json_parser_get_root(parser)));
  json_object_set_string_member(value, "action", action);
  if (wayland_token)
    json_object_set_string_member(value, "token", wayland_token);
  if (json_object_has_member(request, "guard"))
    json_object_set_int_member(value, "epoch", number(object(request, "guard"), "epoch"));
  g_object_unref(parser);
  g_free(raw);
  json_node_free(node);
  return value;
}

static JsonObject *wayland_action(const char *action) {
  JsonObject *payload = wayland_payload(action);
  JsonObject *result = wayland_send(payload);
  json_object_unref(payload);
  return result;
}

static void wayland_input_check(Bounds expected) {
  guard_check();
  JsonObject *current = wayland_action("check");
  check(same_bounds(expected, wayland_bounds(current)),
        "Window moved or resized. Take a fresh snapshot.");
  char *started = process_start(selected_pid);
  check(started && !strcmp(started, selected_start), "The selected process changed.");
  g_free(started);
  json_object_unref(current);
}

static void wayland_save_state(JsonObject *value) {
  const char *state = string(value, "status");
  check(!strcmp(state, "active") || !strcmp(state, "paused") || !strcmp(state, "canceled"),
        "Invalid GNOME indicator state.");
  char *started = process_start(getpid());
  check(started != NULL, "Indicator identity is unavailable.");
  char *why = g_strndup(string(value, "reason"), 200);
  for (char *p = why; *p; p++)
    if (*p == '|' || *p == '\n' || *p == '\r') *p = ' ';
  char *text = g_strdup_printf("%s|%lld|%lld|%d|%s|%s", state,
      (long long)number(value, "epoch"), (long long)(g_get_real_time() / 1000),
      getpid(), started, why);
  check(g_file_set_contents(state_file, text, -1, NULL), "Cannot save indicator state.");
  g_free(text);
  g_free(why);
  g_free(started);
}

static int wayland_indicator(void) {
  state_file = string(request, "file");
  char *directory = g_path_get_dirname(state_file);
  struct stat attrs;
  check(lstat(directory, &attrs) == 0 && S_ISDIR(attrs.st_mode) &&
            attrs.st_uid == geteuid() && (attrs.st_mode & 077) == 0,
        "The indicator directory must be private.");
  char *cookie = g_build_filename(directory, "wayland-token", NULL);
  parent = getppid();
  JsonObject *state = wayland_action("begin");
  wayland_token = g_strdup(string(state, "token"));
  check(strlen(wayland_token) == 72, "Invalid compositor grant token.");
  check(g_file_set_contents(cookie, wayland_token, -1, NULL) && chmod(cookie, 0600) == 0,
        "Cannot save compositor grant token.");
  while (getppid() == parent) {
    wayland_save_state(state);
    gboolean canceled = !strcmp(string(state, "status"), "canceled");
    json_object_unref(state);
    if (canceled)
      break;
    g_usleep(100000);
    JsonObject *payload = wayland_payload("state");
    char *accent = NULL;
    gsize size;
    if (g_file_get_contents(string(request, "theme"), &accent, &size, NULL) && size == 7)
      json_object_set_string_member(payload, "accent", accent);
    g_free(accent);
    state = wayland_send(payload);
    json_object_unref(payload);
  }
  g_dbus_connection_close_sync(wayland_bus, NULL, NULL);
  g_free(cookie);
  g_free(directory);
  return 0;
}

static int wayland_main(const char *action) {
  if (!strcmp(action, "permissions")) {
    GError *error = NULL;
    JsonObject *result = wayland_call(request, &error);
    if (!result) {
      result = json_object_new();
      json_object_set_boolean_member(result, "available", FALSE);
      json_object_set_string_member(result, "session", "wayland");
      json_object_set_string_member(result, "message",
          "Enable the Jackalope Window Control extension in GNOME 46, then refresh. Other Wayland compositors are not supported.");
      g_clear_error(&error);
    }
    output(result);
    return 0;
  }
  if (!strcmp(action, "list")) {
    JsonObject *result = wayland_action("list");
    output(result);
    return 0;
  }
  if (!strcmp(action, "indicator"))
    return wayland_indicator();
  JsonObject *window = object(request, "window");
  selected_pid = number(window, "pid");
  selected_start = g_strdup(string(window, "started"));
  char *directory = g_path_get_dirname(string(object(request, "guard"), "file"));
  char *cookie = g_build_filename(directory, "wayland-token", NULL);
  struct stat attrs;
  gsize size;
  check(lstat(cookie, &attrs) == 0 && S_ISREG(attrs.st_mode) && attrs.st_uid == geteuid() &&
            (attrs.st_mode & 077) == 0 && attrs.st_nlink == 1 &&
            g_file_get_contents(cookie, &wayland_token, &size, NULL) && size == 72,
        "GNOME desktop grant is unavailable.");
  guard_check();
  wayland_info = wayland_action("check");
  Bounds bounds = wayland_bounds(wayland_info);
  wayland_input_check(bounds);
  JsonObject *result = json_object_new();
  if (!strcmp(action, "snapshot")) {
    AtspiAccessible *accessible = accessible_window(bounds);
    JsonArray *nodes = json_array_new();
    tree(accessible, nodes, 0, bounds, g_get_monotonic_time() + 8 * G_USEC_PER_SEC, NULL, FALSE);
    g_object_unref(accessible);
    wayland_input_check(bounds);
    json_object_set_array_member(result, "controls", nodes);
    json_object_set_object_member(result, "bounds", bounds_json(bounds));
  } else if (!strcmp(action, "type")) {
    type_literal(bounds);
    json_object_set_string_member(result, "status", "sent");
  } else {
    if (!strcmp(action, "press")) {
      AtspiAccessible *focused = focused_control(bounds);
      g_object_unref(focused);
      wayland_input_check(bounds);
    }
    json_object_unref(result);
    result = wayland_action(action);
    if (!strcmp(action, "screenshot")) {
      const char *encoded = string(result, "png");
      check(*encoded && strlen(encoded) <= 12 * 1024 * 1024, "Invalid window capture.");
      gsize length;
      guchar *png = g_base64_decode(encoded, &length);
      check(length > 8 && length <= 8 * 1024 * 1024 && !memcmp(png, "\x89PNG\r\n\x1a\n", 8),
            "Invalid window PNG.");
      wayland_input_check(bounds);
      GFile *file = g_file_new_for_path(string(request, "path"));
      GFileOutputStream *stream = g_file_create(file, G_FILE_CREATE_PRIVATE, NULL, NULL);
      check(stream != NULL, "Cannot create selected-window screenshot.");
      check(g_output_stream_write_all(G_OUTPUT_STREAM(stream), png, length, NULL, NULL, NULL) &&
                g_output_stream_close(G_OUTPUT_STREAM(stream), NULL, NULL), "Cannot save selected-window screenshot.");
      g_object_unref(stream);
      g_object_unref(file);
      g_free(png);
      json_object_remove_member(result, "png");
    }
  }
  output(result);
  return 0;
}
