import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import os from "os";

console.log("web_server started")

const port = 22006;

// Bind to loopback by default so the feed and its control channel are not
// reachable from the network. Set CS2SITUATION_HOST=0.0.0.0 to share on LAN.
// Only expose it on a trusted network, and pair it with a real feed secret.
const host = process.env.CS2SITUATION_HOST || "127.0.0.1";

// Secret the C++ feeder must present before it may publish game data. Browsers
// connect as viewers only and can never publish. This is a DEV-ONLY default so
// localhost works out of the box; set CS2SITUATION_FEED_SECRET (bridge) and
// m_secret (usermode/config.json) to the same value before going on a network.
const DEFAULT_FEED_SECRET = "cs2situation-local-dev-secret";
const feed_secret = process.env.CS2SITUATION_FEED_SECRET || DEFAULT_FEED_SECRET;
if (feed_secret === DEFAULT_FEED_SECRET) {
    console.warn("WARNING: using the built-in dev feed secret. Anyone who can reach this port knows it. Set CS2SITUATION_FEED_SECRET (and m_secret in usermode/config.json) to a real value before exposing to a network.");
}

const server = http.createServer();
const web_socket_server = new WebSocketServer(
    {
        // Must match the URL the C++ bridge dials (usermode/src/dllmain.cpp) and
        // the one the front end connects to (webapp/src/app.jsx).
        server: server, path: "/cs2situation",
        maxPayload: 64 * 1024
    }
);

// LAN address so other devices on the same wifi can open the radar
// Skip virtual adapters (Docker/WSL/VMware/VirtualBox/Hyper-V) - other devices
// cannot reach them, so showing them is just noise.
const VIRTUAL_HINTS = ["vethernet", "hyper-v", "docker", "wsl", "vmware", "virtualbox", "loopback", "vpn", "tailscale", "zerotier"];
const lan_addresses = [];
for (const [name, infos] of Object.entries(os.networkInterfaces())) {
    const lower_name = name.toLowerCase();
    if (VIRTUAL_HINTS.some((hint) => lower_name.includes(hint))) continue;
    for (const info of infos || []) {
        if (info.family !== "IPv4" || info.internal) continue;
        if (lan_addresses.includes(info.address)) continue;
        lan_addresses.push(info.address);
    }
}

// Only answer cross-origin requests from the origins we actually serve,
// never "*".
const allowed_origins = new Set([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    ...lan_addresses.map((address) => `http://${address}:5173`),
]);

server.on("request", (request, response) => {
    const origin = request.headers.origin;
    if (origin && allowed_origins.has(origin)) {
        response.setHeader("Access-Control-Allow-Origin", origin);
        response.setHeader("Vary", "Origin");
    }
    response.setHeader("Content-Type", "application/json");

    if (request.url === "/ip") {
        // Only advertise LAN URLs when the bridge is actually reachable from
        // the network. Loopback-bound, sharing silently does not work, so do
        // not hand the frontend URLs that would fail.
        const exposed = host === "0.0.0.0";
        response.end(JSON.stringify({
            addresses: exposed ? lan_addresses : [],
            urls: exposed ? lan_addresses.map((address) => `http://${address}:5173`) : [],
        }));
        return;
    }

    response.end(JSON.stringify({ status: "ok" }));
});

web_socket_server.on("connection", (web_socket, request) => {
    const client_address = (request.socket.remoteAddress || "").replace("::ffff:", "");
    console.info(`${client_address} connected`);

    // A socket may publish only after presenting the feed secret. Viewers never
    // publish, so a browser cannot inject fake game state into every client.
    web_socket.isFeed = false;

    web_socket.on("message", (message) => {
        if (!web_socket.isFeed) {
            // Unauthenticated sockets may only send the feed-auth handshake.
            let parsed = null;
            try { parsed = JSON.parse(message.toString()); } catch { /* not JSON - ignore */ }
            if (parsed && parsed.type === "feed_auth" && parsed.token === feed_secret) {
                web_socket.isFeed = true;
                console.info(`${client_address} authenticated as feed`);
            } else {
                // Rate-limit this. An unauthenticated sender retries at the full
                // feed rate, which flooded the console and made real problems hard
                // to spot. First few are logged, then summarised once.
                web_socket.rejectCount = (web_socket.rejectCount || 0) + 1;
                if (web_socket.rejectCount <= 3) {
                    console.warn(`${client_address} attempted to publish without the feed secret - ignored`);
                } else if (web_socket.rejectCount === 4) {
                    console.warn(`${client_address} still unauthenticated - further attempts suppressed`);
                }
            }
            return;
        }

        // Authenticated feed: fan the raw payload out to every connected client.
        web_socket_server.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    });

    web_socket.on("close", () => {
        console.info(`${client_address} disconnected \n`);
    });

    web_socket.on("error", (error) => {
        console.error(error);
    });
});

server.listen(port, host);
console.info(`listening on ${host}:${port}`);
if (host === "0.0.0.0" && lan_addresses.length) {
    console.info(`open on other devices: http://${lan_addresses[0]}:5173`);
}
