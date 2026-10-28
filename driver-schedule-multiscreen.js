/* ELX Driver Schedule — multi-monitor display; no changes to React/backend. */
(() => {
  "use strict";

  const PARAM = "elxScheduleDisplay";
  const BUTTON_ID = "elx-wide-schedule-button";
  const DIALOG_ID = "elx-wide-schedule-dialog";
  const isWallboard = new URLSearchParams(location.search).get(PARAM) === "1";
  const params = new URLSearchParams(location.search);
  const displayIndex = Math.max(0, Number(params.get("elxDisplayIndex") || 0));
  const displayCount = Math.max(1, Number(params.get("elxDisplayCount") || 1));
  const channelId = (params.get("elxDisplayId") || "").replace(/[^a-zA-Z0-9-]/g,"").slice(0,72);
  const initialWidths = (params.get("elxDisplayWidths") || "").split(",").map(Number);
  const channel = isWallboard && channelId && "BroadcastChannel" in window
    ? new BroadcastChannel("elx-driver-display-" + channelId)
    : null;

  function scheduleHeading() {
    return Array.from(document.querySelectorAll("main h1"))
      .find(x => x.textContent.trim() === "Driver Schedule");
  }

  function browserBounds(screen) {
    return {
      left: Number.isFinite(screen.availLeft) ? screen.availLeft : screen.left,
      top: Number.isFinite(screen.availTop) ? screen.availTop : screen.top,
      width: screen.availWidth || screen.width,
      height: screen.availHeight || screen.height
    };
  }

  function navigateToDriverSchedule() {
    if (!isWallboard) return;
    let attempts = 0;
    const timer = setInterval(() => {
      if (scheduleHeading()) { clearInterval(timer); return; }
      const nav = Array.from(document.querySelectorAll("aside button, nav button"))
        .find(el => el.textContent.trim() === "Driver Schedule");
      if (nav) {
        nav.click();
        clearInterval(timer);
      } else if (++attempts > 150) clearInterval(timer);
    }, 200);
  }

  function setupWallboard() {
    if (!isWallboard || displayCount < 2) return;
    document.documentElement.classList.add("elx-wide-display");
    const initial = Array.from({length:displayCount}, (_,i) => initialWidths[i] > 0 ? initialWidths[i] : window.innerWidth);
    const widths = initial.slice();

    const style = document.createElement("style");
    style.textContent = [
      "html.elx-wide-display,html.elx-wide-display body{width:100%;max-width:none;overflow-x:hidden!important}",
      "html.elx-wide-display #root{max-width:none!important;transform-origin:top left!important;will-change:transform}",
      "html.elx-wide-display #elx-wide-indicator{position:fixed;z-index:2147483640;bottom:10px;right:10px;background:rgba(15,23,42,.80);color:white;border-radius:7px;padding:5px 9px;font:12px system-ui;pointer-events:none}"
    ].join("");
    document.head.appendChild(style);
    const indicator = document.createElement("div");
    indicator.id = "elx-wide-indicator";
    indicator.textContent = "Driver Schedule • Display " + (displayIndex + 1) + "/" + displayCount;
    document.body.appendChild(indicator);

    function applyGeometry() {
      const root = document.getElementById("root");
      if (!root) return;
      const wholeWidth = widths.reduce((a,b) => a+b, 0);
      const offset = widths.slice(0,displayIndex).reduce((a,b) => a+b,0);
      root.style.width = wholeWidth + "px";
      root.style.minWidth = wholeWidth + "px";
      root.style.transform = "translateX(-" + offset + "px)";
    }

    function announce() {
      applyGeometry();
      channel?.postMessage({kind:"width",index:displayIndex,width:innerWidth});
    }

    channel && (channel.onmessage = ev => {
      const msg = ev.data || {};
      if (msg.kind === "width" && Number.isInteger(msg.index) && msg.index < displayCount &&
          msg.index >= 0 && Number.isFinite(msg.width) && msg.width > 300) {
        widths[msg.index] = msg.width;
        applyGeometry();
      }
      if (msg.kind === "hello") announce();
      if (msg.kind === "scroll" && msg.index !== displayIndex &&
          msg.position && typeof msg.position === "object") {
        const el = locateScrollTarget(msg.position.path);
        if (!el) return;
        el.dataset.elxRemoteScroll = "1";
        el.scrollTop = msg.position.top || 0;
        el.scrollLeft = msg.position.left || 0;
        requestAnimationFrame(() => { delete el.dataset.elxRemoteScroll; });
      }
    });

    function locateScrollTarget(path) {
      if (path === "window") return document.scrollingElement;
      const root = document.getElementById("root");
      if (!root || !Array.isArray(path)) return null;
      let node = root;
      for (const n of path) {
        if (!node.children || !node.children[n]) return null;
        node = node.children[n];
      }
      return node;
    }

    function pathToNode(el) {
      if (el === document || el === document.body || el === document.documentElement) return "window";
      const root = document.getElementById("root");
      if (!root || !(el instanceof Element) || !root.contains(el)) return null;
      const path = [];
      let node = el;
      while (node !== root) {
        const parent = node.parentElement;
        if (!parent) return null;
        path.unshift(Array.prototype.indexOf.call(parent.children,node));
        node = parent;
      }
      return path;
    }

    let scrollTimer = 0;
    let pending = null;
    document.addEventListener("scroll", event => {
      if (!channel) return;
      const node = event.target === document ? document.scrollingElement : event.target;
      if (!node || node.dataset?.elxRemoteScroll === "1") return;
      const path = pathToNode(event.target);
      if (path === null) return;
      pending = {path,top:node.scrollTop,left:node.scrollLeft};
      if (!scrollTimer) scrollTimer = setTimeout(() => {
        channel.postMessage({kind:"scroll",index:displayIndex,position:pending});
        scrollTimer = 0;
      },60);
    },true);

    navigateToDriverSchedule();
    announce();
    channel?.postMessage({kind:"hello"});
    window.addEventListener("resize",announce);
    const root = document.getElementById("root");
    if (root) new MutationObserver(applyGeometry).observe(root,{childList:true});
  }

  function installButton() {
    if (isWallboard) return;
    const heading = scheduleHeading();
    const existing = document.getElementById(BUTTON_ID);
    if (!heading) { if (existing) existing.remove(); return; }
    if (existing && existing.isConnected) return;
    const header = heading.parentElement && heading.parentElement.parentElement;
    if (!header) return;
    const btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.type = "button";
    btn.textContent = "Expand Across Screens";
    btn.title = "Display the same wide Driver Schedule across selected monitors";
    btn.onclick = showPicker;
    header.insertBefore(btn,header.lastElementChild);
  }

  async function showPicker() {
    if (typeof window.getScreenDetails !== "function") {
      alert("Use a recent Chrome version to use multi-monitor display.");
      return;
    }
    try {
      const details = await window.getScreenDetails();
      if (!details.screens || details.screens.length < 2) {
        alert("No extended monitors detected. Set Windows displays to Extend.");
        return;
      }
      showDialog(Array.from(details.screens));
    } catch (_) {
      alert("Allow window management for the ELX website in Chrome and retry.");
    }
  }

  function showDialog(screens) {
    let modal = document.getElementById(DIALOG_ID);
    if (!modal) {
      modal = document.createElement("div");
      modal.id = DIALOG_ID;
      modal.setAttribute("role","dialog");
      modal.setAttribute("aria-modal","true");
      modal.setAttribute("aria-label","Driver Schedule multi-screen");
      modal.innerHTML = '<div class="elx-wide-panel">' +
        '<h2>Driver Schedule — Multi-screen</h2>' +
        '<p>One continuous schedule layout, displayed across selected monitors. No Windows helper required.</p>' +
        '<div class="elx-wide-list"></div>' +
        '<p class="elx-wide-note">Chrome opens a coordinated window on each selected monitor. If Chrome blocks additional windows, use the Open remaining screen button.</p>' +
        '<p class="elx-wide-error" role="status" aria-live="polite"></p>' +
        '<div class="elx-wide-actions"><button type="button" class="elx-wide-cancel">Cancel</button>' +
        '<button type="button" class="elx-wide-open">Open wide view</button></div></div>';
      document.body.appendChild(modal);
      modal.querySelector(".elx-wide-cancel").onclick = () => modal.hidden = true;
      modal.onclick = e => { if (e.target === modal) modal.hidden = true; };
    }
    const list = modal.querySelector(".elx-wide-list");
    const info = modal.querySelector(".elx-wide-error");
    const launch = modal.querySelector(".elx-wide-open");
    list.replaceChildren();
    info.textContent = "";
    const ordered = screens.sort((a,b)=>a.left-b.left||a.top-b.top);
    const external = ordered.filter(s=>s.isInternal===false);
    const defaults = new Set(external.length>=2?external:ordered.slice(0,2));
    const checks = ordered.map((s,i)=>{
      const label = document.createElement("label");
      label.className = "elx-wide-screen";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = defaults.has(s);
      label.append(cb,document.createTextNode((s.label||"Display "+(i+1))+" — "+browserBounds(s).width+" × "+browserBounds(s).height));
      list.append(label);
      return {screen:s,cb};
    });
    const remaining = [];
    let selected = [];
    const sessionId = Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8);
    function setButton() {
      launch.disabled = remaining.length ? false : checks.filter(x=>x.cb.checked).length<2;
      launch.textContent = remaining.length?"Open remaining screen ("+remaining.length+")":"Open wide view";
    }
    checks.forEach(x=>x.cb.onchange=setButton);
    setButton();
    modal.hidden = false;

    launch.onclick = () => {
      if (!remaining.length) {
        selected = checks.filter(x=>x.cb.checked).map(x=>x.screen);
        remaining.push(...selected.map((screen,index)=>({screen,index})));
      }
      // Open windows synchronously inside the click; browsers sometimes allow
      // only one popup per click. Retain blocked displays for the next click.
      const widths = selected.map(x=>browserBounds(x).width);
      const blocked = [];
      for (const {screen,index} of remaining.splice(0)) {
        const b = browserBounds(screen);
        const url = new URL(location.href);
        url.searchParams.set(PARAM,"1");
        url.searchParams.set("elxDisplayIndex",String(index));
        url.searchParams.set("elxDisplayCount",String(selected.length));
        url.searchParams.set("elxDisplayId",sessionId);
        url.searchParams.set("elxDisplayWidths",widths.join(","));
        const popup = window.open(url.href,"ELX_Driver_Display_"+sessionId+"_"+index,
          "popup=yes,left="+Math.round(b.left)+",top="+Math.round(b.top)+
          ",width="+Math.round(b.width)+",height="+Math.round(b.height));
        if (!popup) {blocked.push({screen,index});continue;}
        try {popup.moveTo(Math.round(b.left),Math.round(b.top));popup.resizeTo(Math.round(b.width),Math.round(b.height));}
        catch (_) { /* Browser or Windows controls final placement. */ }
      }
      remaining.push(...blocked);
      if (remaining.length) {
        info.textContent = "Chrome blocked one or more windows. Click Open remaining screen, and allow pop-ups for ELX if asked.";
        setButton();
      } else modal.hidden = true;
    };
  }

  function init() {
    const style = document.createElement("style");
    style.textContent = [
      "#"+BUTTON_ID+"{margin-left:auto;background:#d71920;color:white;border:0;border-radius:7px;padding:10px 13px;font:600 12px system-ui;cursor:pointer;white-space:nowrap}",
      "#"+DIALOG_ID+"{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(5,10,20,.65);font:14px system-ui;color:#0f172a}",
      "#"+DIALOG_ID+"[hidden]{display:none}",
      "#"+DIALOG_ID+" .elx-wide-panel{background:white;width:min(520px,100%);max-height:90vh;overflow:auto;border-radius:13px;padding:24px;box-sizing:border-box}",
      "#"+DIALOG_ID+" h2{font-size:20px;font-weight:700;margin:0 0 10px}",
      "#"+DIALOG_ID+" p{line-height:1.5;color:#475569;margin:0 0 14px}",
      "#"+DIALOG_ID+" .elx-wide-list{display:grid;gap:9px;margin:15px 0}",
      "#"+DIALOG_ID+" .elx-wide-screen{display:flex;gap:10px;align-items:center;padding:11px;border:1px solid #cbd5e1;border-radius:8px}",
      "#"+DIALOG_ID+" .elx-wide-note{font-size:12px}",
      "#"+DIALOG_ID+" .elx-wide-error{color:#b91c1c;min-height:16px}",
      "#"+DIALOG_ID+" .elx-wide-actions{display:flex;justify-content:flex-end;gap:10px}",
      "#"+DIALOG_ID+" button{cursor:pointer;padding:10px 13px;border:1px solid #cbd5e1;background:white;border-radius:7px}",
      "#"+DIALOG_ID+" .elx-wide-open{background:#d71920;color:white;border-color:#d71920}",
      "#"+DIALOG_ID+" button:disabled{opacity:.5}"
    ].join("");
    document.head.appendChild(style);
    if (isWallboard) {
      setupWallboard();
    } else {
      installButton();
      const root = document.getElementById("root");
      if (root) new MutationObserver(installButton).observe(root,{childList:true,subtree:true});
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",init,{once:true});
  else init();
})();
