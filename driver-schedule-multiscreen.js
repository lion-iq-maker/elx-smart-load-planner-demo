/* ELX Driver Schedule only: optional single-window multi-monitor helper. */
(() => {
  "use strict";
  const FLAG = "elxScheduleWide";
  const BUTTON = "elx-wide-schedule-button";
  const MODAL = "elx-wide-schedule-modal";

  function scheduleHeading() {
    return Array.from(document.querySelectorAll("main section h1"))
      .find(el => el.textContent.trim() === "Driver Schedule");
  }

  function openSchedulePageOnLaunch() {
    if (new URLSearchParams(location.search).get(FLAG) !== "1") return;
    let attempts = 0;
    const timer = setInterval(() => {
      if (scheduleHeading() || attempts++ > 100) { clearInterval(timer); return; }
      const nav = Array.from(document.querySelectorAll("aside nav button"))
        .find(el => el.textContent.trim() === "Driver Schedule");
      if (nav) { nav.click(); clearInterval(timer); }
    }, 200);
  }

  function bounds(screen) {
    return {
      left: Number.isFinite(screen.availLeft) ? screen.availLeft : screen.left,
      top: Number.isFinite(screen.availTop) ? screen.availTop : screen.top,
      width: screen.availWidth || screen.width,
      height: screen.availHeight || screen.height
    };
  }

  function picker(screens) {
    let modal = document.getElementById(MODAL);
    if (!modal) {
      modal = document.createElement("div");
      modal.id = MODAL;
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-label", "Expand Driver Schedule across screens");
      modal.innerHTML = '<div class="elx-wide-panel">' +
        '<h2>Driver Schedule — Multi-screen</h2>' +
        '<p>Select two or more monitors to open one continuous schedule window.</p>' +
        '<div class="elx-wide-list"></div>' +
        '<p class="elx-wide-hint">Windows must be set to Extend. Chrome may limit window placement, and physical monitor borders remain visible.</p>' +
        '<p class="elx-wide-error" role="status" aria-live="polite"></p>' +
        '<div class="elx-wide-actions"><button type="button" class="elx-wide-cancel">Cancel</button>' +
        '<button type="button" class="elx-wide-open">Open wide view</button></div></div>';
      document.body.appendChild(modal);
      modal.querySelector(".elx-wide-cancel").onclick = () => { modal.hidden = true; };
      modal.addEventListener("click", ev => { if (ev.target === modal) modal.hidden = true; });
    }
    const list = modal.querySelector(".elx-wide-list");
    const error = modal.querySelector(".elx-wide-error");
    const launch = modal.querySelector(".elx-wide-open");
    list.replaceChildren();
    error.textContent = "";
    const ordered = Array.from(screens).sort((a,b) => a.left - b.left || a.top - b.top);
    const external = ordered.filter(s => s.isInternal === false);
    const defaults = new Set(external.length >= 2 ? external : ordered.slice(0,2));
    const choices = [];
    ordered.forEach((screen, i) => {
      const row = document.createElement("label");
      row.className = "elx-wide-screen";
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = defaults.has(screen);
      const description = document.createElement("span");
      const s = bounds(screen);
      description.textContent = (screen.label || "Display " + (i+1)) +
        " — " + Math.round(s.width) + " × " + Math.round(s.height);
      row.append(check, description);
      list.appendChild(row);
      choices.push({check,screen});
    });
    function update() { launch.disabled = choices.filter(x => x.check.checked).length < 2; }
    choices.forEach(x => x.check.onchange = update);
    update();
    modal.hidden = false;
    launch.focus();
    launch.onclick = () => {
      const selected = choices.filter(x => x.check.checked).map(x => bounds(x.screen));
      if (selected.length < 2) return;
      const left = Math.min(...selected.map(s => s.left));
      const top = Math.min(...selected.map(s => s.top));
      const right = Math.max(...selected.map(s => s.left + s.width));
      const bottom = Math.max(...selected.map(s => s.top + s.height));
      const width = Math.round(right - left);
      const height = Math.round(bottom - top);
      const url = new URL(location.href);
      url.searchParams.set(FLAG, "1");
      // This call runs directly inside a user click to avoid popup blockers.
      const popup = window.open(url.href, "ELXDriverScheduleWide",
        "popup=yes,left=" + Math.round(left) + ",top=" + Math.round(top) +
        ",width=" + width + ",height=" + height);
      if (!popup) {
        error.textContent = "Chrome blocked the window. Allow pop-ups for this ELX site and retry.";
        return;
      }
      try {
        popup.moveTo(Math.round(left), Math.round(top));
        popup.resizeTo(width, height);
        popup.focus();
      } catch (_) { /* Chrome or Windows may restrict placement. */ }
      modal.hidden = true;
    };
  }

  async function showPicker() {
    if (typeof window.getScreenDetails !== "function") {
      alert("Chrome does not support window management. Please update Chrome.");
      return;
    }
    try {
      const details = await window.getScreenDetails();
      if (!details.screens || details.screens.length < 2) {
        alert("Chrome cannot see two extended monitors. Set Windows displays to Extend.");
        return;
      }
      picker(details.screens);
    } catch (_) {
      alert("Please allow this site to manage windows on your displays in Chrome, then try again.");
    }
  }

  function installButton() {
    const heading = scheduleHeading();
    const existing = document.getElementById(BUTTON);
    if (!heading) { if (existing) existing.remove(); return; }
    if (existing && existing.isConnected) return;
    const header = heading.parentElement && heading.parentElement.parentElement;
    if (!header) return;
    const button = document.createElement("button");
    button.id = BUTTON;
    button.type = "button";
    button.textContent = "Expand Across Screens";
    button.title = "Open one continuous Driver Schedule window on multiple monitors";
    button.onclick = showPicker;
    header.insertBefore(button, header.lastElementChild);
  }

  function init() {
    const style = document.createElement("style");
    style.textContent = '#' + BUTTON + '{margin-left:auto;background:#d71920;color:white;border:0;border-radius:7px;padding:10px 13px;font:600 12px system-ui;cursor:pointer;white-space:nowrap}' +
      '#' + BUTTON + ':hover{background:#aa1219}' +
      '#' + MODAL + '{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(5,10,20,.65);font:14px system-ui;color:#0f172a}' +
      '#' + MODAL + '[hidden]{display:none}' +
      '#' + MODAL + ' .elx-wide-panel{background:white;width:min(500px,100%);max-height:90vh;overflow:auto;border-radius:13px;padding:24px;box-sizing:border-box}' +
      '#' + MODAL + ' h2{font-size:20px;font-weight:700;margin:0 0 10px}' +
      '#' + MODAL + ' p{line-height:1.5;color:#475569;margin:0 0 14px}' +
      '#' + MODAL + ' .elx-wide-list{display:grid;gap:9px;margin:15px 0}' +
      '#' + MODAL + ' .elx-wide-screen{display:flex;gap:10px;align-items:center;padding:11px;border:1px solid #cbd5e1;border-radius:8px;cursor:pointer}' +
      '#' + MODAL + ' .elx-wide-hint{font-size:12px}' +
      '#' + MODAL + ' .elx-wide-error{color:#b91c1c;min-height:16px}' +
      '#' + MODAL + ' .elx-wide-actions{display:flex;justify-content:flex-end;gap:10px}' +
      '#' + MODAL + ' button{cursor:pointer;padding:10px 13px;border:1px solid #cbd5e1;background:white;border-radius:7px}' +
      '#' + MODAL + ' .elx-wide-open{background:#d71920;color:white;border-color:#d71920}' +
      '#' + MODAL + ' button:disabled{opacity:.5;cursor:not-allowed}' +
      '#' + MODAL + ' button:focus-visible,#' + BUTTON + ':focus-visible{outline:3px solid #f59e0b;outline-offset:2px}';
    document.head.appendChild(style);
    openSchedulePageOnLaunch();
    installButton();
    const root = document.getElementById("root");
    if (root) new MutationObserver(installButton).observe(root,{childList:true,subtree:true});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",init,{once:true});
  else init();
})();
