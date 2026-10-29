(() => {
  const KEY = "placement-console.tests.v1";
  const DEL_KEY = "placement-console.deleted.v1";   // id -> deletion time, so deletes sync too
  const SYNC_KEY = "placement-console.sync.v1";
  const GIST_FILE = "placement-console.json";
  const API = "https://api.github.com";
  const DEFAULT_DURATION = 90; // minutes, used to decide when a test counts as finished
  const $ = (s) => document.querySelector(s);

  // ---------- storage ----------
  function read(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  }
  function persist() {
    if (!write(KEY, tests) || !write(DEL_KEY, deleted)) toast("Could not save — browser storage is unavailable");
  }
  function save() { persist(); scheduleSync(); }

  let tests = read(KEY, []);
  if (!Array.isArray(tests)) tests = [];
  let deleted = read(DEL_KEY, {});
  if (!deleted || typeof deleted !== "object") deleted = {};
  let filter = "upcoming";
  let query = "";
  let editingId = null;

  // ---------- helpers ----------
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const startOf = (t) => new Date(`${t.date}T${t.time || "00:00"}`);
  const endOf = (t) => new Date(startOf(t).getTime() + (Number(t.duration) || DEFAULT_DURATION) * 60000);
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  // applied, but the company hasn't announced a test date yet — kept off the main schedule
  const isPending = (t) => !t.date;
  const scheduled = () => tests.filter((t) => !isPending(t));
  const awaiting = () => tests.filter(isPending);
  const dayOf = (iso) => new Date(`${iso.slice(0, 10)}T00:00`);

  function statusOf(t, now = new Date()) {
    const s = startOf(t), e = endOf(t);
    if (now >= e) return "done";
    if (now >= s) return "live";
    if (sameDay(s, now)) return "today";
    return "upcoming";
  }
  const STATUS_LABEL = { upcoming: "Upcoming", today: "Today", live: "In progress", done: "Completed" };

  const fmtTime = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const fmtDate = (d) => d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  function eta(t, now = new Date()) {
    const st = statusOf(t, now);
    if (st === "done") {
      const e = endOf(t);
      const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(e.getFullYear(), e.getMonth(), e.getDate())) / 86400000);
      return days <= 0 ? "Finished today" : days === 1 ? "Finished yesterday" : `Finished ${days}d ago`;
    }
    if (st === "live") {
      const left = Math.max(0, Math.round((endOf(t) - now) / 60000));
      return `Ends in ${left}m`;
    }
    let ms = startOf(t) - now;
    const d = Math.floor(ms / 86400000); ms -= d * 86400000;
    const h = Math.floor(ms / 3600000); ms -= h * 3600000;
    const m = Math.floor(ms / 60000);
    if (d > 0) return `T−${d}d ${pad(h)}h`;
    if (h > 0) return `T−${h}h ${pad(m)}m`;
    return `T−${Math.max(m, 0)}m`;
  }

  function linkify(text) {
    const safe = esc(text);
    return safe.replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u.replace(/^https?:\/\//, "").slice(0, 40)}${u.length > 48 ? "…" : ""}</a>`);
  }

  // ---------- render ----------
  function render() {
    const now = new Date();
    const all = scheduled();
    const withStatus = all.map((t) => ({ ...t, _st: statusOf(t, now) }));
    const active = withStatus.filter((t) => t._st !== "done").sort((a, b) => startOf(a) - startOf(b));
    const done = withStatus.filter((t) => t._st === "done").sort((a, b) => startOf(b) - startOf(a));

    renderHero(active, all, now);
    renderStats(active, done, now);
    renderAwaitButton();
    if (awaitDlg.open) renderAwaiting(now);

    // filter counts
    const counts = { upcoming: active.length, done: done.length, all: all.length };
    document.querySelectorAll("#filters button").forEach((b) => {
      b.classList.toggle("on", b.dataset.f === filter);
      b.querySelector(".n").textContent = counts[b.dataset.f];
    });

    let rows = filter === "upcoming" ? active : filter === "done" ? done : [...active, ...done];
    if (query) {
      const q = query.toLowerCase();
      rows = rows.filter((t) => [t.company, t.test, t.platform, t.notes].some((v) => String(v || "").toLowerCase().includes(q)));
    }

    const list = $("#list");
    if (!rows.length) {
      const msg = query ? `Nothing matches “${esc(query)}”.`
        : filter === "done" ? "No completed tests yet. Finished tests move here automatically."
        : all.length ? "No upcoming tests. Time to apply to more companies."
        : "Your schedule is empty. Add your first test to get started.";
      list.innerHTML = `<div class="empty"><div class="label" style="margin-bottom:6px">Nothing here</div>${msg}</div>`;
      return;
    }

    // group by time bucket
    const groups = [];
    const push = (name, t) => { let g = groups.find((x) => x.name === name); if (!g) groups.push(g = { name, items: [] }); g.items.push(t); };
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    rows.forEach((t) => {
      if (t._st === "done") return push("Completed", t);
      const days = Math.floor((startOf(t) - startToday) / 86400000);
      if (days <= 0) push("Today", t);
      else if (days === 1) push("Tomorrow", t);
      else if (days < 7) push("This week", t);
      else if (days < 30) push("This month", t);
      else push("Later", t);
    });

    list.innerHTML = groups.map((g) => `
      <div class="group-label"><span class="label">${g.name} · ${g.items.length}</span></div>
      <div class="list">${g.items.map((t, i) => rowHTML(t, now, i)).join("")}</div>
    `).join("");
  }

  function rowHTML(t, now, i) {
    const s = startOf(t);
    return `
      <article class="row ${t._st}" style="animation-delay:${Math.min(i, 8) * 30}ms">
        <div class="date-block">
          <div class="d">${pad(s.getDate())}</div>
          <div class="m">${s.toLocaleDateString([], { month: "short" })}</div>
          <div class="w">${s.toLocaleDateString([], { weekday: "short" })}</div>
        </div>
        <div class="info">
          <div class="co">${esc(t.company)}</div>
          <div class="tt">${esc(t.test)}</div>
          <div class="meta">
            <span class="chip">${fmtTime(s)}${t.duration ? ` · ${t.duration}m` : ""}</span>
            ${t.platform ? `<span class="chip">${linkify(t.platform)}</span>` : ""}          </div>
          ${t.notes ? `<div class="notes">${linkify(t.notes)}</div>` : ""}
        </div>
        <div class="side">
          <span class="status"><span class="dot"></span>${STATUS_LABEL[t._st]}</span>
          <span class="eta">${eta(t, now)}</span>
          <div class="actions">
            <button class="icon-btn" data-edit="${t.id}" aria-label="Edit ${esc(t.company)}" title="Edit">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>
            </button>
            <button class="icon-btn del" data-del="${t.id}" aria-label="Delete ${esc(t.company)}" title="Delete">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
            </button>
          </div>
        </div>
      </article>`;
  }

  let heroTarget = null;
  function renderHero(active, all, now) {
    const hero = $("#hero");
    const next = active[0];
    heroTarget = next || null;
    if (!next) {
      const waiting = awaiting().length;
      hero.innerHTML = `
        <div class="hero-empty">
          <div class="label">Next test</div>
          <div class="hero-company" style="font-size:28px">All clear</div>
          <p>${all.length ? "No tests coming up. Everything on your list is done." : "Add the tests you've been shortlisted for, and the next one will show up here with a live countdown."}${waiting ? ` ${waiting} compan${waiting === 1 ? "y is" : "ies are"} still to announce a date.` : ""}</p>
          <button class="btn" data-action="add">+ Add a test</button>
          ${waiting ? `<button class="btn ghost" data-action="awaiting">View awaiting</button>` : ""}
        </div>`;
      return;
    }
    const s = startOf(next);
    const st = next._st;
    hero.innerHTML = `
      <div>
        <div class="label">${st === "live" ? "Happening now" : "Next test"}</div>
        <div class="hero-company">${esc(next.company)}</div>
        <div class="hero-test">${esc(next.test)}</div>
        <div class="hero-meta">
          <span class="chip">${fmtDate(s)}</span>
          <span class="chip">${fmtTime(s)}</span>
          ${next.platform ? `<span class="chip">${linkify(next.platform)}</span>` : ""}
          <button class="chip" style="cursor:pointer" data-edit="${next.id}">Edit</button>
        </div>
      </div>
      <div class="countdown" id="countdown">
        ${["Days", "Hrs", "Min", "Sec"].map((u) => `<div class="cd-cell"><b>00</b><span>${u}</span></div>`).join("")}
      </div>`;
    tickHero(now);
  }

  function tickHero(now = new Date()) {
    const cd = $("#countdown");
    if (!cd || !heroTarget) return;
    const target = statusOf(heroTarget, now) === "live" ? endOf(heroTarget) : startOf(heroTarget);
    let ms = Math.max(0, target - now);
    const d = Math.floor(ms / 86400000); ms -= d * 86400000;
    const h = Math.floor(ms / 3600000); ms -= h * 3600000;
    const m = Math.floor(ms / 60000); ms -= m * 60000;
    const sec = Math.floor(ms / 1000);
    const cells = cd.querySelectorAll("b");
    [d, h, m, sec].forEach((v, i) => { cells[i].textContent = pad(v); });
  }

  function renderStats(active, done, now) {
    const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
    const thisWeek = active.filter((t) => startOf(t) < weekEnd).length;
    const today = active.filter((t) => sameDay(startOf(t), now)).length;
    $("#stats").innerHTML = [
      ["Upcoming", active.length, "var(--accent)"],
      ["Today", today, "var(--today)"],
      ["Next 7 days", thisWeek, "var(--live)"],
      ["Completed", done.length, "var(--done)"],
    ].map(([k, v, c]) => `<div class="stat"><span class="label"><i style="background:${c}"></i>${k}</span><b>${pad(v)}</b></div>`).join("");
  }

  // ---------- modal ----------
  const modal = $("#modal"), form = $("#form");
  const awaitDlg = $("#awaitDlg");
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

  // pending mode hides the date fields; required flags follow so hidden inputs never block saving
  function setPendingMode(on) {
    form.pending.checked = on;
    form.classList.toggle("pending-mode", on);
    form.date.required = form.time.required = form.test.required = !on;
    form.test.placeholder = on ? "e.g. Software Engineer (optional)" : "e.g. Online Assessment";
  }
  form.pending.addEventListener("change", () => {
    setPendingMode(form.pending.checked);
    if (!form.pending.checked && !form.time.value) form.time.value = "10:00";
  });

  // opts.pending: start a new entry in the awaiting list; opts.schedule: an awaiting entry just got its date
  function openModal(id = null, opts = {}) {
    editingId = id;
    form.reset();
    const t = id ? tests.find((x) => x.id === id) : null;
    const pending = opts.schedule ? false : t ? isPending(t) : !!opts.pending;
    $("#modalKicker").textContent = opts.schedule ? "Date announced" : t ? "Update entry" : "New entry";
    $("#modalTitle").textContent = opts.schedule ? `Schedule ${t.company}` : t ? `Edit ${t.company}` : pending ? "Add an application" : "Schedule a test";
    $("#saveBtn").textContent = opts.schedule ? "Add to schedule" : t ? "Save changes" : pending ? "Save" : "Save test";
    $("#deleteBtn").hidden = !t;
    if (t) {
      form.company.value = t.company;
      form.test.value = t.test || "";
      form.date.value = t.date || "";
      form.time.value = t.time || "10:00";
      form.duration.value = t.duration || "";
      form.platform.value = t.platform || "";
      form.notes.value = t.notes || "";
      form.appliedOn.value = t.appliedOn || "";
    } else {
      const tomorrow = new Date(Date.now() + 86400000);
      form.date.value = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
      form.time.value = "10:00";
      form.appliedOn.value = todayISO();
    }
    setPendingMode(pending);
    modal.showModal();
    const first = opts.schedule ? (form.test.value ? form.date : form.test) : form.company;
    setTimeout(() => first.focus(), 30);
  }
  const closeModal = () => { modal.close(); editingId = null; render(); };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    const pending = form.pending.checked;
    const entry = {
      company: v.company.trim(),
      test: v.test.trim(),
      date: pending ? "" : v.date,
      time: pending ? "" : v.time,
      duration: !pending && v.duration ? Math.max(5, Math.min(1440, Number(v.duration))) : null,
      platform: v.platform.trim(),
      notes: v.notes.trim(),
      appliedOn: v.appliedOn || "",
    };
    if (!entry.company || (!pending && (!entry.test || !entry.date || !entry.time))) return;

    if (editingId) {
      const t = tests.find((x) => x.id === editingId);
      if (t) {
        const wasPending = isPending(t);
        Object.assign(t, entry, { updatedAt: new Date().toISOString() });
        delete t.history; // old slots aren't kept; an edit simply replaces the test
        toast(wasPending && !pending ? `${entry.company} moved to your schedule`
          : !wasPending && pending ? `${entry.company} moved to Awaiting dates`
          : `${entry.company} updated`);
      }
    } else {
      const ts = new Date().toISOString();
      tests.push({ id: uid(), ...entry, createdAt: ts, updatedAt: ts });
      toast(pending ? `${entry.company} added to Awaiting dates` : `${entry.company} added`);
      if (!pending && statusOf(entry) === "done") filter = "all";
    }
    save();
    closeModal();
  });

  // ---------- delete with confirm ----------
  const confirmDlg = $("#confirm");
  let pendingDelete = null;
  function askDelete(id) {
    const t = tests.find((x) => x.id === id);
    if (!t) return;
    pendingDelete = id;
    $("#confirmTitle").textContent = `Delete ${t.company}?`;
    $("#confirmText").textContent = isPending(t)
      ? `${t.company} will be removed from Awaiting dates. This can't be undone.`
      : `${t.test} on ${fmtDate(startOf(t))} will be removed from your schedule. This can't be undone.`;
    confirmDlg.showModal();
  }
  $("#confirmNo").onclick = () => { confirmDlg.close(); pendingDelete = null; if (!modal.open) render(); };
  $("#confirmYes").onclick = () => {
    const t = tests.find((x) => x.id === pendingDelete);
    tests = tests.filter((x) => x.id !== pendingDelete);
    deleted[pendingDelete] = new Date().toISOString();
    save();
    confirmDlg.close();
    if (modal.open) closeModal();
    pendingDelete = null;
    render();
    if (t) toast(`${t.company} deleted`);
  };

  // ---------- awaiting dates ----------
  // Companies applied to that haven't announced a test date. They stay out of the
  // main schedule until a date is added, then move across on their own.
  function renderAwaitButton() {
    const n = awaiting().length;
    const btn = $("#awaitBtn");
    btn.classList.toggle("has", n > 0);
    $("#awaitCount").textContent = n ? pad(n) : "";
  }

  function waitedFor(t, now) {
    const since = t.appliedOn || (t.createdAt || "").slice(0, 10);
    if (!since) return "";
    const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - dayOf(since)) / 86400000);
    const when = dayOf(since).toLocaleDateString([], { day: "numeric", month: "short" });
    const verb = t.appliedOn ? "Applied" : "Added";
    return days <= 0 ? `${verb} today` : `${verb} ${when} · waiting ${days}d`;
  }

  function renderAwaiting(now = new Date()) {
    const items = awaiting().sort((a, b) => (a.appliedOn || a.createdAt || "").localeCompare(b.appliedOn || b.createdAt || ""));
    const icon = (path) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
    awaitDlg.innerHTML = `
      <div class="modal-head">
        <div><div class="label">Awaiting dates · ${items.length}</div><h2>Applied, no test date yet</h2></div>
        <button type="button" class="icon-btn" data-await="close" aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </div>
      <div class="await-body">
        ${items.length ? `<p>When a company announces its test, press <b>Add date</b> and it moves to your main schedule.</p>` : ""}
        ${items.length ? items.map((t) => `
          <article class="await-row">
            <div class="info">
              <div class="co">${esc(t.company)}</div>
              <div class="tt">${t.test ? esc(t.test) : "Test date not announced"}</div>
              <div class="meta">
                ${waitedFor(t, now) ? `<span class="chip">${waitedFor(t, now)}</span>` : ""}
                ${t.platform ? `<span class="chip">${linkify(t.platform)}</span>` : ""}
              </div>
              ${t.notes ? `<div class="notes">${linkify(t.notes)}</div>` : ""}
            </div>
            <div class="actions">
              <button type="button" class="btn sm" data-schedule="${t.id}">Add date</button>
              <button type="button" class="icon-btn" data-edit="${t.id}" aria-label="Edit ${esc(t.company)}" title="Edit">${icon('<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>')}</button>
              <button type="button" class="icon-btn del" data-del="${t.id}" aria-label="Delete ${esc(t.company)}" title="Delete">${icon('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>')}</button>
            </div>
          </article>`).join("") : `
          <div class="empty"><div class="label" style="margin-bottom:6px">Nothing waiting</div>Applied somewhere that hasn't shared a test date? Add it here so you don't lose track of it.</div>`}
      </div>
      <div class="modal-foot">
        <div class="right">
          <button type="button" class="btn ghost" data-await="close">Close</button>
          <button type="button" class="btn" data-action="add-pending">+ Add company</button>
        </div>
      </div>`;
  }

  function openAwaiting() {
    renderAwaiting();
    if (!awaitDlg.open) awaitDlg.showModal();
  }
  awaitDlg.addEventListener("click", (e) => {
    if (e.target === awaitDlg || e.target.closest("[data-await=close]")) awaitDlg.close();
  });

  // ---------- events ----------
  $("#addBtn").onclick = () => openModal();
  $("#awaitBtn").onclick = openAwaiting;
  $("#closeBtn").onclick = closeModal;
  $("#cancelBtn").onclick = closeModal;
  $("#deleteBtn").onclick = () => editingId && askDelete(editingId);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

  document.addEventListener("click", (e) => {
    const ed = e.target.closest("[data-edit]");
    if (ed) return openModal(ed.dataset.edit);
    const del = e.target.closest("[data-del]");
    if (del) return askDelete(del.dataset.del);
    const sch = e.target.closest("[data-schedule]");
    if (sch) return openModal(sch.dataset.schedule, { schedule: true });
    if (e.target.closest("[data-action=add]")) return openModal();
    if (e.target.closest("[data-action=add-pending]")) return openModal(null, { pending: true });
    if (e.target.closest("[data-action=awaiting]")) return openAwaiting();
  });

  $("#filters").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    filter = b.dataset.f;
    render();
  });
  $("#search").addEventListener("input", (e) => { query = e.target.value.trim(); render(); });

  document.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "n" && !e.ctrlKey && !e.metaKey && !e.altKey && !modal.open && !confirmDlg.open && !syncDlg.open && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      e.preventDefault(); openModal(null, { pending: awaitDlg.open });
    }
  });

  // ---------- backup ----------
  $("#exportBtn").onclick = () => {
    const blob = new Blob([JSON.stringify({ app: "placement-console", version: 1, exportedAt: new Date().toISOString(), tests }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    const d = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = `placement-schedule-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`Exported ${tests.length} entr${tests.length === 1 ? "y" : "ies"}`);
  };
  $("#importBtn").onclick = () => $("#importFile").click();
  $("#importFile").onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = Array.isArray(data) ? data : data.tests;
      if (!Array.isArray(incoming)) throw new Error();
      const valid = incoming.filter((t) => t && t.company && (
        (t.test && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && /^\d{2}:\d{2}/.test(t.time)) || !t.date  // scheduled, or awaiting a date
      ));
      // merge: imported entries replace ones with the same id, everything else is added
      const byId = new Map(tests.map((t) => [t.id, t]));
      const ts = new Date().toISOString();
      valid.forEach((t) => {
        const id = t.id || uid();
        byId.set(id, { ...t, id, updatedAt: ts });
        delete deleted[id];
      });
      tests = [...byId.values()];
      save(); render();
      toast(`Imported ${valid.length} entr${valid.length === 1 ? "y" : "ies"}`);
    } catch {
      toast("That file doesn't look like a schedule backup");
    }
  };

  // ---------- cross-device sync ----------
  // The schedule is mirrored to a secret Gist on the user's own GitHub account.
  // Every device keeps a full local copy; a sync pulls the Gist, merges it with
  // local data (newest edit per test wins, deletions are remembered), saves the
  // result locally and pushes it back if anything changed.
  let syncCfg = read(SYNC_KEY, {}) || {};   // { token, login, gistId, lastSync }
  const saveSyncCfg = () => write(SYNC_KEY, syncCfg);
  let syncState = syncCfg.token ? "busy" : "off";
  let syncError = "";
  let syncInFlight = null, syncAgain = false, syncTimer = null;

  const stamp = (t) => t.updatedAt || t.createdAt || "";
  const canon = (d) => JSON.stringify({
    tests: [...(d.tests || [])].sort((a, b) => (a.id < b.id ? -1 : 1)),
    deleted: Object.fromEntries(Object.entries(d.deleted || {}).sort()),
  });

  function mergeData(remote) {
    const del = { ...(remote.deleted || {}) };
    for (const [id, ts] of Object.entries(deleted)) if (!del[id] || ts > del[id]) del[id] = ts;
    const cutoff = new Date(Date.now() - 120 * 86400000).toISOString();
    for (const id of Object.keys(del)) if (del[id] < cutoff) delete del[id];
    const byId = new Map();
    for (const t of [...(remote.tests || []), ...tests]) {
      if (!t || !t.id) continue;
      const cur = byId.get(t.id);
      if (!cur || stamp(t) > stamp(cur)) byId.set(t.id, t);
    }
    return { tests: [...byId.values()].filter((t) => !(del[t.id] && del[t.id] >= stamp(t))), deleted: del };
  }

  async function gh(path, opts = {}, token = syncCfg.token) {
    const res = await fetch(API + path, {
      cache: "no-store",
      ...opts,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (!res.ok) { const err = new Error(`GitHub responded ${res.status}`); err.status = res.status; throw err; }
    return res;
  }

  async function findGist() {
    for (let page = 1; page <= 10; page++) {
      const list = await (await gh(`/gists?per_page=100&page=${page}`)).json();
      const hit = list.find((g) => g.files && g.files[GIST_FILE]);
      if (hit) return (await gh(`/gists/${hit.id}`)).json();
      if (list.length < 100) break;
    }
    return null;
  }

  async function remoteData(gist) {
    const empty = { tests: [], deleted: {} };
    const f = gist && gist.files && gist.files[GIST_FILE];
    if (!f) return empty;
    try {
      const text = f.truncated ? await (await fetch(f.raw_url, { cache: "no-store" })).text() : f.content;
      const d = JSON.parse(text);
      return { tests: Array.isArray(d.tests) ? d.tests : [], deleted: d.deleted && typeof d.deleted === "object" ? d.deleted : {} };
    } catch { return empty; }
  }

  const payload = () => JSON.stringify({ app: "placement-console", version: 2, savedAt: new Date().toISOString(), tests, deleted }, null, 2);

  function syncNow() {
    if (!syncCfg.token) return Promise.resolve();
    if (syncInFlight) { syncAgain = true; return syncInFlight; }
    setSyncState("busy");
    syncInFlight = (async () => {
      try {
        let gist = null;
        if (syncCfg.gistId) {
          try { gist = await (await gh(`/gists/${syncCfg.gistId}`)).json(); }
          catch (e) { if (e.status !== 404) throw e; }
        }
        if (!gist) gist = await findGist();
        const remote = await remoteData(gist);
        const before = canon({ tests, deleted });
        const merged = mergeData(remote);
        tests = merged.tests;
        deleted = merged.deleted;
        persist();
        const files = { [GIST_FILE]: { content: payload() } };
        if (!gist) {
          gist = await (await gh("/gists", { method: "POST", body: JSON.stringify({ description: "Placement Console — synced test schedule", public: false, files }) })).json();
        } else if (canon(merged) !== canon(remote)) {
          await gh(`/gists/${gist.id}`, { method: "PATCH", body: JSON.stringify({ files }) });
        }
        syncCfg.gistId = gist.id;
        syncCfg.lastSync = new Date().toISOString();
        saveSyncCfg();
        if (canon(merged) !== before && !modal.open && !confirmDlg.open) render();
        setSyncState("ok");
      } catch (e) {
        if (e.status === 401) setSyncState("auth", "GitHub rejected the key — it may have expired or been deleted. Paste a new one to reconnect.");
        else if (navigator.onLine === false) setSyncState("offline");
        else setSyncState("error", e.message || "Couldn't reach GitHub.");
      } finally {
        syncInFlight = null;
        if (syncAgain) { syncAgain = false; syncNow(); }
      }
    })();
    return syncInFlight;
  }

  function scheduleSync() {
    if (!syncCfg.token) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 500);
  }

  async function connect(token) {
    token = token.trim();
    const res = await gh("/user", {}, token);
    const scopes = res.headers.get("X-OAuth-Scopes");
    if (scopes !== null && !/\bgist\b/.test(scopes)) {
      const err = new Error("This key doesn't have the “gist” permission. Create a new one with the gist box ticked.");
      err.status = "scope";
      throw err;
    }
    const user = await res.json();
    syncCfg = { token, login: user.login };
    saveSyncCfg();
    await syncNow();
    if (syncState !== "ok") throw new Error(syncError || "Connected, but the first sync failed.");
  }

  function disconnect() {
    clearTimeout(syncTimer);
    syncCfg = {};
    try { localStorage.removeItem(SYNC_KEY); } catch {}
    setSyncState("off");
    toast("Sync turned off on this device");
  }

  const SYNC_PILL = {
    off:     ["", "Sync off"],
    busy:    ["busy", "Syncing…"],
    ok:      ["ok", "Synced"],
    offline: ["warn", "Offline"],
    auth:    ["bad", "Reconnect"],
    error:   ["warn", "Sync error"],
  };
  function setSyncState(state, err = "") {
    syncState = state;
    syncError = err;
    const [cls, text] = SYNC_PILL[state];
    const pill = $("#syncPill");
    pill.className = `sync-pill ${cls}`;
    pill.querySelector("span").textContent = text;
    pill.title = state === "ok" && syncCfg.lastSync ? `Last synced ${fmtTime(new Date(syncCfg.lastSync))}` : "Sync across devices";
    $("#footNote").innerHTML = syncCfg.token
      ? `Synced to a private Gist on <b>@${esc(syncCfg.login || "your account")}</b>. Changes made on your laptop or phone show up on the other within a minute.`
      : `Your schedule is saved on this device. Turn on <b>Sync</b> (top right) to keep your laptop and phone in step.`;
    if (syncDlg.open && !syncDlg.contains(document.activeElement)) renderSyncDialog();
    else if (syncDlg.open) updateSyncStatusLine();
  }

  // ---------- sync dialog ----------
  const syncDlg = $("#syncDlg");
  const TOKEN_URL = "https://github.com/settings/tokens/new?scopes=gist&description=Placement%20Console%20sync";
  const pairLink = () => `${location.origin}${location.pathname}#sync=${encodeURIComponent(syncCfg.token)}`;

  function statusLine() {
    if (syncState === "busy") return "Syncing now…";
    if (syncState === "offline") return "You're offline — changes are saved here and will sync when you're back online.";
    if (syncState === "error") return `Last attempt failed: ${syncError}`;
    return syncCfg.lastSync ? `Last synced ${fmtTime(new Date(syncCfg.lastSync))} · checks every minute and whenever you open the page` : "Not synced yet";
  }
  function updateSyncStatusLine() {
    const el = syncDlg.querySelector("[data-status]");
    if (el) el.textContent = statusLine();
  }

  function renderSyncDialog() {
    const connected = syncCfg.token && syncState !== "auth";
    const head = `
      <div class="modal-head">
        <div><div class="label">Sync</div><h2>${connected ? "Your devices are linked" : "Sync laptop &amp; phone"}</h2></div>
        <button type="button" class="icon-btn" data-sync="close" aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </div>`;
    if (!connected) {
      syncDlg.innerHTML = `${head}
        <form class="sync-body" data-sync-form>
          <p>Your tests get saved to a private Gist (a small file) on your own GitHub account, and every device you connect reads and writes that same file. You only set this up once.</p>
          <ol class="steps">
            <li><span><a href="${TOKEN_URL}" target="_blank" rel="noopener">Create a GitHub key ↗</a>. Only the <b>gist</b> box needs to be ticked, and it already is. Set the expiry to <b>No expiration</b> or a date after placements, then press <b>Generate token</b> and copy it.</span></li>
            <li><span>Paste the key below and press <b>Connect</b>.</span></li>
            <li><span>A QR code will appear. Scan it with your phone camera and the phone connects too.</span></li>
          </ol>
          <div class="field">
            <label for="tokenInput">GitHub key</label>
            <input id="tokenInput" type="password" placeholder="ghp_…" autocomplete="off" spellcheck="false" required>
          </div>
          ${syncError ? `<div class="sync-err">${esc(syncError)}</div>` : ""}
        </form>
        <div class="modal-foot">
          ${syncCfg.token ? `<button type="button" class="btn ghost" data-sync="disconnect">Turn off sync</button>` : ""}
          <div class="right">
            <button type="button" class="btn ghost" data-sync="close">Cancel</button>
            <button type="button" class="btn" data-sync="connect">Connect</button>
          </div>
        </div>`;
      return;
    }
    syncDlg.innerHTML = `${head}
      <div class="sync-body">
        <div class="sync-status"><span class="dot"></span><div><b>Connected as @${esc(syncCfg.login || "you")}</b><span data-status>${esc(statusLine())}</span></div></div>
        <div class="pair">
          <div class="qr" id="qr" aria-label="QR code for linking your phone"></div>
          <div>
            <div class="label">Link another device</div>
            <p style="margin-top:6px">Scan this with your phone camera, or open the link below on it. It has your key inside, so don't share it with anyone.</p>
            <div class="copyrow">
              <input readonly value="${esc(pairLink())}" aria-label="Device link" data-pair>
              <button type="button" class="btn ghost sm" data-sync="copy">Copy</button>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn ghost" data-sync="disconnect">Turn off sync</button>
        <div class="right">
          ${syncCfg.gistId ? `<a class="btn ghost" href="https://gist.github.com/${esc(syncCfg.login || "")}/${esc(syncCfg.gistId)}" target="_blank" rel="noopener" style="text-decoration:none">View data</a>` : ""}
          <button type="button" class="btn" data-sync="now">Sync now</button>
        </div>
      </div>`;
    drawQR($("#qr"), pairLink());
  }

  let qrLib = null;
  function drawQR(el, text) {
    if (!el) return;
    qrLib = qrLib || new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
      s.onload = () => resolve(window.QRCode);
      s.onerror = () => { qrLib = null; reject(); };
      document.head.appendChild(s);
    });
    qrLib.then((QR) => {
      el.innerHTML = "";
      new QR(el, { text, width: 146, height: 146, colorDark: "#16171a", colorLight: "#ffffff", correctLevel: QR.CorrectLevel.M });
    }).catch(() => { el.innerHTML = `<span class="label" style="text-align:center">QR unavailable<br>use the link</span>`; });
  }

  function openSync() {
    renderSyncDialog();
    if (!syncDlg.open) syncDlg.showModal();
    const input = syncDlg.querySelector("#tokenInput");
    if (input) setTimeout(() => input.focus(), 30);
  }

  async function doConnect() {
    const input = syncDlg.querySelector("#tokenInput");
    const btn = syncDlg.querySelector("[data-sync=connect]");
    if (!input || !input.value.trim()) { input && input.focus(); return; }
    btn.disabled = true;
    btn.textContent = "Connecting…";
    try {
      await connect(input.value);
      syncError = "";
      renderSyncDialog();
      toast("Sync is on");
    } catch (e) {
      syncError = e.status === 401 ? "GitHub didn't accept that key. Check you copied all of it." : e.message || "Couldn't connect.";
      if (!syncCfg.login) { syncCfg = {}; try { localStorage.removeItem(SYNC_KEY); } catch {} syncState = "off"; }
      renderSyncDialog();
      setSyncState(syncState, syncError);
    }
  }

  $("#syncPill").onclick = openSync;
  syncDlg.addEventListener("click", async (e) => {
    if (e.target === syncDlg) return syncDlg.close();
    const act = e.target.closest("[data-sync]")?.dataset.sync;
    if (act === "close") syncDlg.close();
    else if (act === "connect") doConnect();
    else if (act === "now") syncNow();
    else if (act === "disconnect") { disconnect(); renderSyncDialog(); }
    else if (act === "copy") {
      const field = syncDlg.querySelector("[data-pair]");
      try { await navigator.clipboard.writeText(field.value); toast("Link copied — open it on your phone"); }
      catch { field.select(); toast("Press Ctrl+C to copy"); }
    }
  });
  syncDlg.addEventListener("submit", (e) => { e.preventDefault(); doConnect(); });
  syncDlg.addEventListener("close", () => { if (syncState === "off" || syncState === "ok") syncError = ""; });

  // pull fresh data whenever the page comes back into view, and once a minute while visible
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncNow(); });
  window.addEventListener("online", () => syncNow());
  setInterval(() => { if (document.visibilityState === "visible") syncNow(); }, 60000);

  // ---------- toast ----------
  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    if (el.showPopover) {
      // re-open so it lands on top of whichever dialog is currently open
      try { if (el.matches(":popover-open")) el.hidePopover(); el.showPopover(); } catch {}
    }
    requestAnimationFrame(() => el.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  // ---------- clock + live updates ----------
  let lastMinute = -1;
  function tick() {
    const now = new Date();
    $("#clockTime").textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    $("#clockDate").textContent = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
    tickHero(now);
    // re-render once a minute so statuses and colours flip on their own
    if (now.getMinutes() !== lastMinute) {
      if (lastMinute !== -1 && !modal.open) render();
      lastMinute = now.getMinutes();
    }
  }

  render();
  tick();
  setInterval(tick, 1000);

  // a device link looks like …/#sync=<key>; take the key and scrub it from the address bar
  const linkToken = new URLSearchParams(location.hash.slice(1)).get("sync");
  if (linkToken) {
    history.replaceState(null, "", location.pathname + location.search);
    setSyncState("busy");
    connect(linkToken)
      .then(() => toast("This device is now synced"))
      .catch((e) => {
        if (!syncCfg.login) { syncCfg = {}; try { localStorage.removeItem(SYNC_KEY); } catch {} }
        setSyncState(syncCfg.token ? syncState : "off", e.status === 401 ? "That link's key was rejected by GitHub. Paste a fresh key here." : e.message);
        openSync();
      });
  } else {
    setSyncState(syncState);
    syncNow();
  }
})();
