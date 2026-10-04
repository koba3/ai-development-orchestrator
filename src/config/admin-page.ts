export const ADMIN_PAGE_HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Orchestrator 設定</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font: 15px/1.5 "Segoe UI", sans-serif; background: #f4f5f7; color: #1c1e21; }
    header, main { max-width: 980px; margin: 0 auto; padding: 24px; }
    header { padding-bottom: 0; }
    h1 { font-size: 1.5rem; margin: 0 0 8px; }
    h2 { font-size: 1.15rem; margin: 0; }
    p { margin: 0 0 12px; }
    section { background: #fff; border: 1px solid #d8dbe2; border-radius: 10px; padding: 16px; margin: 16px 0; }
    .row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 12px; }
    label { display: flex; flex-direction: column; gap: 4px; font-size: 0.85rem; }
    input[type="text"], input[type="password"] { font: inherit; padding: 8px; border: 1px solid #c5c9d2; border-radius: 6px; }
    fieldset { border: 1px solid #e3e6ec; border-radius: 8px; margin: 0 0 12px; }
    .actions { display: flex; gap: 8px; align-items: center; }
    button { font: inherit; padding: 8px 12px; border-radius: 6px; border: 1px solid #1f4fd8; background: #1f4fd8; color: #fff; cursor: pointer; }
    button.secondary { background: #fff; color: #1c1e21; border-color: #c5c9d2; }
    .muted { color: #5c6570; }
    .error { color: #9b1c1c; }
    .ok { color: #0f6b3a; }
    .check { flex-direction: row; align-items: center; }
    @media (max-width: 720px) { .row { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <h1>Orchestrator 設定</h1>
    <p class="muted">起動に必要な値は .env のままです。ここでは Slack 接続と Project を変更します。秘密情報は保存後に画面へ戻しません。</p>
  </header>
  <main>
    <section id="gate">
      <h2>管理者トークン</h2>
      <p class="muted">.env の ADMIN_TOKEN を入力します。このブラウザのタブを閉じるまでだけ保持します。</p>
      <div class="row">
        <label>ADMIN_TOKEN
          <input id="admin-token" type="password" autocomplete="off">
        </label>
      </div>
      <div class="actions">
        <button id="unlock" type="button">設定を開く</button>
        <span id="gate-status" class="error"></span>
      </div>
    </section>
    <div id="editor" hidden>
      <section>
        <h2>Slack</h2>
        <p class="muted">空のトークン欄は、同じ接続 ID の既存の値を残します。新しい接続では 3 つとも必要です。</p>
        <div id="slack-rows"></div>
        <div class="actions">
          <button id="add-slack" class="secondary" type="button">接続を追加</button>
          <button id="save-slack" type="button">Slack を保存</button>
          <span id="slack-status"></span>
        </div>
      </section>
      <section>
        <h2>Project</h2>
        <p class="muted">リポジトリは Project が持ちます。Hashtag は Workspace と Channel の組で Project に結びます。</p>
        <h3>Project</h3>
        <div id="project-rows"></div>
        <div class="actions">
          <button id="add-project" class="secondary" type="button">Project を追加</button>
        </div>
        <h3>Hashtag</h3>
        <div id="route-rows"></div>
        <div class="actions">
          <button id="add-route" class="secondary" type="button">Hashtag を追加</button>
          <button id="save-projects" type="button">Project を保存</button>
          <span id="project-status"></span>
        </div>
      </section>
    </div>
  </main>
  <script>
    const tokenKey = "orchestrator.adminToken";
    const gate = document.querySelector("#gate");
    const editor = document.querySelector("#editor");
    const gateStatus = document.querySelector("#gate-status");
    let slack = [];
    let projects = [];
    let routes = [];

    function token() {
      return sessionStorage.getItem(tokenKey) ?? "";
    }

    function field(labelText, value, onInput, type) {
      const label = document.createElement("label");
      label.append(document.createTextNode(labelText));
      const input = document.createElement("input");
      input.type = type || "text";
      input.value = value;
      input.autocomplete = "off";
      input.addEventListener("input", () => onInput(input.value));
      label.append(input);
      return label;
    }

    function removeButton(onClick) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary";
      button.textContent = "削除";
      button.addEventListener("click", onClick);
      return button;
    }

    function renderSlack() {
      const root = document.querySelector("#slack-rows");
      root.replaceChildren();
      slack.forEach((connection, index) => {
        const box = document.createElement("fieldset");
        const legend = document.createElement("legend");
        legend.textContent = connection.id || "新しい接続";
        box.append(legend);
        const grid = document.createElement("div");
        grid.className = "row";
        grid.append(
          field("接続 ID", connection.id, (value) => { connection.id = value; }),
          field("Workspace ID", connection.workspaceId, (value) => { connection.workspaceId = value; }),
          field("Channel ID（カンマ区切り。空ならボットが見る会話を受ける）", connection.channelIds.join(", "), (value) => {
            connection.channelIds = value.split(/[\\s,]+/).filter(Boolean);
          }),
        );
        const enabled = document.createElement("label");
        enabled.className = "check";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = connection.enabled;
        checkbox.addEventListener("change", () => { connection.enabled = checkbox.checked; });
        enabled.append(checkbox, document.createTextNode("有効"));
        grid.append(enabled);
        grid.append(
          field("Bot Token", "", (value) => { connection.botToken = value; }, "password"),
          field("App Token", "", (value) => { connection.appToken = value; }, "password"),
          field("Signing Secret", "", (value) => { connection.signingSecret = value; }, "password"),
        );
        const hint = document.createElement("p");
        hint.className = "muted";
        hint.textContent = connection.botTokenSet ? "秘密情報は保存済みです。変更する欄だけ入力してください。" : "新しい接続です。3 つの秘密情報が必要です。";
        box.append(grid, hint, removeButton(() => { slack.splice(index, 1); renderSlack(); }));
        root.append(box);
      });
    }

    function renderProjects() {
      const root = document.querySelector("#project-rows");
      root.replaceChildren();
      projects.forEach((project, index) => {
        const box = document.createElement("fieldset");
        const grid = document.createElement("div");
        grid.className = "row";
        grid.append(
          field("projectId", project.projectId, (value) => { project.projectId = value; }),
          field("名前", project.name, (value) => { project.name = value; }),
          field("localRepository", project.localRepository, (value) => { project.localRepository = value; }),
          field("remoteRepository", project.remoteRepository, (value) => { project.remoteRepository = value; }),
          field("repositoryMode", "local", () => {}, "text"),
        );
        grid.lastElementChild.querySelector("input").readOnly = true;
        box.append(grid, removeButton(() => { projects.splice(index, 1); renderProjects(); }));
        root.append(box);
      });
    }

    function renderRoutes() {
      const root = document.querySelector("#route-rows");
      root.replaceChildren();
      routes.forEach((route, index) => {
        const box = document.createElement("fieldset");
        const grid = document.createElement("div");
        grid.className = "row";
        grid.append(
          field("Workspace ID", route.workspaceId, (value) => { route.workspaceId = value; }),
          field("Workspace 名", route.workspaceName, (value) => { route.workspaceName = value; }),
          field("Channel ID", route.channelId, (value) => { route.channelId = value; }),
          field("Channel 名", route.channelName, (value) => { route.channelName = value; }),
          field("hashtag", route.hashtag, (value) => { route.hashtag = value; }),
          field("projectId", route.projectId, (value) => { route.projectId = value; }),
        );
        box.append(grid, removeButton(() => { routes.splice(index, 1); renderRoutes(); }));
        root.append(box);
      });
    }

    async function api(path, options) {
      const response = await fetch(path, {
        ...options,
        headers: {
          authorization: "Bearer " + token(),
          ...(options && options.headers ? options.headers : {}),
        },
      });
      const body = await response.json();
      if (response.status === 401) {
        sessionStorage.removeItem(tokenKey);
        showGate("管理者トークンが違います。");
        throw new Error("unauthorized");
      }
      if (!response.ok) {
        throw new Error(body.error || "保存に失敗しました");
      }
      return body;
    }

    function showGate(message) {
      gate.hidden = false;
      editor.hidden = true;
      gateStatus.textContent = message || "";
    }

    async function loadEditor() {
      const slackBody = await api("/api/config/slack");
      const projectBody = await api("/api/config/projects");
      slack = slackBody.connections.map((connection) => ({
        ...connection,
        botToken: "",
        appToken: "",
        signingSecret: "",
      }));
      projects = projectBody.projects;
      routes = projectBody.routes;
      renderSlack();
      renderProjects();
      renderRoutes();
      gate.hidden = true;
      editor.hidden = false;
    }

    document.querySelector("#unlock").addEventListener("click", async () => {
      sessionStorage.setItem(tokenKey, document.querySelector("#admin-token").value);
      gateStatus.textContent = "";
      try {
        await loadEditor();
      } catch (error) {
        if (error.message !== "unauthorized") gateStatus.textContent = error.message;
      }
    });

    document.querySelector("#add-slack").addEventListener("click", () => {
      slack.push({ id: "", workspaceId: "", channelIds: [], enabled: true, botToken: "", appToken: "", signingSecret: "", botTokenSet: false });
      renderSlack();
    });
    document.querySelector("#add-project").addEventListener("click", () => {
      projects.push({ projectId: "", name: "", localRepository: "", remoteRepository: "", repositoryMode: "local" });
      renderProjects();
    });
    document.querySelector("#add-route").addEventListener("click", () => {
      routes.push({ workspaceId: "", workspaceName: "", channelId: "", channelName: "", hashtag: "", projectId: "" });
      renderRoutes();
    });

    document.querySelector("#save-slack").addEventListener("click", async () => {
      const status = document.querySelector("#slack-status");
      status.className = "";
      status.textContent = "保存しています";
      try {
        const body = await api("/api/config/slack", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            connections: slack.map((connection) => ({
              id: connection.id,
              workspaceId: connection.workspaceId,
              channelIds: connection.channelIds,
              enabled: connection.enabled,
              botToken: connection.botToken,
              appToken: connection.appToken,
              signingSecret: connection.signingSecret,
            })),
          }),
        });
        slack = body.connections.map((connection) => ({ ...connection, botToken: "", appToken: "", signingSecret: "" }));
        renderSlack();
        status.className = "ok";
        status.textContent = "保存しました";
      } catch (error) {
        status.className = "error";
        status.textContent = error.message;
      }
    });

    document.querySelector("#save-projects").addEventListener("click", async () => {
      const status = document.querySelector("#project-status");
      status.className = "";
      status.textContent = "保存しています";
      try {
        const body = await api("/api/config/projects", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projects, routes }),
        });
        projects = body.projects;
        routes = body.routes;
        renderProjects();
        renderRoutes();
        status.className = "ok";
        status.textContent = "保存しました";
      } catch (error) {
        status.className = "error";
        status.textContent = error.message;
      }
    });

    if (token()) {
      loadEditor().catch((error) => {
        if (error.message !== "unauthorized") gateStatus.textContent = error.message;
      });
    }
  </script>
</body>
</html>
`;
