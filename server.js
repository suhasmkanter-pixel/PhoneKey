#!/usr/bin/env node
const http = require("http");
const os = require("os");
const { execSync, spawn } = require("child_process");
const crypto = require("crypto");

const platform = os.platform();

// ─── Batched key queue & Persistent Pipe ──────────────────────────────────────
let keyQueue = [];
let flushTimer = null;

// Start a single, persistent PowerShell process in the background (Windows only)
let psProcess = null;
if (platform === "win32") {
  psProcess = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", "-"], {
    stdio: ["pipe", "ignore", "ignore"],
    windowsHide: true
  });
  // Initialize the scripting object once on startup
  psProcess.stdin.write("$wsh = New-Object -ComObject WScript.Shell;\n");
}

const WIN_SPECIAL_MAP = {
  backspace: "{BACKSPACE}", enter: "{ENTER}", space: " ",
  tab: "{TAB}", escape: "{ESC}",
  arrowleft: "{LEFT}", arrowright: "{RIGHT}",
  arrowup: "{UP}", arrowdown: "{DOWN}",
};

function escapeWinKey(char) {
  return /[+^%~(){}[\]]/.test(char) ? `{${char}}` : char;
}

function flushQueue() {
  if (!keyQueue.length) return;
  const batch = keyQueue.join("");
  keyQueue = [];
  try {
    if (platform === "win32" && psProcess) {
      const escaped = [...batch].map(escapeWinKey).join("").replace(/'/g, "''");
      // Instantly push keys into the running process (No lag!)
      psProcess.stdin.write(`$wsh.SendKeys('${escaped}');\n`);
    } else if (platform === "linux") {
      execSync(`xdotool type --clearmodifiers -- ${JSON.stringify(batch)}`);
    } else if (platform === "darwin") {
      const escaped = batch.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      execSync(`osascript -e 'tell application "System Events" to keystroke "${escaped}"'`);
    }
  } catch (e) {
    console.error("flush error:", e.message);
  }
}

function typeKey(key) {
  for (const char of key) keyQueue.push(char);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushQueue, 10); // Low 10ms delay for snappier feedback
}

function pressSpecial(action) {
  flushQueue(); // Flush pending chars first
  try {
    if (platform === "win32" && psProcess) {
      const k = WIN_SPECIAL_MAP[action.toLowerCase()];
      if (k) psProcess.stdin.write(`$wsh.SendKeys('${k}');\n`);
    } else if (platform === "linux") {
      const map = { backspace:"BackSpace", enter:"Return", space:"space", tab:"Tab", escape:"Escape", arrowleft:"Left", arrowright:"Right", arrowup:"Up", arrowdown:"Down" };
      const k = map[action.toLowerCase()];
      if (k) execSync(`xdotool key ${k}`);
    } else if (platform === "darwin") {
      const map = { backspace: "delete", enter: "return", space: "space", tab: "tab", escape: "escape" };
      const k = map[action.toLowerCase()];
      if (k) {
        execSync(`osascript -e 'tell application "System Events" to keystroke ${k}'`);
      } else {
        const arrowMap = { arrowleft: 123, arrowright: 124, arrowup: 126, arrowdown: 125 };
        const code = arrowMap[action.toLowerCase()];
        if (code) execSync(`osascript -e 'tell application "System Events" to key code ${code}'`);
      }
    }
  } catch (e) {
    console.error("pressSpecial error:", e.message);
  }
}

// Ensure background process is killed cleanly when server stops
process.on("exit", () => { if (psProcess) psProcess.kill(); });

// ─── WebSocket (raw RFC 6455, no deps) ────────────────────────────────────────
const clients = new Set();

function wsHandshake(req, socket) {
  const key = req.headers["sec-websocket-key"];
  const accept = crypto.createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  clients.add(socket);
  console.log(`[+] Phone connected (${clients.size} active)`);

  let buf = Buffer.alloc(0);

  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let payloadLen = buf[1] & 0x7f;
      let offset = 2;
      if (payloadLen === 126) { payloadLen = buf.readUInt16BE(2); offset = 4; }
      else if (payloadLen === 127) { payloadLen = Number(buf.readBigUInt64BE(2)); offset = 10; }
      if (buf.length < offset + (masked ? 4 : 0) + payloadLen) break;
      let payload;
      if (masked) {
        const mask = buf.slice(offset, offset + 4); offset += 4;
        payload = Buffer.alloc(payloadLen);
        for (let i = 0; i < payloadLen; i++) payload[i] = buf[offset + i] ^ mask[i % 4];
      } else {
        payload = buf.slice(offset, offset + payloadLen);
      }
      buf = buf.slice(offset + payloadLen);
      if (opcode === 8) { socket.destroy(); break; }
      if (opcode === 1 || opcode === 2) {
        try { handleMessage(JSON.parse(payload.toString())); } catch {}
      }
    }
  });

  socket.on("close", () => { clients.delete(socket); console.log("[-] Phone disconnected"); });
  socket.on("error", () => clients.delete(socket));
}

function handleMessage(msg) {
  if (msg.type === "key") typeKey(msg.value);
  else if (msg.type === "special") pressSpecial(msg.value);
}

// ─── HTTP server ──────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(PHONE_UI);
  } else {
    res.writeHead(404); res.end();
  }
});

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/ws") wsHandshake(req, socket);
  else socket.destroy();
});

const PORT = 3131;
server.listen(PORT, "0.0.0.0", () => {
  const ifaces = os.networkInterfaces();
  let ip = "localhost";
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) { ip = iface.address; break; }
    }
  }
  const url = `http://${ip}:${PORT}`;
  console.log("\n📱 Phone Keyboard Server");
  console.log(`   URL: ${url}`);
  console.log(`   Platform: ${platform}`);
  if (platform === "linux") console.log("   Requires: xdotool (sudo apt install xdotool)");
  if (platform === "win32") console.log("   Requires: PowerShell (built-in)");
  console.log("\n   Open this URL on your phone browser:");
  console.log(`   ${url}\n`);
});

// ─── Phone UI ─────────────────────────────────────────────────────────────────
const PHONE_UI = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>Phone Keyboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0d0d0d; --surface: #1a1a1a; --border: #2a2a2a;
    --accent: #00e676; --text: #f0f0f0; --muted: #555; --red: #ff5252;
  }
  body {
    background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    min-height: 100dvh; display: flex; flex-direction: column;
  }
  header {
    padding: 14px 18px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;
  }
  .brand { font-size: 13px; font-weight: 700; letter-spacing: 0.12em; color: var(--accent); text-transform: uppercase; }
  .status { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--muted); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--red); transition: all 0.3s; }
  .dot.on { background: var(--accent); box-shadow: 0 0 8px var(--accent); }

  .input-wrap { flex: 1; display: flex; flex-direction: column; padding: 16px; gap: 12px; }
  .label { font-size: 10px; letter-spacing: 0.12em; color: var(--muted); text-transform: uppercase; }

  textarea {
    flex: 1; background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; color: var(--text); font-size: 18px; line-height: 1.6;
    padding: 14px 16px; resize: none; outline: none; font-family: inherit;
    caret-color: var(--accent); min-height: 200px;
  }
  textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(0,230,118,0.08); }
  textarea::placeholder { color: var(--muted); }

  .actions { display: flex; gap: 8px; flex-shrink: 0; }
  .btn {
    flex: 1; padding: 13px 8px; border-radius: 10px; border: 1px solid var(--border);
    background: var(--surface); color: var(--text); font-size: 13px; font-weight: 600;
    font-family: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent;
    display: flex; align-items: center; justify-content: center; gap: 5px;
  }
  .btn:active { opacity: 0.75; }
  .btn.primary { background: var(--accent); color: #000; border-color: var(--accent); font-weight: 700; }
  .btn.danger { color: var(--red); }

  .stats { display: flex; gap: 16px; padding: 10px 16px; border-top: 1px solid var(--border); font-size: 11px; color: var(--muted); flex-shrink: 0; }
  .stat span { color: var(--text); font-weight: 600; }

  .offline-bar { display: none; background: #1a0a0a; border-top: 1px solid #3a1a1a; padding: 10px 16px; font-size: 12px; color: var(--red); text-align: center; }
  .offline-bar.show { display: block; }

  .tap-hint {
    position: fixed; inset: 0; background: var(--bg); z-index: 10;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px;
    transition: opacity 0.2s ease;
  }
  .tap-hint.hidden { opacity: 0; pointer-events: none; display: none; }
  .tap-icon { font-size: 56px; animation: pulse 1.8s ease-in-out infinite; }
  @keyframes pulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.1);opacity:0.7} }
  .tap-hint h2 { font-size: 20px; font-weight: 700; }
  .tap-hint p { font-size: 13px; color: var(--muted); text-align: center; padding: 0 32px; line-height: 1.5; }
  .tap-btn { margin-top: 8px; padding: 14px 40px; border-radius: 50px; background: var(--accent); color: #000; font-size: 15px; font-weight: 700; border: none; font-family: inherit; cursor: pointer; }
</style>
</head>
<body>

<header>
  <span class="brand">⌨ PhoneKey</span>
  <span class="status">
    <span class="dot" id="dot"></span>
    <span id="statusText">connecting…</span>
  </span>
</header>

<div class="tap-hint" id="tapHint">
  <div class="tap-icon">📱</div>
  <h2>Phone Keyboard</h2>
  <p>Type here — keystrokes go to wherever your cursor is on the laptop. Use your own keyboard.</p>
  <button class="tap-btn" id="tapBtn">Tap to Start Typing</button>
</div>

<div class="input-wrap">
  <span class="label">Type here → appears on laptop at cursor</span>
  <textarea id="box" placeholder="Type here, press 'Enter' or 'Send' to submit..."
    autocomplete="off" autocorrect="on" autocapitalize="sentences" spellcheck="true"
  ></textarea>
  <div class="actions">
    <button class="btn danger" id="clearBtn">🗑 Clear</button>
    <button class="btn primary" id="sendBtn">⬆ Send All</button>
  </div>
</div>

<div class="stats">
  <div class="stat">chars <span id="charCount">0</span></div>
  <div class="stat">words <span id="wordCount">0</span></div>
</div>

<div class="offline-bar" id="offlineBar">⚠ Disconnected — reconnecting…</div>

<script>
const HOST = location.hostname;
const PORT = location.port || 80;
let ws, reconnectTimer;
let lastSent = "";

function connect() {
  ws = new WebSocket('ws://' + HOST + ':' + PORT + '/ws');
  ws.onopen = () => {
    document.getElementById("dot").classList.add("on");
    document.getElementById("statusText").textContent = "connected";
    document.getElementById("offlineBar").classList.remove("show");
  };
  ws.onclose = () => {
    document.getElementById("dot").classList.remove("on");
    document.getElementById("statusText").textContent = "reconnecting…";
    document.getElementById("offlineBar").classList.add("show");
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 2000);
  };
  ws.onerror = () => ws.close();
}
connect();

function send(type, value) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type, value }));
}

// Instant Mobile Keyboard Hook
document.getElementById("tapBtn").addEventListener("click", (e) => {
  e.preventDefault();
  const box = document.getElementById("box");
  box.focus();
  document.getElementById("tapHint").classList.add("hidden");
});

const box = document.getElementById("box");

function triggerMessageSubmit() {
  const text = box.value;
  if (!text) return;

  // Sync remaining characters before submitting
  if (text.length > lastSent.length && text.startsWith(lastSent)) {
    const added = text.slice(lastSent.length);
    for (const char of added) {
      if (char !== "\\n") send("key", char);
    }
  }
  
  // Submit line break to target layout
  send("special", "enter");
  
  // Flush local viewport
  box.value = "";
  lastSent = "";
  updateStats("");
}

box.addEventListener("input", (e) => {
  const current = box.value;
  
  // Intercept newline insertions from mobile keyboard action
  if (current.endsWith("\\n")) {
    // Remove newline char locally before submitting cleaner batch
    box.value = current.slice(0, -1);
    triggerMessageSubmit();
    return;
  }

  updateStats(current);
  const prev = lastSent;

  if (current.length > prev.length && current.startsWith(prev)) {
    const added = current.slice(prev.length);
    for (const char of added) {
      send("key", char);
    }
  } else if (current.length < prev.length && prev.startsWith(current)) {
    const deleted = prev.length - current.length;
    for (let i = 0; i < deleted; i++) send("special", "backspace");
  } else {
    for (let i = 0; i < prev.length; i++) send("special", "backspace");
    for (const char of current) {
      send("key", char);
    }
  }

  lastSent = current;
});

// Handle physical desktop keyboards or external keyboard layouts hitting enter
box.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    triggerMessageSubmit();
  }
});

document.getElementById("clearBtn").addEventListener("click", () => {
  box.value = ""; lastSent = ""; updateStats("");
});

document.getElementById("sendBtn").addEventListener("click", () => {
  triggerMessageSubmit();
  const btn = document.getElementById("sendBtn");
  btn.textContent = "✓ Sent!";
  setTimeout(() => btn.textContent = "⬆ Send All", 1200);
});

function updateStats(text) {
  document.getElementById("charCount").textContent = text.length;
  document.getElementById("wordCount").textContent = text.trim() ? text.trim().split(/\\s+/).length : 0;
}
</script>
</body>
</html>`;
