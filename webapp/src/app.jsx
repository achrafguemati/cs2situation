import ReactDOM from "react-dom/client";
import { useEffect, useState, useRef } from "react";
import "./App.css";
import PlayerCard from "./components/PlayerCard";
import Radar from "./components/Radar";
import SettingsButton from "./components/settings";
import MaskedIcon from "./components/maskedicon";
import BombTimer from "./components/bombtimer";

const CONNECTION_TIMEOUT = 5000;

const PORT = 22006;

/* Auto-detect so the same build works locally, over LAN, and through a tunnel:
   - local:  http://localhost:5173      -> ws://localhost:22006
   - LAN:    http://192.168.x.x:5173    -> ws://192.168.x.x:22006
   - tunnel: https://xxx.trycloudflare.com -> wss://xxx.trycloudflare.com:22006
   Set WS_HOST_OVERRIDE only if your websocket lives on a different host. */
const WS_HOST_OVERRIDE = "";

// Use the hostname of whatever URL opened this page, force wss on https pages
const WS_HOST = WS_HOST_OVERRIDE.trim() || window.location.hostname || "localhost";
const WS_PROTOCOL = window.location.protocol === "https:" ? "wss" : "ws";
// Path must match the bridge (usermode/src/dllmain.cpp) and the listener
const WEB_SOCKET_URL = `${WS_PROTOCOL}://${WS_HOST}:${PORT}/cs2situation`;

const DEFAULT_SETTINGS = {
  dotSize: 1,
  bombSize: 0.5,
  followSelf: true,
  showSelf: true,
  showEnemies: true,
  showTeammates: true,
  showBomb: true,
  showNames: true,
  showPanels: true,
  compactPanels: true,
  showLines: true,
  linesEnemiesOnly: true,
  lineDistance: 1200,
  showHp: true,
  showWeapon: true,
  showPlaces: true,
  showPlaceSummary: true,
  soundAlerts: true,
  mapFixedRot: 0,
  mapFlipX: false,
  showLivePlace: true,
  showDroppedC4: true,
  showPlantedC4: true,
  showBombBadge: true,
  autoFit: true,
  labelMode: "hover",
  dimTeammates: true,
  showArmor: true,
  showDefuser: true,
  fadeCallouts: true,
  radarOpacity: 1,
  enemySpotted: true,
};

const loadSettings = () => {
  try {
    const saved = localStorage.getItem("radarSettings");
    if (!saved) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

const loadViewAs = () => {
  const v = localStorage.getItem("radarViewAs");
  if (v === null || v === "" || v === "auto") return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

const App = () => {
  const [playerArray, setPlayerArray] = useState([]);
  const [mapData, setMapData] = useState();
  const [localTeam, setLocalTeam] = useState();
  const [bombData, setBombData] = useState();
  const [settings, setSettings] = useState(loadSettings());
  const [followIdx, setFollowIdx] = useState(null);
  // per-viewer identity: which player is "me" in THIS browser
  const [viewAs, setViewAs] = useState(loadViewAs);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUrls, setShareUrls] = useState([]);
  const [lastMsg, setLastMsg] = useState(0);
  const [staleSec, setStaleSec] = useState(0);
  const aimBeepRef = useRef(null);

  useEffect(() => {
    localStorage.setItem("radarViewAs", viewAs == null ? "auto" : String(viewAs));
  }, [viewAs]);

  useEffect(() => {
    fetch("http://localhost:22006/ip")
      .then((r) => r.json())
      .then((d) => setShareUrls(d.urls || []))
      .catch(() => setShareUrls([]));
  }, []);

  // Save settings to local storage whenever they change
  useEffect(() => {
    localStorage.setItem("radarSettings", JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    const onKey = (e) => {
      // ignore while typing in a dropdown/input
      const tag = e.target?.tagName;
      if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === 'f' || e.key === 'F') {
        if (!document.fullscreenElement) {
          document.getElementById("app-root")?.requestFullscreen?.();
        } else {
          document.exitFullscreen?.();
        }
      }
      if (e.key === 'm' || e.key === 'M') {
        const target = document.getElementById("radar-viewport");
        if (!target) return;
        if (document.fullscreenElement) {
          document.exitFullscreen?.();
        } else {
          target.requestFullscreen?.().catch(() => {});
        }
      }
      if (e.key === 'r' || e.key === 'R') {
        setSettings((s) => ({ ...s, mapFixedRot: (((s.mapFixedRot || 0) + 90) % 360) }));
      }
      if (e.key === 'Escape') setFollowIdx(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Stale-data watchdog (usermode crashed = frozen dots)
  useEffect(() => {
    const t = setInterval(() => {
      setStaleSec(lastMsg ? Math.floor((Date.now() - lastMsg) / 1000) : 0);
    }, 1000);
    return () => clearInterval(t);
  }, [lastMsg]);

  // Effective "self" = chosen player in this browser, else the real local player
  const viewAsPlayer = viewAs != null ? playerArray.find((p) => p.m_idx === viewAs) : null;
  const realLocal = playerArray.find((p) => p.m_is_local);
  const selfPlayer = viewAsPlayer || realLocal;
  const selfIdx = viewAsPlayer ? viewAsPlayer.m_idx : null;
  // Team used for enemy/friendly logic (spectator uses the chosen player's team)
  const effTeam = viewAsPlayer ? viewAsPlayer.m_team : localTeam;
  const localPlayer = selfPlayer;

  // If the picked player leaves the game, fall back to auto
  useEffect(() => {
    if (viewAs != null && playerArray.length > 0 && !viewAsPlayer) {
      setViewAs(null);
    }
  }, [viewAs, viewAsPlayer, playerArray.length]);

  const aliveT = playerArray.filter(p => p.m_team == 2 && !p.m_is_dead);
  const aliveCT = playerArray.filter(p => p.m_team == 3 && !p.m_is_dead);
  const moneyT = aliveT.reduce((s, p) => s + (p.m_money || 0), 0);
  const moneyCT = aliveCT.reduce((s, p) => s + (p.m_money || 0), 0);
  const fmtK = (v) => v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`;

  // Enemies aiming at me: view cone ±15° toward my position, within 2500 units
  const aimingAtMe = (() => {
    if (!localPlayer || localPlayer.m_is_dead) return [];
    const lx = localPlayer.m_position?.x, ly = localPlayer.m_position?.y;
    if (lx == null) return [];
    return playerArray.filter((p) => {
      if (p.m_is_dead || p.m_team == effTeam) return false;
      const px = p.m_position?.x, py = p.m_position?.y;
      if (px == null) return false;
      const dx = lx - px, dy = ly - py;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 2500 || dist < 1) return false;
      const viewDeg = ((90 - (p.m_eye_angle || 0)) * Math.PI) / 180;
      const dirx = Math.sin(viewDeg), diry = -Math.cos(viewDeg);
      // world y north vs radar y flip: use radar-space (x right, y down->negate dy)
      // world dy north+ ; radar dy down = -worldDy. view dir is radar-space.
      const rdx = dx, rdy = -dy;
      const len = Math.sqrt(rdx * rdx + rdy * rdy) || 1;
      const cos = (dirx * rdx + diry * rdy) / len;
      return cos > 0.966;
    });
  })();

  // Edge beep when someone starts aiming at me
  const aimingCount = aimingAtMe.length;
  useEffect(() => {
    if (!aimingCount || settings.soundAlerts === false) { aimBeepRef.current = aimingCount; return; }
    if ((aimBeepRef.current || 0) === 0) {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        [880, 880].forEach((f, i) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.connect(g); g.connect(ctx.destination);
          o.frequency.value = f;
          const t = ctx.currentTime + i * 0.18;
          g.gain.setValueAtTime(0.12, t);
          o.start(t);
          o.stop(t + 0.14);
        });
        setTimeout(() => ctx.close(), 600);
      } catch {}
    }
    aimBeepRef.current = aimingCount;
  }, [aimingCount]);

  useEffect(() => {
    const fetchData = async () => {
      const webSocketURL = WEB_SOCKET_URL;
      let webSocket = null;
      let connectionTimeout = null;

      try {
        webSocket = new WebSocket(webSocketURL);
      } catch (error) {
        const message_el = document.getElementsByClassName("radar_message")[0];
        if (message_el) message_el.textContent = `${error}`;
        return;
      }

      connectionTimeout = setTimeout(() => {
        webSocket.close();
      }, CONNECTION_TIMEOUT);

      webSocket.onopen = async () => {
        clearTimeout(connectionTimeout);
        console.info("connected to the web socket");
      };

      webSocket.onclose = async () => {
        clearTimeout(connectionTimeout);
        console.error("disconnected from the web socket");
      };

      webSocket.onerror = async (error) => {
        clearTimeout(connectionTimeout);
        const message_el = document.getElementsByClassName("radar_message")[0];
        if (message_el) {
          message_el.textContent = `Cannot reach the radar data server at ${webSocketURL}. Is usermode.exe running and npm dev up?`;
        }
        console.error(error);
      };

      webSocket.onmessage = async (event) => {
        const parsedData = JSON.parse(await event.data.text());
        setPlayerArray(parsedData.m_players);
        setLocalTeam(parsedData.m_local_team);
        setBombData(parsedData.m_bomb);
        setLastMsg(Date.now());

        const map = parsedData.m_map;
        if (map !== "invalid") {
          setMapData({
            ...(await (await fetch(`data/${map}/data.json`)).json()),
            name: map,
          });
          document.body.style.backgroundImage = `url(./data/${map}/background.png)`;
        }
      };
    };

    fetchData();
  }, []);

  return (
    <div id="app-root" className="w-screen h-[100dvh] flex flex-col overflow-hidden"
      style={{
        background: `radial-gradient(50% 50% at 50% 50%, rgba(20, 40, 55, 0.95) 0%, rgba(7, 20, 30, 0.95) 100%)`,
        backdropFilter: `blur(7.5px)`,
      }}
    >
      <div className={`flex-1 flex flex-col min-h-0 overflow-hidden relative`}>
          <button
            onClick={() => setShareOpen(!shareOpen)}
            className="absolute left-2.5 bottom-2.5 z-50 flex items-center gap-1 text-radar-primary text-sm bg-black/50 px-2 py-1.5 rounded-lg hover:bg-black/70"
            title="Share this radar to other devices / friends"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>
            Share
          </button>
          {shareOpen && (
            <div className="absolute left-2.5 bottom-14 z-50 w-72 bg-radar-panel/95 backdrop-blur-lg rounded-xl p-3 shadow-xl border border-radar-secondary/20 text-xs">
              <h4 className="text-radar-primary text-sm font-semibold mb-2">Open on another device</h4>
              <p className="text-radar-secondary mb-2">
                Same WiFi only. Each viewer picks their own player with "I am".
              </p>
              {shareUrls.length === 0 ? (
                <span className="text-radar-secondary">No LAN address found.</span>
              ) : (
                shareUrls.map((u) => (
                  <div key={u} className="flex items-center justify-between gap-2 mb-1.5">
                    <code className="text-[11px] text-emerald-300 truncate">{u}</code>
                    <button
                      onClick={() => navigator.clipboard?.writeText(u)}
                      className="shrink-0 text-[10px] bg-white/10 hover:bg-white/20 px-2 py-0.5 rounded"
                    >
                      Copy
                    </button>
                  </div>
                ))
              )}
              <p className="text-[10px] text-radar-secondary/70 mt-2">
                For internet sharing you must forward ports yourself - not recommended for account safety.
              </p>
            </div>
          )}

          {/* WHO AM I picker - left side, per viewer so shared links each pick their player */}
        <div className="absolute left-2.5 top-2.5 z-50">
          <div className="relative flex items-center gap-1.5 text-radar-primary text-sm bg-black/50 px-2 py-1 rounded-lg">
            <span className="text-[11px] uppercase tracking-widest opacity-60 shrink-0">I am</span>
            <select
              value={viewAs == null ? "auto" : String(viewAs)}
              onChange={(e) => {
                const v = e.target.value;
                setViewAs(v === "auto" ? null : parseInt(v, 10));
                setFollowIdx(null);
              }}
              className="bg-transparent text-radar-primary text-sm outline-none cursor-pointer max-w-[160px]"
              title="Choose which player you are in this browser"
            >
              <option value="auto">Auto (yellow = CS2 player)</option>
              {playerArray.map((p) => (
                <option key={p.m_idx} value={String(p.m_idx)}>
                  {p.m_name || p.m_idx} {p.m_is_dead ? "(dead)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={`absolute right-2.5 top-2.5 z-50 flex gap-2 items-center`}>
          <SettingsButton settings={settings} onSettingsChange={setSettings} />
        </div>

        {/* Fullscreen - icon only, bottom right */}
        <button
          onClick={() => {
            if (!document.fullscreenElement) {
              document.getElementById("app-root")?.requestFullscreen?.();
            } else {
              document.exitFullscreen?.();
            }
          }}
          className="absolute right-2.5 bottom-2.5 z-50 flex items-center justify-center w-9 h-9 text-radar-primary bg-black/50 rounded-lg hover:bg-black/70"
          title="Fullscreen (F)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" />
            <path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" />
          </svg>
        </button>

        {/* Alive bar T vs CT + economy */}
        {playerArray.length > 0 && (
          <div className="absolute left-1/2 -translate-x-1/2 top-2 z-40 pointer-events-none">
            <div className="flex items-center gap-2 bg-black/50 px-3 py-1 rounded-lg text-sm font-bold">
              <span className="text-orange-300">T {aliveT.length}</span>
              <span className="text-[11px] font-normal opacity-70 text-orange-200">{fmtK(moneyT)}</span>
              <span className="opacity-40">:</span>
              <span className="text-[11px] font-normal opacity-70 text-sky-200">{fmtK(moneyCT)}</span>
              <span className="text-sky-300">{aliveCT.length} CT</span>
            </div>
            {aimingCount > 0 && (
              <div className="mt-1 text-center text-sm font-bold text-red-400 bg-red-950/70 px-3 py-1 rounded-lg bomb-flash">
                ⚠ {aimingCount} AIMING AT YOU
              </div>
            )}
            {staleSec >= 2 && (
              <div className="mt-1 text-center text-xs font-bold text-yellow-300 bg-black/70 px-3 py-1 rounded-lg">
                NO DATA {staleSec}s - usermode crashed? Restart exe
              </div>
            )}
          </div>
        )}

        {bombData && bombData.m_blow_time > 0 && !bombData.m_is_defused && (
          <div className={`absolute left-1/2 -translate-x-1/2 top-11 flex-col items-center gap-1 z-50 pointer-events-none`}>
            <BombTimer bombData={bombData} localHasKit={!!localPlayer?.m_has_defuser} />
          </div>
        )}

        <div className={`flex-1 flex flex-col lg:flex-row items-center lg:items-center justify-center gap-1 p-1 min-h-0 overflow-hidden`}>
          {settings.showPanels !== false && (
          <ul id="terrorist" className="hidden md:flex flex-col gap-1 m-0 p-1 w-44 xl:w-52 shrink-0 overflow-hidden max-h-full justify-center">
            {playerArray
              .filter((player) => player.m_team == 2)
              .map((player) => (
                <PlayerCard
                  right={false}
                  key={player.m_idx}
                  playerData={player}
                  settings={settings}
                  followIdx={followIdx}
                  onFollow={setFollowIdx}
                  viewAsIdx={selfIdx}
                  mapData={mapData}
                  localTeam={effTeam}
                />
              ))}
          </ul>
          )}

          <div className="flex-1 flex items-center justify-center min-w-0 min-h-0 w-full h-full relative">
          {(playerArray.length > 0 && mapData && (
            <Radar
              playerArray={playerArray}
              radarImage={`./data/${mapData.name}/radar.png`}
              mapData={mapData}
              localTeam={effTeam}
              viewAsIdx={selfIdx}
              bombData={bombData}
              settings={settings}
              onSettingsChange={setSettings}
              followIdx={followIdx}
              onFollow={setFollowIdx}
              aimingIds={aimingAtMe.map(p => p.m_idx)}
            />
          )) || (
              <div id="radar" className={`relative overflow-hidden origin-center p-4 text-center`}>
                <h1 className="radar_message text-sm md:text-base">
                  Connected! Waiting for data from usermode
                </h1>
              </div>
            )}
            {followIdx !== null && (
              <button onClick={() => setFollowIdx(null)} className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[11px] bg-black/60 px-2 py-1 rounded" title="ESC to stop following">
                Following {playerArray.find(p => p.m_idx === followIdx)?.m_name || followIdx} • ESC to stop
              </button>
            )}
          </div>

          {settings.showPanels !== false && (
          <ul
            id="counterTerrorist"
            className="hidden md:flex flex-col gap-1 m-0 p-1 w-44 xl:w-52 shrink-0 overflow-hidden max-h-full justify-center"
          >
            {playerArray
              .filter((player) => player.m_team == 3)
              .map((player) => (
                <PlayerCard
                  right={true}
                  key={player.m_idx}
                  playerData={player}
                  settings={settings}
                  followIdx={followIdx}
                  onFollow={setFollowIdx}
                  viewAsIdx={selfIdx}
                  mapData={mapData}
                  localTeam={effTeam}
                />
              ))}
          </ul>
          )}

          {/* Mobile compact strip */}
          {settings.showPanels !== false && (
          <div className="md:hidden w-full shrink-0 overflow-x-auto flex gap-2 px-1 pb-1 text-xs">
            {playerArray
              .map((p) => (
              <div key={p.m_idx} className="flex items-center gap-1 bg-white/5 rounded px-2 py-1 whitespace-nowrap">
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.m_is_local ? '#ffff00' : (p.m_team == localTeam ? '#84c8ed' : 'red') }} />
                <span className="max-w-[80px] truncate">{p.m_name}</span>
                <span className="opacity-70">{p.m_health}hp</span>
              </div>
            ))}
          </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
