#include <adwaita.h>
#include <gtk/gtk.h>
#include <json-glib/json-glib.h>
#include <libsoup/soup.h>
#include <webkit/webkit.h>

#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

#ifndef DSC_VERSION
#define DSC_VERSION "dev"
#endif

#ifndef DSC_RELEASE_CHANNEL
#define DSC_RELEASE_CHANNEL "test"
#endif

#define APP_ID "org.igng.DeviceStateConsole"
#define SERVICE_NAME "device-state-console-agent-backend.service"
#define BACKEND_PORT "17891"
#define BUNDLE_ROOT "/usr/lib/device-state-console"

typedef struct _DscApp DscApp;

typedef enum {
    REQUEST_STATE,
    REQUEST_SAVE_CONFIG,
    REQUEST_CHECK_CONNECTION,
    REQUEST_START,
    REQUEST_STOP,
    REQUEST_DETECT,
    REQUEST_PUSH,
    REQUEST_UPDATE_CHECK,
    REQUEST_UPDATE_DOWNLOAD,
} RequestKind;

typedef struct {
    DscApp *app;
    SoupMessage *message;
    RequestKind kind;
} ApiRequest;

struct _DscApp {
    AdwApplication *application;
    AdwApplicationWindow *window;
    GtkStack *stack;
    GtkTextBuffer *diagnostics_buffer;
    GtkWidget *hub_status;
    WebKitWebView *web_view;

    AdwEntryRow *server_row;
    AdwPasswordEntryRow *secret_row;
    AdwEntryRow *device_row;
    AdwEntryRow *hostname_row;
    GtkSpinButton *normal_interval;
    GtkSpinButton *slow_interval;
    AdwSwitchRow *recording_row;
    AdwSwitchRow *cloud_sync_row;
    AdwSwitchRow *auto_restart_row;
    AdwSwitchRow *auto_start_row;

    GtkLabel *backend_value;
    GtkLabel *collector_value;
    GtkLabel *connection_value;
    GtkLabel *pending_value;
    GtkLabel *detect_value;
    GtkLabel *notice_label;
    GtkLabel *update_label;
    GtkProgressBar *update_progress;
    GtkWidget *update_button;

    SoupSession *session;
    JsonObject *config;
    gboolean form_initialized;
    gboolean web_login_started;
    gboolean using_user_service;

    GSubprocess *fallback_backend;
    guint poll_source;
    gchar *bundle_root;
    gchar *config_root;
    gchar *backend_path;
    gchar *collector_path;
    gchar *update_asset_url;
    gchar *update_sha256;
    gchar *update_version;
    gchar *update_package_path;
    GSubprocess *update_installer;
    guint update_pulse_source;
    gboolean update_check_started;
};

static void refresh_state(DscApp *app);
static void start_backend_fallback(DscApp *app);
static void on_save_clicked(GtkButton *button, gpointer data);
static void check_for_update(DscApp *app);
static void api_request_finished(GObject *source, GAsyncResult *result, gpointer user_data);
static void run_systemctl(DscApp *app, const gchar *action);

static void set_label(GtkLabel *label, const gchar *text)
{
    if (label != NULL) {
        gtk_label_set_text(label, text != NULL ? text : "");
    }
}

static void set_notice(DscApp *app, const gchar *text, gboolean error)
{
    if (app->notice_label == NULL) {
        return;
    }
    set_label(app->notice_label, text);
    if (error) {
        gtk_widget_add_css_class(GTK_WIDGET(app->notice_label), "error");
    } else {
        gtk_widget_remove_css_class(GTK_WIDGET(app->notice_label), "error");
    }
}

static const gchar *object_string(JsonObject *object, const gchar *member, const gchar *fallback)
{
    if (object == NULL || !json_object_has_member(object, member)) {
        return fallback;
    }
    JsonNode *node = json_object_get_member(object, member);
    if (node == NULL || JSON_NODE_HOLDS_NULL(node)) {
        return fallback;
    }
    const gchar *value = json_object_get_string_member(object, member);
    return value != NULL ? value : fallback;
}

static gboolean object_boolean(JsonObject *object, const gchar *member, gboolean fallback)
{
    if (object == NULL || !json_object_has_member(object, member)) {
        return fallback;
    }
    return json_object_get_boolean_member(object, member);
}

static gint object_int(JsonObject *object, const gchar *member, gint fallback)
{
    if (object == NULL || !json_object_has_member(object, member)) {
        return fallback;
    }
    return (gint)json_object_get_int_member(object, member);
}

static JsonObject *ensure_object_member(JsonObject *parent, const gchar *member)
{
    JsonObject *child = json_object_get_object_member(parent, member);
    if (child == NULL) {
        child = json_object_new();
        json_object_set_object_member(parent, member, child);
    }
    return child;
}

static gchar *quote_json_string(const gchar *value)
{
    JsonNode *node = json_node_new(JSON_NODE_VALUE);
    JsonGenerator *generator = json_generator_new();
    json_node_set_string(node, value != NULL ? value : "");
    json_generator_set_root(generator, node);
    gchar *result = json_generator_to_data(generator, NULL);
    g_object_unref(generator);
    json_node_free(node);
    return result;
}

static void set_entry_text(AdwEntryRow *row, const gchar *value)
{
    gtk_editable_set_text(GTK_EDITABLE(row), value != NULL ? value : "");
}

static const gchar *entry_text(AdwEntryRow *row)
{
    return gtk_editable_get_text(GTK_EDITABLE(row));
}

static AdwEntryRow *create_entry_row(AdwPreferencesGroup *group, const gchar *title, const gchar *subtitle)
{
    AdwEntryRow *row = ADW_ENTRY_ROW(adw_entry_row_new());
    adw_preferences_row_set_title(ADW_PREFERENCES_ROW(row), title);
    if (subtitle != NULL) {
        gtk_widget_set_tooltip_text(GTK_WIDGET(row), subtitle);
    }
    adw_preferences_group_add(group, GTK_WIDGET(row));
    return row;
}

static AdwPasswordEntryRow *create_password_row(AdwPreferencesGroup *group, const gchar *title, const gchar *subtitle)
{
    AdwPasswordEntryRow *row = ADW_PASSWORD_ENTRY_ROW(adw_password_entry_row_new());
    adw_preferences_row_set_title(ADW_PREFERENCES_ROW(row), title);
    if (subtitle != NULL) {
        gtk_widget_set_tooltip_text(GTK_WIDGET(row), subtitle);
    }
    adw_preferences_group_add(group, GTK_WIDGET(row));
    return row;
}

static GtkSpinButton *create_spin_row(AdwPreferencesGroup *group, const gchar *title, const gchar *subtitle)
{
    AdwActionRow *row = ADW_ACTION_ROW(adw_action_row_new());
    GtkSpinButton *spin = GTK_SPIN_BUTTON(gtk_spin_button_new_with_range(5, 3600, 5));
    adw_preferences_row_set_title(ADW_PREFERENCES_ROW(row), title);
    adw_action_row_set_subtitle(row, subtitle);
    gtk_widget_set_valign(GTK_WIDGET(spin), GTK_ALIGN_CENTER);
    gtk_spin_button_set_numeric(spin, TRUE);
    adw_action_row_add_suffix(row, GTK_WIDGET(spin));
    adw_preferences_group_add(group, GTK_WIDGET(row));
    return spin;
}

static AdwSwitchRow *create_switch_row(AdwPreferencesGroup *group, const gchar *title, const gchar *subtitle)
{
    AdwSwitchRow *row = ADW_SWITCH_ROW(adw_switch_row_new());
    adw_preferences_row_set_title(ADW_PREFERENCES_ROW(row), title);
    adw_action_row_set_subtitle(ADW_ACTION_ROW(row), subtitle);
    adw_preferences_group_add(group, GTK_WIDGET(row));
    return row;
}

static GtkLabel *create_status_row(AdwPreferencesGroup *group, const gchar *title, const gchar *subtitle)
{
    AdwActionRow *row = ADW_ACTION_ROW(adw_action_row_new());
    GtkLabel *value = GTK_LABEL(gtk_label_new("等待中"));
    adw_preferences_row_set_title(ADW_PREFERENCES_ROW(row), title);
    adw_action_row_set_subtitle(row, subtitle);
    gtk_widget_add_css_class(GTK_WIDGET(value), "dim-label");
    gtk_widget_set_halign(GTK_WIDGET(value), GTK_ALIGN_END);
    adw_action_row_add_suffix(row, GTK_WIDGET(value));
    adw_preferences_group_add(group, GTK_WIDGET(row));
    return value;
}

static GtkWidget *create_button(const gchar *label, GCallback callback, DscApp *app, gboolean suggested)
{
    GtkButton *button = GTK_BUTTON(gtk_button_new_with_label(label));
    if (suggested) {
        gtk_widget_add_css_class(GTK_WIDGET(button), "suggested-action");
    }
    g_signal_connect(button, "clicked", callback, app);
    return GTK_WIDGET(button);
}

static void api_request_free(ApiRequest *request)
{
    if (request == NULL) {
        return;
    }
    g_clear_object(&request->message);
    g_free(request);
}

static void apply_config_to_form(DscApp *app)
{
    if (app->config == NULL) {
        return;
    }

    JsonObject *connection = json_object_get_object_member(app->config, "connection");
    JsonObject *sampling = json_object_get_object_member(app->config, "sampling");
    set_entry_text(app->server_row, object_string(connection, "serverUrl", ""));
    set_entry_text(ADW_ENTRY_ROW(app->secret_row), object_string(connection, "secret", ""));
    set_entry_text(app->device_row, object_string(connection, "deviceId", ""));
    set_entry_text(app->hostname_row, object_string(connection, "hostname", ""));
    gtk_spin_button_set_value(app->normal_interval, object_int(sampling, "normalIntervalSeconds", 30));
    gtk_spin_button_set_value(app->slow_interval, object_int(sampling, "slowIntervalSeconds", 30));
    adw_switch_row_set_active(app->recording_row, object_boolean(app->config, "dataRecordingEnabled", TRUE));
    adw_switch_row_set_active(app->cloud_sync_row, object_boolean(app->config, "cloudSyncEnabled", TRUE));
    adw_switch_row_set_active(app->auto_restart_row, object_boolean(app->config, "autoRestartCollector", TRUE));
    adw_switch_row_set_active(app->auto_start_row, object_boolean(app->config, "autoStartCollector", FALSE));
    app->form_initialized = TRUE;
}

static void update_config_from_form(DscApp *app)
{
    if (app->config == NULL) {
        app->config = json_object_new();
    }

    JsonObject *connection = ensure_object_member(app->config, "connection");
    JsonObject *sampling = ensure_object_member(app->config, "sampling");
    json_object_set_string_member(connection, "serverUrl", entry_text(app->server_row));
    json_object_set_string_member(connection, "secret", gtk_editable_get_text(GTK_EDITABLE(app->secret_row)));
    json_object_set_string_member(connection, "deviceId", entry_text(app->device_row));
    json_object_set_string_member(connection, "hostname", entry_text(app->hostname_row));
    json_object_set_int_member(sampling, "normalIntervalSeconds", gtk_spin_button_get_value_as_int(app->normal_interval));
    json_object_set_int_member(sampling, "slowIntervalSeconds", gtk_spin_button_get_value_as_int(app->slow_interval));
    json_object_set_boolean_member(app->config, "dataRecordingEnabled", adw_switch_row_get_active(app->recording_row));
    json_object_set_boolean_member(app->config, "cloudSyncEnabled", adw_switch_row_get_active(app->cloud_sync_row));
    json_object_set_boolean_member(app->config, "autoRestartCollector", adw_switch_row_get_active(app->auto_restart_row));
    json_object_set_boolean_member(app->config, "autoStartCollector", adw_switch_row_get_active(app->auto_start_row));
}

static gchar *serialize_config(DscApp *app)
{
    JsonNode *root = json_node_new(JSON_NODE_OBJECT);
    JsonGenerator *generator = json_generator_new();
    json_node_take_object(root, json_object_ref(app->config));
    json_generator_set_root(generator, root);
    gchar *data = json_generator_to_data(generator, NULL);
    g_object_unref(generator);
    json_node_free(root);
    return data;
}

static void update_diagnostics(DscApp *app, JsonObject *state)
{
    const gchar *path = object_string(state, "diagnosticsPath", "");
    if (path == NULL || *path == '\0') {
        return;
    }

    gchar *contents = NULL;
    gsize length = 0;
    GError *error = NULL;
    if (!g_file_get_contents(path, &contents, &length, &error)) {
        g_clear_error(&error);
        return;
    }
    gtk_text_buffer_set_text(app->diagnostics_buffer, contents, (gint)length);
    g_free(contents);
}

static void apply_state(DscApp *app, JsonObject *state)
{
    gboolean running = object_boolean(state, "running", FALSE);
    const gchar *connection = object_string(state, "connectionStatus", "stopped");
    gboolean pending = object_boolean(state, "cloudConfigPending", FALSE);
    const gchar *lastIssue = object_string(state, "lastIssueDetail", "");
    const gchar *lastLog = object_string(state, "lastChildLog", "");

    set_label(app->backend_value, "在线");
    set_label(app->collector_value, running ? "采集器运行中" : "采集器未启动");
    set_label(app->connection_value, connection);
    set_label(app->pending_value, pending ? "有待推送配置" : "已同步");
    if (lastIssue != NULL && *lastIssue != '\0') {
        set_notice(app, lastIssue, TRUE);
    } else if (lastLog != NULL && *lastLog != '\0') {
        set_notice(app, lastLog, FALSE);
    } else {
        set_notice(app, "本地 backend 已准备就绪。", FALSE);
    }
    update_diagnostics(app, state);

    JsonObject *stateConfig = json_object_get_object_member(state, "config");
    if (stateConfig != NULL && !app->form_initialized) {
        g_clear_pointer(&app->config, json_object_unref);
        app->config = json_object_ref(stateConfig);
        apply_config_to_form(app);
        if (!app->update_check_started) {
            app->update_check_started = TRUE;
            check_for_update(app);
        }
    }
}

static void handle_detect_response(DscApp *app, JsonObject *body)
{
    JsonArray *targets = json_object_get_array_member(body, "detectedTargets");
    guint targetCount = targets != NULL ? json_array_get_length(targets) : 0;
    guint instanceCount = 0;
    GString *summary = g_string_new(NULL);
    for (guint index = 0; targets != NULL && index < targetCount; index++) {
        JsonObject *target = json_array_get_object_element(targets, index);
        const gchar *label = object_string(target, "label", "组件");
        JsonArray *instances = json_object_get_array_member(target, "instances");
        guint count = instances != NULL ? json_array_get_length(instances) : 0;
        instanceCount += count;
        if (count > 0) {
            if (summary->len > 0) {
                g_string_append(summary, " · ");
            }
            g_string_append_printf(summary, "%s %u", label, count);
        }
    }
    if (summary->len == 0) {
        g_string_append(summary, "没有发现可配置实例");
    }
    gchar *text = g_strdup_printf("已发现 %u 个组件、%u 个实例：%s", targetCount, instanceCount, summary->str);
    set_label(app->detect_value, text);
    g_free(text);
    g_string_free(summary, TRUE);
}

static gboolean pulse_update_progress(gpointer data)
{
    DscApp *app = data;
    if (app->update_progress != NULL) {
        gtk_progress_bar_pulse(app->update_progress);
    }
    return G_SOURCE_CONTINUE;
}

static void stop_update_progress(DscApp *app)
{
    if (app->update_pulse_source != 0) {
        g_source_remove(app->update_pulse_source);
        app->update_pulse_source = 0;
    }
    if (app->update_progress != NULL) {
        gtk_progress_bar_set_fraction(app->update_progress, 0.0);
        gtk_progress_bar_set_text(app->update_progress, "");
    }
}

static void handle_update_check_response(DscApp *app, JsonObject *body)
{
    const gboolean available = object_boolean(body, "available", FALSE);
    const gchar *version = object_string(body, "latestVersion", NULL);
    const gchar *asset = object_string(body, "assetUrl", NULL);
    const gchar *sha256 = object_string(body, "sha256", NULL);

    g_clear_pointer(&app->update_asset_url, g_free);
    g_clear_pointer(&app->update_sha256, g_free);
    g_clear_pointer(&app->update_version, g_free);
    app->update_asset_url = asset != NULL ? g_strdup(asset) : NULL;
    app->update_sha256 = sha256 != NULL ? g_strdup(sha256) : NULL;
    app->update_version = version != NULL ? g_strdup(version) : NULL;

    if (!available || app->update_asset_url == NULL || app->update_version == NULL) {
        set_label(app->update_label, "当前已是最新版本。\nLinux GUI 通过系统软件包授权完成安装。\n");
        gtk_button_set_label(GTK_BUTTON(app->update_button), "检查更新");
        gtk_widget_set_sensitive(app->update_button, TRUE);
        return;
    }

    gchar *text = g_strdup_printf("发现 v%s，可下载并使用系统安装器更新。", app->update_version);
    set_label(app->update_label, text);
    g_free(text);
    gtk_button_set_label(GTK_BUTTON(app->update_button), "下载并安装");
    gtk_widget_set_sensitive(app->update_button, TRUE);
}

static void update_install_finished(GObject *source, GAsyncResult *result, gpointer user_data)
{
    DscApp *app = user_data;
    GSubprocess *process = G_SUBPROCESS(source);
    GError *error = NULL;
    const gboolean completed = g_subprocess_wait_finish(process, result, &error);
    const gboolean successful = completed && g_subprocess_get_successful(process);
    stop_update_progress(app);
    gtk_widget_set_sensitive(app->update_button, TRUE);
    if (successful) {
        run_systemctl(app, "restart");
        set_label(app->update_label, "安装程序已完成。请重新启动 Linux GUI 以载入新版本。\n");
        set_notice(app, "Linux GUI 更新完成。", FALSE);
        gtk_button_set_label(GTK_BUTTON(app->update_button), "重新检查");
    } else {
        set_notice(app, error != NULL ? error->message : "系统安装器执行失败。", TRUE);
        gtk_button_set_label(GTK_BUTTON(app->update_button), "重试安装");
    }
    g_clear_error(&error);
    if (app->update_installer == process) {
        app->update_installer = NULL;
    }
    g_object_unref(process);
}

static void launch_update_installer(DscApp *app)
{
    gchar *pkexec = g_find_program_in_path("pkexec");
    if (pkexec == NULL) {
        gchar *gio = g_find_program_in_path("gio");
        if (gio == NULL) {
            set_notice(app, "系统中没有 pkexec 或 gio，无法打开 Linux 安装包。", TRUE);
            return;
        }
        GError *error = NULL;
        app->update_installer = g_subprocess_new(
            G_SUBPROCESS_FLAGS_NONE,
            &error,
            gio,
            "open",
            app->update_package_path,
            NULL);
        g_free(gio);
        if (app->update_installer == NULL) {
            set_notice(app, error != NULL ? error->message : "无法打开 Linux 安装包。", TRUE);
            g_clear_error(&error);
            return;
        }
        set_notice(app, "已打开系统软件安装器，请完成授权。", FALSE);
        g_subprocess_wait_async(app->update_installer, NULL, update_install_finished, app);
        return;
    }

    GError *error = NULL;
    app->update_installer = g_subprocess_new(
        G_SUBPROCESS_FLAGS_NONE,
        &error,
        pkexec,
        "dpkg",
        "--install",
        app->update_package_path,
        NULL);
    g_free(pkexec);
    if (app->update_installer == NULL) {
        set_notice(app, error != NULL ? error->message : "无法启动系统安装器。", TRUE);
        g_clear_error(&error);
        return;
    }
    set_notice(app, "正在等待系统安装器授权…", FALSE);
    g_subprocess_wait_async(app->update_installer, NULL, update_install_finished, app);
}

static void handle_update_download(DscApp *app, GBytes *bytes)
{
    stop_update_progress(app);
    if (bytes == NULL || app->update_version == NULL) {
        set_notice(app, "更新安装包下载为空。", TRUE);
        gtk_widget_set_sensitive(app->update_button, TRUE);
        return;
    }

    gsize length = 0;
    const guint8 *data = g_bytes_get_data(bytes, &length);
    gchar *digest = g_compute_checksum_for_data(G_CHECKSUM_SHA256, data, length);
    if (app->update_sha256 == NULL || g_ascii_strcasecmp(digest, app->update_sha256) != 0) {
        set_notice(app, "更新安装包校验失败，已阻止安装。", TRUE);
        g_free(digest);
        gtk_widget_set_sensitive(app->update_button, TRUE);
        return;
    }
    g_free(digest);

    gchar *cache_dir = g_build_filename(g_get_user_cache_dir(), "device-state-console", NULL);
    g_mkdir_with_parents(cache_dir, 0700);
    g_clear_pointer(&app->update_package_path, g_free);
    app->update_package_path = g_build_filename(cache_dir, "device-state-console-update.deb", NULL);
    g_free(cache_dir);
    GError *error = NULL;
    if (!g_file_set_contents(app->update_package_path, (const gchar *)data, (gssize)length, &error)) {
        set_notice(app, error != NULL ? error->message : "无法保存更新安装包。", TRUE);
        g_clear_error(&error);
        gtk_widget_set_sensitive(app->update_button, TRUE);
        return;
    }

    set_label(app->update_label, "下载完成，正在启动系统安装器…");
    launch_update_installer(app);
}

static void on_update_button_clicked(GtkButton *button, gpointer data)
{
    (void)button;
    DscApp *app = data;
    if (app->update_asset_url == NULL) {
        check_for_update(app);
        return;
    }

    gtk_widget_set_sensitive(app->update_button, FALSE);
    set_label(app->update_label, "正在下载更新安装包…");
    gtk_progress_bar_set_pulse_step(app->update_progress, 0.08);
    gtk_progress_bar_set_show_text(app->update_progress, FALSE);
    app->update_pulse_source = g_timeout_add(120, pulse_update_progress, app);

    SoupMessage *message = soup_message_new("GET", app->update_asset_url);
    if (message == NULL) {
        stop_update_progress(app);
        gtk_widget_set_sensitive(app->update_button, TRUE);
        set_notice(app, "无法创建更新下载请求。", TRUE);
        return;
    }
    ApiRequest *request = g_new0(ApiRequest, 1);
    request->app = app;
    request->message = g_object_ref(message);
    request->kind = REQUEST_UPDATE_DOWNLOAD;
    soup_session_send_and_read_async(app->session, message, G_PRIORITY_DEFAULT, NULL, api_request_finished, request);
    g_object_unref(message);
}

static void check_for_update(DscApp *app)
{
    const gchar *server = entry_text(app->server_row);
    if (server == NULL || *server == '\0') {
        set_label(app->update_label, "请先填写中枢地址。\n");
        return;
    }
    gchar *base = g_strdup(server);
    while (g_str_has_suffix(base, "/")) {
        base[strlen(base) - 1] = '\0';
    }
    gchar *encoded_version = g_uri_escape_string(DSC_VERSION, NULL, FALSE);
    gchar *url = g_strdup_printf(
        "%s/api/updates?platform=linux-gui&currentVersion=%s&currentChannel=%s&arch=amd64",
        base,
        encoded_version,
        DSC_RELEASE_CHANNEL);
    g_free(base);
    g_free(encoded_version);
    SoupMessage *message = soup_message_new("GET", url);
    g_free(url);
    if (message == NULL) {
        set_notice(app, "无法创建更新检查请求。", TRUE);
        return;
    }
    gtk_widget_set_sensitive(app->update_button, FALSE);
    set_label(app->update_label, "正在检查更新…");
    ApiRequest *request = g_new0(ApiRequest, 1);
    request->app = app;
    request->message = g_object_ref(message);
    request->kind = REQUEST_UPDATE_CHECK;
    soup_session_send_and_read_async(app->session, message, G_PRIORITY_DEFAULT, NULL, api_request_finished, request);
    g_object_unref(message);
}

static void api_request_finished(GObject *source, GAsyncResult *result, gpointer user_data)
{
    ApiRequest *request = user_data;
    DscApp *app = request->app;
    GError *error = NULL;
    GBytes *bytes = soup_session_send_and_read_finish(SOUP_SESSION(source), result, &error);
    guint status = soup_message_get_status(request->message);

    if (error != NULL) {
        set_notice(app, error->message, TRUE);
        g_clear_error(&error);
        if (request->kind == REQUEST_STATE) {
            set_label(app->backend_value, "不可达");
        }
        if (request->kind == REQUEST_UPDATE_CHECK) {
            gtk_widget_set_sensitive(app->update_button, TRUE);
            set_label(app->update_label, "更新检查失败，请稍后重试。\n");
        } else if (request->kind == REQUEST_UPDATE_DOWNLOAD) {
            stop_update_progress(app);
            gtk_widget_set_sensitive(app->update_button, TRUE);
        }
        if (bytes != NULL) {
            g_bytes_unref(bytes);
        }
        api_request_free(request);
        return;
    }

    if (request->kind == REQUEST_UPDATE_DOWNLOAD) {
        if (status >= 400) {
            set_notice(app, "更新安装包下载失败。", TRUE);
            stop_update_progress(app);
            gtk_widget_set_sensitive(app->update_button, TRUE);
        } else {
            handle_update_download(app, bytes);
        }
        if (bytes != NULL) {
            g_bytes_unref(bytes);
        }
        api_request_free(request);
        return;
    }

    gsize length = 0;
    const gchar *raw = bytes != NULL ? g_bytes_get_data(bytes, &length) : NULL;
    JsonParser *parser = NULL;
    JsonObject *body = NULL;
    if (raw != NULL && length > 0) {
        parser = json_parser_new();
        if (json_parser_load_from_data(parser, raw, (gssize)length, &error)) {
            JsonNode *root = json_parser_get_root(parser);
            if (root != NULL && JSON_NODE_HOLDS_OBJECT(root)) {
                body = json_node_get_object(root);
            }
        }
    }

    if (status >= 400) {
        const gchar *message = body != NULL ? object_string(body, "message", NULL) : NULL;
        const gchar *apiError = body != NULL ? object_string(body, "error", NULL) : NULL;
        set_notice(app, message != NULL ? message : (apiError != NULL ? apiError : "本地操作失败。"), TRUE);
        if (request->kind == REQUEST_UPDATE_CHECK) {
            gtk_widget_set_sensitive(app->update_button, TRUE);
            set_label(app->update_label, "更新检查失败，请稍后重试。\n");
        }
    } else if (request->kind == REQUEST_STATE && body != NULL) {
        apply_state(app, body);
    } else if (request->kind == REQUEST_DETECT && body != NULL) {
        handle_detect_response(app, body);
        set_notice(app, "硬件探测完成。", FALSE);
    } else if (request->kind == REQUEST_CHECK_CONNECTION && body != NULL) {
        set_notice(app, object_string(body, "message", "连接检查完成。"), !object_boolean(body, "ok", FALSE));
    } else if (request->kind == REQUEST_UPDATE_CHECK && body != NULL) {
        handle_update_check_response(app, body);
    } else if (request->kind == REQUEST_SAVE_CONFIG) {
        set_notice(app, "配置已保存。", FALSE);
    } else {
        set_notice(app, "操作已完成。", FALSE);
    }

    if (request->kind != REQUEST_STATE) {
        refresh_state(app);
    }
    if (parser != NULL) {
        g_object_unref(parser);
    }
    if (bytes != NULL) {
        g_bytes_unref(bytes);
    }
    g_clear_error(&error);
    api_request_free(request);
}

static void send_api_request(DscApp *app, const gchar *method, const gchar *path, const gchar *body, RequestKind kind)
{
    gchar *url = g_strdup_printf("http://127.0.0.1:%s%s", BACKEND_PORT, path);
    SoupMessage *message = soup_message_new(method, url);
    g_free(url);
    if (message == NULL) {
        set_notice(app, "无法创建本地请求。", TRUE);
        return;
    }

    if (body != NULL) {
        GBytes *bytes = g_bytes_new(body, strlen(body));
        soup_message_set_request_body_from_bytes(message, "application/json", bytes);
        g_bytes_unref(bytes);
    }

    ApiRequest *request = g_new0(ApiRequest, 1);
    request->app = app;
    request->message = g_object_ref(message);
    request->kind = kind;
    soup_session_send_and_read_async(app->session, message, G_PRIORITY_DEFAULT, NULL, api_request_finished, request);
    g_object_unref(message);
}

static void refresh_state(DscApp *app)
{
    send_api_request(app, "GET", "/api/state", NULL, REQUEST_STATE);
}

static void systemctl_ignore_finished(GObject *source, GAsyncResult *result, gpointer user_data)
{
    (void)user_data;
    GError *error = NULL;
    g_subprocess_wait_finish(G_SUBPROCESS(source), result, &error);
    g_clear_error(&error);
    g_object_unref(source);
}

static void run_systemctl(DscApp *app, const gchar *action)
{
    gchar *systemctl = g_find_program_in_path("systemctl");
    if (systemctl == NULL) {
        return;
    }
    GError *error = NULL;
    GSubprocess *process = g_subprocess_new(
        G_SUBPROCESS_FLAGS_STDOUT_SILENCE | G_SUBPROCESS_FLAGS_STDERR_SILENCE,
        &error,
        systemctl,
        "--user",
        action,
        SERVICE_NAME,
        NULL);
    if (process != NULL) {
        g_subprocess_wait_async(process, NULL, systemctl_ignore_finished, NULL);
    }
    g_clear_error(&error);
    g_free(systemctl);
}

static void systemctl_start_finished(GObject *source, GAsyncResult *result, gpointer user_data)
{
    DscApp *app = user_data;
    GSubprocess *process = G_SUBPROCESS(source);
    GError *error = NULL;
    gboolean completed = g_subprocess_wait_finish(process, result, &error);
    if (!completed || !g_subprocess_get_successful(process)) {
        g_clear_error(&error);
        start_backend_fallback(app);
        g_object_unref(process);
        return;
    }
    app->using_user_service = TRUE;
    set_label(app->backend_value, "启动中");
    refresh_state(app);
    g_object_unref(process);
}

static void start_backend_service(DscApp *app)
{
    gchar *systemctl = g_find_program_in_path("systemctl");
    if (systemctl == NULL) {
        start_backend_fallback(app);
        return;
    }

    GError *error = NULL;
    GSubprocess *process = g_subprocess_new(
        G_SUBPROCESS_FLAGS_STDOUT_SILENCE | G_SUBPROCESS_FLAGS_STDERR_SILENCE,
        &error,
        systemctl,
        "--user",
        "start",
        SERVICE_NAME,
        NULL);
    g_free(systemctl);
    if (process == NULL) {
        g_clear_error(&error);
        start_backend_fallback(app);
        return;
    }
    g_subprocess_wait_async(process, NULL, systemctl_start_finished, app);
}

static void start_backend_fallback(DscApp *app)
{
    if (app->fallback_backend != NULL) {
        return;
    }

    gchar *pid = g_strdup_printf("%d", (gint)getpid());
    const gchar *argv[] = {
        app->backend_path,
        "--bundle-root", app->bundle_root,
        "--config-root", app->config_root,
        "--child-binary", app->collector_path,
        "--parent-pid", pid,
        NULL,
    };
    GSubprocessLauncher *launcher = g_subprocess_launcher_new(
        G_SUBPROCESS_FLAGS_STDOUT_SILENCE | G_SUBPROCESS_FLAGS_STDERR_SILENCE);
    g_subprocess_launcher_set_cwd(launcher, app->bundle_root);
    GError *error = NULL;
    app->fallback_backend = g_subprocess_launcher_spawnv(launcher, argv, &error);
    g_object_unref(launcher);
    g_free(pid);
    if (app->fallback_backend == NULL) {
        set_notice(app, error != NULL ? error->message : "无法启动本地 backend。", TRUE);
        g_clear_error(&error);
        return;
    }
    app->using_user_service = FALSE;
    set_label(app->backend_value, "启动中");
    refresh_state(app);
}

static void start_backend(DscApp *app)
{
    g_mkdir_with_parents(app->config_root, 0700);
    start_backend_service(app);
}

static void on_save_clicked(GtkButton *button, gpointer data)
{
    (void)button;
    DscApp *app = data;
    update_config_from_form(app);
    gchar *body = serialize_config(app);
    send_api_request(app, "PUT", "/api/config", body, REQUEST_SAVE_CONFIG);
    if (adw_switch_row_get_active(app->auto_start_row)) {
        run_systemctl(app, "enable");
    } else {
        run_systemctl(app, "disable");
    }
    g_free(body);
}

static void on_check_connection_clicked(GtkButton *button, gpointer data)
{
    (void)button;
    DscApp *app = data;
    update_config_from_form(app);
    gchar *body = serialize_config(app);
    send_api_request(app, "PUT", "/api/config", body, REQUEST_SAVE_CONFIG);
    send_api_request(app, "POST", "/api/control/check-connection", NULL, REQUEST_CHECK_CONNECTION);
    g_free(body);
}

static void on_start_clicked(GtkButton *button, gpointer data)
{
    (void)button;
    DscApp *app = data;
    send_api_request(app, "POST", "/api/control/start", NULL, REQUEST_START);
}

static void on_stop_clicked(GtkButton *button, gpointer data)
{
    (void)button;
    DscApp *app = data;
    send_api_request(app, "POST", "/api/control/stop", NULL, REQUEST_STOP);
}

static void on_detect_clicked(GtkButton *button, gpointer data)
{
    (void)button;
    DscApp *app = data;
    send_api_request(app, "POST", "/api/probes/detect", NULL, REQUEST_DETECT);
}

static void on_push_clicked(GtkButton *button, gpointer data)
{
    (void)button;
    DscApp *app = data;
    send_api_request(app, "POST", "/api/cloud/push", NULL, REQUEST_PUSH);
}

static void on_back_to_agent_clicked(GtkButton *button, gpointer data)
{
    (void)button;
    DscApp *app = data;
    gtk_stack_set_visible_child_name(app->stack, "agent");
}

static void on_open_hub_clicked(GtkButton *button, gpointer data)
{
    (void)button;
    DscApp *app = data;
    const gchar *server = entry_text(app->server_row);
    if (server == NULL || *server == '\0' ||
        (!g_str_has_prefix(server, "http://") && !g_str_has_prefix(server, "https://"))) {
        set_notice(app, "请先填写有效的中枢地址。", TRUE);
        return;
    }

    app->web_login_started = FALSE;
    gtk_stack_set_visible_child_name(app->stack, "hub");
    set_label(GTK_LABEL(app->hub_status), "正在打开中枢网页…");
    webkit_web_view_load_uri(app->web_view, server);
}

static void on_web_load_changed(WebKitWebView *web_view, WebKitLoadEvent event, gpointer data)
{
    (void)web_view;
    DscApp *app = data;
    if (event == WEBKIT_LOAD_STARTED) {
        set_label(GTK_LABEL(app->hub_status), "正在加载中枢网页…");
        return;
    }
    if (event != WEBKIT_LOAD_FINISHED) {
        return;
    }

    set_label(GTK_LABEL(app->hub_status), "中枢网页已加载");
    if (app->web_login_started) {
        return;
    }
    const gchar *secret = gtk_editable_get_text(GTK_EDITABLE(app->secret_row));
    if (secret == NULL || *secret == '\0') {
        return;
    }

    gchar *quoted = quote_json_string(secret);
    gchar *script = g_strdup_printf(
        "(async()=>{const r=await fetch('/api/auth/login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({accessKey:%s})});if(!r.ok)throw new Error(String(r.status));location.reload();})().catch(()=>{});",
        quoted);
    app->web_login_started = TRUE;
    webkit_web_view_evaluate_javascript(app->web_view, script, -1, NULL, NULL, NULL, NULL, NULL);
    g_free(script);
    g_free(quoted);
}

static gboolean poll_backend(gpointer data)
{
    DscApp *app = data;
    refresh_state(app);
    if (app->fallback_backend != NULL && g_subprocess_get_if_exited(app->fallback_backend)) {
        set_label(app->backend_value, "已退出");
    }
    return G_SOURCE_CONTINUE;
}

static void on_window_close(GtkWindow *window, gpointer data)
{
    (void)window;
    DscApp *app = data;
    if (app->fallback_backend != NULL && !g_subprocess_get_if_exited(app->fallback_backend)) {
        g_subprocess_force_exit(app->fallback_backend);
    }
}

static GtkWidget *build_agent_page(DscApp *app)
{
    GtkScrolledWindow *scrolled = GTK_SCROLLED_WINDOW(gtk_scrolled_window_new());
    GtkBox *page = GTK_BOX(gtk_box_new(GTK_ORIENTATION_VERTICAL, 24));
    gtk_widget_set_margin_top(GTK_WIDGET(page), 28);
    gtk_widget_set_margin_bottom(GTK_WIDGET(page), 32);
    gtk_widget_set_margin_start(GTK_WIDGET(page), 32);
    gtk_widget_set_margin_end(GTK_WIDGET(page), 32);
    gtk_widget_set_size_request(GTK_WIDGET(page), 640, -1);

    GtkLabel *heading = GTK_LABEL(gtk_label_new("本机 Agent"));
    gtk_widget_add_css_class(GTK_WIDGET(heading), "title-1");
    gtk_widget_set_halign(GTK_WIDGET(heading), GTK_ALIGN_START);
    gtk_box_append(page, GTK_WIDGET(heading));

    GtkLabel *description = GTK_LABEL(gtk_label_new("配置本机采集器，并在需要时打开中枢网页查看实例和历史数据。"));
    gtk_label_set_wrap(description, TRUE);
    gtk_widget_add_css_class(GTK_WIDGET(description), "dim-label");
    gtk_widget_set_halign(GTK_WIDGET(description), GTK_ALIGN_START);
    gtk_box_append(page, GTK_WIDGET(description));

    AdwPreferencesGroup *connection = ADW_PREFERENCES_GROUP(adw_preferences_group_new());
    adw_preferences_group_set_title(connection, "中枢连接");
    adw_preferences_group_set_description(connection, "公网地址必须使用 HTTPS；局域网和本机地址可以使用 HTTP。密钥只保存在本机配置目录。\n");
    app->server_row = create_entry_row(connection, "中枢地址", "例如 https://console.example.com 或 http://192.168.1.20:3100");
    app->secret_row = create_password_row(connection, "Agent Secret", "与中枢的 AGENT_SHARED_SECRET 一致");
    app->device_row = create_entry_row(connection, "设备 ID", "显示在中枢设备列表中的稳定标识");
    app->hostname_row = create_entry_row(connection, "设备名称", "显示名称，默认使用系统 hostname");
    gtk_box_append(page, GTK_WIDGET(connection));

    AdwPreferencesGroup *sampling = ADW_PREFERENCES_GROUP(adw_preferences_group_new());
    adw_preferences_group_set_title(sampling, "采集策略");
    adw_preferences_group_set_description(sampling, "本机 Agent 使用 Go collector 读取 CPU、内存、磁盘、网络和可用的 Linux 传感器。");
    app->normal_interval = create_spin_row(sampling, "常规上报频率", "秒");
    app->slow_interval = create_spin_row(sampling, "硬件详情刷新频率", "秒");
    app->recording_row = create_switch_row(sampling, "启用数据采集", "关闭后不会继续向中枢上报本机指标。");
    app->cloud_sync_row = create_switch_row(sampling, "允许同步展示配置", "允许把实例和指标选择推送到中枢。");
    app->auto_restart_row = create_switch_row(sampling, "采集器异常自动恢复", "collector 退出后由本地 backend 自动重启。");
    app->auto_start_row = create_switch_row(sampling, "登录后自动采集", "使用 systemd user service 在桌面登录后自动启动。");
    gtk_box_append(page, GTK_WIDGET(sampling));

    GtkBox *buttons = GTK_BOX(gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 8));
    gtk_widget_set_halign(GTK_WIDGET(buttons), GTK_ALIGN_START);
    gtk_box_append(buttons, create_button("保存配置", G_CALLBACK(on_save_clicked), app, TRUE));
    gtk_box_append(buttons, create_button("检查中枢连接", G_CALLBACK(on_check_connection_clicked), app, FALSE));
    gtk_box_append(buttons, create_button("打开中枢网页", G_CALLBACK(on_open_hub_clicked), app, FALSE));
    gtk_box_append(page, GTK_WIDGET(buttons));

    AdwPreferencesGroup *updates = ADW_PREFERENCES_GROUP(adw_preferences_group_new());
    adw_preferences_group_set_title(updates, "软件更新");
    adw_preferences_group_set_description(updates, "只接受严格高于当前版本的发布；下载后由系统安装器请求授权。\n");
    GtkBox *update_box = GTK_BOX(gtk_box_new(GTK_ORIENTATION_VERTICAL, 8));
    app->update_label = GTK_LABEL(gtk_label_new("尚未检查更新。\n"));
    gtk_label_set_wrap(app->update_label, TRUE);
    gtk_widget_set_halign(GTK_WIDGET(app->update_label), GTK_ALIGN_START);
    gtk_box_append(update_box, GTK_WIDGET(app->update_label));
    app->update_progress = GTK_PROGRESS_BAR(gtk_progress_bar_new());
    gtk_widget_set_hexpand(GTK_WIDGET(app->update_progress), TRUE);
    gtk_box_append(update_box, GTK_WIDGET(app->update_progress));
    app->update_button = create_button("检查更新", G_CALLBACK(on_update_button_clicked), app, FALSE);
    gtk_widget_set_halign(app->update_button, GTK_ALIGN_START);
    gtk_box_append(update_box, app->update_button);
    adw_preferences_group_add(updates, GTK_WIDGET(update_box));
    gtk_box_append(page, GTK_WIDGET(updates));

    AdwPreferencesGroup *status = ADW_PREFERENCES_GROUP(adw_preferences_group_new());
    adw_preferences_group_set_title(status, "运行状态");
    app->backend_value = create_status_row(status, "本地 backend", "管理配置、探测和 collector 生命周期");
    app->collector_value = create_status_row(status, "采集器", "当前本机指标采集进程");
    app->connection_value = create_status_row(status, "中枢连接", "最近一次上传或连接检查状态");
    app->pending_value = create_status_row(status, "云端展示配置", "实例和指标配置同步状态");
    gtk_box_append(page, GTK_WIDGET(status));

    GtkBox *collector_buttons = GTK_BOX(gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 8));
    gtk_widget_set_halign(GTK_WIDGET(collector_buttons), GTK_ALIGN_START);
    gtk_box_append(collector_buttons, create_button("启动采集器", G_CALLBACK(on_start_clicked), app, TRUE));
    gtk_box_append(collector_buttons, create_button("停止采集器", G_CALLBACK(on_stop_clicked), app, FALSE));
    gtk_box_append(collector_buttons, create_button("探测组件", G_CALLBACK(on_detect_clicked), app, FALSE));
    gtk_box_append(collector_buttons, create_button("推送展示配置", G_CALLBACK(on_push_clicked), app, FALSE));
    gtk_box_append(page, GTK_WIDGET(collector_buttons));

    app->detect_value = GTK_LABEL(gtk_label_new("尚未执行组件探测。"));
    gtk_label_set_wrap(app->detect_value, TRUE);
    gtk_widget_set_halign(GTK_WIDGET(app->detect_value), GTK_ALIGN_START);
    gtk_widget_add_css_class(GTK_WIDGET(app->detect_value), "dim-label");
    gtk_box_append(page, GTK_WIDGET(app->detect_value));

    app->notice_label = GTK_LABEL(gtk_label_new("正在启动本地 backend…"));
    gtk_label_set_wrap(app->notice_label, TRUE);
    gtk_widget_set_halign(GTK_WIDGET(app->notice_label), GTK_ALIGN_START);
    gtk_widget_add_css_class(GTK_WIDGET(app->notice_label), "dim-label");
    gtk_box_append(page, GTK_WIDGET(app->notice_label));

    gtk_scrolled_window_set_policy(scrolled, GTK_POLICY_NEVER, GTK_POLICY_AUTOMATIC);
    gtk_scrolled_window_set_child(scrolled, GTK_WIDGET(page));
    return GTK_WIDGET(scrolled);
}

static GtkWidget *build_hub_page(DscApp *app)
{
    GtkBox *page = GTK_BOX(gtk_box_new(GTK_ORIENTATION_VERTICAL, 0));
    GtkBox *toolbar = GTK_BOX(gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 8));
    gtk_widget_set_margin_top(GTK_WIDGET(toolbar), 8);
    gtk_widget_set_margin_bottom(GTK_WIDGET(toolbar), 8);
    gtk_widget_set_margin_start(GTK_WIDGET(toolbar), 12);
    gtk_widget_set_margin_end(GTK_WIDGET(toolbar), 12);
    gtk_box_append(toolbar, create_button("返回 Agent", G_CALLBACK(on_back_to_agent_clicked), app, FALSE));
    app->hub_status = gtk_label_new("等待打开中枢网页");
    gtk_widget_add_css_class(app->hub_status, "dim-label");
    gtk_widget_set_halign(app->hub_status, GTK_ALIGN_START);
    gtk_box_append(toolbar, app->hub_status);
    gtk_box_append(page, GTK_WIDGET(toolbar));

    app->web_view = WEBKIT_WEB_VIEW(webkit_web_view_new());
    WebKitSettings *settings = webkit_web_view_get_settings(app->web_view);
    webkit_settings_set_enable_developer_extras(settings, FALSE);
    g_signal_connect(app->web_view, "load-changed", G_CALLBACK(on_web_load_changed), app);
    gtk_widget_set_hexpand(GTK_WIDGET(app->web_view), TRUE);
    gtk_widget_set_vexpand(GTK_WIDGET(app->web_view), TRUE);
    gtk_box_append(page, GTK_WIDGET(app->web_view));
    return GTK_WIDGET(page);
}

static GtkWidget *build_diagnostics_page(DscApp *app)
{
    GtkBox *page = GTK_BOX(gtk_box_new(GTK_ORIENTATION_VERTICAL, 12));
    gtk_widget_set_margin_top(GTK_WIDGET(page), 24);
    gtk_widget_set_margin_bottom(GTK_WIDGET(page), 24);
    gtk_widget_set_margin_start(GTK_WIDGET(page), 24);
    gtk_widget_set_margin_end(GTK_WIDGET(page), 24);

    GtkLabel *heading = GTK_LABEL(gtk_label_new("诊断日志"));
    gtk_widget_add_css_class(GTK_WIDGET(heading), "title-2");
    gtk_widget_set_halign(GTK_WIDGET(heading), GTK_ALIGN_START);
    gtk_box_append(page, GTK_WIDGET(heading));

    GtkScrolledWindow *scrolled = GTK_SCROLLED_WINDOW(gtk_scrolled_window_new());
    GtkTextView *view = GTK_TEXT_VIEW(gtk_text_view_new());
    gtk_text_view_set_editable(view, FALSE);
    gtk_text_view_set_cursor_visible(view, FALSE);
    gtk_text_view_set_monospace(view, TRUE);
    gtk_text_view_set_wrap_mode(view, GTK_WRAP_WORD_CHAR);
    app->diagnostics_buffer = gtk_text_view_get_buffer(view);
    gtk_scrolled_window_set_child(scrolled, GTK_WIDGET(view));
    gtk_widget_set_vexpand(GTK_WIDGET(scrolled), TRUE);
    gtk_box_append(page, GTK_WIDGET(scrolled));

    GtkLabel *hint = GTK_LABEL(gtk_label_new("日志由本地 Go backend 写入用户配置目录。"));
    gtk_widget_add_css_class(GTK_WIDGET(hint), "dim-label");
    gtk_widget_set_halign(GTK_WIDGET(hint), GTK_ALIGN_START);
    gtk_box_append(page, GTK_WIDGET(hint));
    return GTK_WIDGET(page);
}

static void free_app(DscApp *app)
{
    if (app == NULL) {
        return;
    }
    if (app->poll_source != 0) {
        g_source_remove(app->poll_source);
    }
    if (app->update_pulse_source != 0) {
        g_source_remove(app->update_pulse_source);
    }
    if (app->update_installer != NULL && !g_subprocess_get_if_exited(app->update_installer)) {
        g_subprocess_force_exit(app->update_installer);
    }
    g_clear_object(&app->update_installer);
    if (app->fallback_backend != NULL) {
        if (!g_subprocess_get_if_exited(app->fallback_backend)) {
            g_subprocess_force_exit(app->fallback_backend);
        }
        g_clear_object(&app->fallback_backend);
    }
    g_clear_object(&app->session);
    g_clear_pointer(&app->config, json_object_unref);
    g_free(app->bundle_root);
    g_free(app->config_root);
    g_free(app->backend_path);
    g_free(app->collector_path);
    g_free(app->update_asset_url);
    g_free(app->update_sha256);
    g_free(app->update_version);
    g_free(app->update_package_path);
    g_free(app);
}

static void activate(GApplication *application, gpointer user_data)
{
    DscApp *app = user_data;
    if (app->window != NULL) {
        gtk_window_present(GTK_WINDOW(app->window));
        return;
    }

    app->application = ADW_APPLICATION(application);
    app->session = soup_session_new();

    app->bundle_root = g_strdup(g_getenv("DSC_GUI_BUNDLE_ROOT"));
    if (app->bundle_root == NULL || *app->bundle_root == '\0') {
        g_free(app->bundle_root);
        app->bundle_root = g_strdup(BUNDLE_ROOT);
    }
    app->config_root = g_build_filename(g_get_user_config_dir(), "device-state-console", NULL);
    app->backend_path = g_build_filename(app->bundle_root, "device-state-console-agent-backend", NULL);
    app->collector_path = g_build_filename(app->bundle_root, "device-state-console-agent", NULL);

    app->window = ADW_APPLICATION_WINDOW(adw_application_window_new(GTK_APPLICATION(application)));
    gtk_window_set_title(GTK_WINDOW(app->window), "观澜");
    gtk_window_set_default_size(GTK_WINDOW(app->window), 1120, 760);
    gtk_window_set_resizable(GTK_WINDOW(app->window), TRUE);
    g_signal_connect(app->window, "destroy", G_CALLBACK(on_window_close), app);

    GtkBox *root = GTK_BOX(gtk_box_new(GTK_ORIENTATION_VERTICAL, 0));
    AdwHeaderBar *header = ADW_HEADER_BAR(adw_header_bar_new());
    GtkLabel *title = GTK_LABEL(gtk_label_new("观澜"));
    gtk_widget_add_css_class(GTK_WIDGET(title), "title-2");
    adw_header_bar_set_title_widget(header, GTK_WIDGET(title));
    adw_header_bar_set_show_end_title_buttons(header, TRUE);
    adw_header_bar_set_show_start_title_buttons(header, TRUE);
    gtk_box_append(root, GTK_WIDGET(header));

    GtkBox *body = GTK_BOX(gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0));
    GtkStackSidebar *sidebar = GTK_STACK_SIDEBAR(gtk_stack_sidebar_new());
    gtk_widget_set_size_request(GTK_WIDGET(sidebar), 210, -1);
    gtk_widget_add_css_class(GTK_WIDGET(sidebar), "navigation-sidebar");
    gtk_box_append(body, GTK_WIDGET(sidebar));

    app->stack = GTK_STACK(gtk_stack_new());
    gtk_stack_set_transition_type(app->stack, GTK_STACK_TRANSITION_TYPE_CROSSFADE);
    gtk_widget_set_hexpand(GTK_WIDGET(app->stack), TRUE);
    gtk_widget_set_vexpand(GTK_WIDGET(app->stack), TRUE);
    gtk_stack_add_titled(app->stack, build_agent_page(app), "agent", "本机 Agent");
    gtk_stack_add_titled(app->stack, build_hub_page(app), "hub", "中枢网页");
    gtk_stack_add_titled(app->stack, build_diagnostics_page(app), "diagnostics", "诊断日志");
    gtk_stack_sidebar_set_stack(sidebar, app->stack);
    gtk_box_append(body, GTK_WIDGET(app->stack));
    gtk_box_append(root, GTK_WIDGET(body));

    adw_application_window_set_content(app->window, GTK_WIDGET(root));
    gtk_window_present(GTK_WINDOW(app->window));

    start_backend(app);
    app->poll_source = g_timeout_add_seconds(2, poll_backend, app);
}

int main(int argc, char **argv)
{
    AdwApplication *application = ADW_APPLICATION(adw_application_new(APP_ID, G_APPLICATION_DEFAULT_FLAGS));
    DscApp *app = g_new0(DscApp, 1);
    g_object_set_data_full(G_OBJECT(application), "dsc-app", app, (GDestroyNotify)free_app);
    g_signal_connect(application, "activate", G_CALLBACK(activate), app);
    int status = g_application_run(G_APPLICATION(application), argc, argv);
    g_object_unref(application);
    return status;
}
