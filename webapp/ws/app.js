import { WebSocketServer } from "ws";
import http from "http";
import os from "os";

console.log("web_server started")

const port = 22006;
const server = http.createServer();
const web_socket_server = new WebSocketServer(
    {
        // Must match the URL the C++ bridge dials (usermode/src/dllmain.cpp) and
        // the one the front end connects to (webapp/src/app.jsx).
        server: server, path: "/cs2situation"
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

server.on("request", (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Content-Type", "application/json");

    if (request.url === "/ip") {
        response.end(JSON.stringify({
            addresses: lan_addresses,
            urls: lan_addresses.map((address) => `http://${address}:5173`),
        }));
        return;
    }

    response.end(JSON.stringify({ status: "ok" }));
});

web_socket_server.on("connection", (web_socket, request) => {
    const client_address = request.socket.remoteAddress.replace("::ffff:", "");
    console.info(`${client_address} connected`);

    web_socket.on("message", (message) => {
        web_socket_server.clients.forEach((client) => {
            client.send(message);
        });
    });

    web_socket.on("close", () => {
        console.info(`${client_address} disconnected \n`);
    });

    web_socket.on("error", (error) => {
        console.error(error);
    });
});

server.listen(port);
console.info(`listening on port '${port}'`);
if (lan_addresses.length) {
    console.info(`open on other devices: http://${lan_addresses[0]}:5173`);
}