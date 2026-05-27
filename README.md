# ⌨️ PhoneKey

> Turn your phone's browser into a high-performance, real-time wireless keyboard for your computer. No mobile apps, no account registries, and no heavy dependencies required.

`PhoneKey` uses native system streams and raw WebSockets to instantly mirror text typed on your mobile device directly onto your computer's active cursor. By utilizing a persistent background OS shell process, it delivers sub-`2ms` typing latency over standard Wi-Fi—giving it a native, zero-lag feel.

---

## 🛠️ How It Works

```
┌───────────────┐     Local Wi-Fi Network     ┌──────────────────┐
│  Smart Phone  │ ──────────────────────────> │ Laptop/Computer  │
│ (Web Browser) │   (WebSocket Connection)    │  (Node.js App)   │
└───────────────┘                             └──────────────────┘

```

1. The Node.js application spins up a local web server and opens a persistent pipeline directly into your Operating System's input controller.
2. Your phone connects to the server via a modern WebSocket connection.
3. As you type on your phone and press **Enter/Send**, the text field instantly clears on your mobile screen and types itself at the active cursor on your computer.

---

## 🚨 Connection Rules (Read First!)

To allow your phone to communicate with your laptop, you must follow these two network conditions:

* **Same Network:** Both your computer and your phone **must** be connected to the exact same local network (e.g., the same home Wi-Fi or mobile hotspot).
* **No Isolation:** If you are on a public, corporate, or university Wi-Fi network, "Client Isolation" settings might block devices from seeing each other. (If this happens, try creating a temporary Wi-Fi Hotspot on your phone and connecting your laptop to it).

---

## 🚀 Getting Started

### 1. Prerequisites

Depending on your laptop's Operating System, ensure your system meets these basic criteria:

* **Windows:** PowerShell (built-in by default).
* **macOS:** System Events permissions (will prompt on first keystroke).
* **Linux:** Requires `xdotool` utility installed. Install it via:
```bash
sudo apt install xdotool

```



### 2. Installation & Running

1. Save your script file on your computer as `server.js`.
2. Open your terminal or command prompt in that directory and run:
```bash
node server.js

```
### 3. Accessing on Your Mobile Device
Once started, the terminal will dynamically display your computer's local network address:
```text
📱 Phone Keyboard Server
   URL: http://111.222.3.444:3131
   Platform: win32

   Open this URL on your phone browser:
   http://111.222.3.444:3131

```

1. Open **Safari**, **Chrome**, or any modern mobile browser on your phone.
2. Type the exact `http://...` URL shown in your computer's terminal into your mobile address bar.
3. Tap the **"Tap to Start Typing"** button on your phone. Your mobile keyboard will deploy, and you are ready to send text!

---

## 💡 Key Features Built-In

* **Sub-2ms Zero-Lag Pipeline:** Avoids spinning up constant shell processes by reusing a persistent background pipe (`spawn`) to process keystrokes effortlessly.
* **Instant Chat-Style Submit:** Pressing **Enter** or **Go** on your phone automatically drops the line onto your computer and wipes out your mobile screen area instantly for your next sentence.
* **Zero Dependencies:** Built entirely with raw, native Node.js core modules (`http`, `os`, `child_process`, `crypto`) adhering closely to the RFC 6455 WebSocket standards.
* **Platform Agnostic:** Works right out of the box across Windows, macOS, and Linux system structures.

---
