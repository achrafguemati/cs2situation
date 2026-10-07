import { useRef, useEffect, useMemo, useState } from "react";
import Player from "./player";
import Bomb from "./bomb";
import { getRadarPosition } from "../utilities/utilities";
import { CALLOUTS } from "../utilities/callouts";

// Per-map spawn-side rotation. A flat "T = 0 / CT = 180" rule is wrong on maps whose
// spawns do not sit opposite each other, and the map textures carry only x/y/scale -
// no spawn positions - so nothing can be hardcoded reliably for all 17 maps.
//
// Instead it is MEASURED from live data (see measureSpawnRotation inside the
// component): at the start of a round every living player stands in their own spawn,
// so the vector between the two team centroids IS the spawn axis. Rotating by that
// puts our spawn at the bottom. Cached per map+team.
//
// Manual override lives in data/spawn_rotation.json - an entry there wins:
//   { "de_nuke": { "spawnSideRot": 90 } }
const spawnRotation = {};

// Plain promise, NOT a hook - module scope is correct here.
let spawnRotationLoad = null;
const loadSpawnRotation = () => {
  if (!spawnRotationLoad) {
    spawnRotationLoad = fetch("./data/spawn_rotation.json")
      .then((r) => (r.ok ? r.json() : {}))
      .then((d) => Object.assign(spawnRotation, d))
      .catch(() => {});
  }
  return spawnRotationLoad;
};

const Radar = ({
  playerArray,
  radarImage,
  mapData,
  localTeam,
  bombData,
  settings,
  onSettingsChange,
  followIdx,
  onFollow,
  aimingIds,
  viewAsIdx,
}) => {
  const radarImageRef = useRef();
  const viewportRef = useRef();
  const summaryStripRef = useRef();
  const lastBeepRef = useRef(0);
  // The chip strip only fades its edges when it actually overflows - a permanent
  // fade would dim the first chip on a short bar for no reason.
  const [chipsOverflow, setChipsOverflow] = useState(false);

  useEffect(() => {
    const el = summaryStripRef.current;
    if (!el) return;

    const update = () => setChipsOverflow(el.scrollWidth > el.clientWidth + 1);
    update();

    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [playerArray, mapData]);

  const zoom = 1;
  const followSelf = !!settings.followSelf;

  // "Self" = the player picked in this browser (I am...), else the real CS2 local player
  const viewAsPlayer = viewAsIdx != null ? playerArray.find((p) => p.m_idx === viewAsIdx) : null;
  const realLocal = playerArray.find((p) => p.m_is_local);
  const localPlayer = viewAsPlayer || realLocal;

  const followedPlayer = followIdx != null ? playerArray.find((p) => p.m_idx === followIdx) : null;
  const focusPlayer = followedPlayer || (followSelf ? localPlayer : null);
  const localPos = localPlayer ? getRadarPosition(mapData, localPlayer.m_position) : null;
  const focusPos = focusPlayer ? getRadarPosition(mapData, focusPlayer.m_position) : null;
  const hasValidLocal = localPos && !(localPos.x <= 0 && localPos.y <= 0);
  const hasValidFocus = focusPos && !(focusPos.x <= 0 && focusPos.y <= 0);
  // Fixed manual rotation (not auto). Set once to match your radar orientation.
  const fixedRot = settings.mapFixedRot || 0;

  // Spawn-side rotation: keeps YOUR spawn at the bottom of the radar, whichever
  // team you are on, and follows you automatically when you switch sides
  // (halftime, or picking a player on the other team in "I am").
  //
  // STATIC flip based on team, not view-angle following: it only changes when your
  // team changes, so dots never spin around. The angle is per map - spawns are not
  // opposite on every map - and comes from data/spawn_rotation.json.
  // Measure the spawn axis from live data. Works only while players are actually
  // in their spawns (round start), which is why it is cached per map+team - the
  // first successful measurement sticks and costs nothing afterwards.
  const measureSpawnRotation = () => {
    if (!mapData?.name || (localTeam !== 2 && localTeam !== 3)) return 0;

    const key = `${mapData.name}|${localTeam}`;
    if (spawnRotation[key] !== undefined) return spawnRotation[key];

    const mine = [];
    const theirs = [];
    for (const p of playerArray) {
      if (p.m_is_dead) continue;
      const pos = getRadarPosition(mapData, p.m_position);
      if (!pos || (pos.x <= 0 && pos.y <= 0)) continue;
      (p.m_team === localTeam ? mine : theirs).push(pos);
    }

    // Need players on both sides, and the two groups must be genuinely apart.
    // Mid-round everybody is scattered, so this only succeeds near round start.
    if (mine.length < 2 || theirs.length < 2) return 0;

    const avg = (list) => ({
      x: list.reduce((s, p) => s + p.x, 0) / list.length,
      y: list.reduce((s, p) => s + p.y, 0) / list.length,
    });
    const a = avg(mine);
    const b = avg(theirs);

    const dx = a.x - b.x;
    const dy = a.y - b.y;
    if (Math.hypot(dx, dy) < 0.15) return 0;

    // Angle that turns our spawn direction to point DOWN (+y) on the radar.
    // CSS rotate() is clockwise-positive and y grows downward, hence atan2(dx, dy).
    // Snapped to 90 degree steps because real spawn axes are axis-aligned.
    const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
    const snapped = (((Math.round(deg / 90) * 90) % 360) + 360) % 360;

    spawnRotation[key] = snapped;
    return snapped;
  };

  // Manual override from data/spawn_rotation.json wins over the measured value.
  const perMapRot = spawnRotation[mapData?.name]?.spawnSideRot ?? measureSpawnRotation();
  const teamSpawnRot = settings.spawnSideRotate === false ? 0 : perMapRot;
  const totalRot = (fixedRot + teamSpawnRot) % 360;

  // Kick off the override lookup from inside the component. The data arrives after
  // first paint, so bump a counter to re-render once it lands.
  const [, setSpawnRotLoaded] = useState(0);
  useEffect(() => {
    loadSpawnRotation().then(() => setSpawnRotLoaded((n) => n + 1));
  }, []);
  const flipX = !!settings.mapFlipX;
  const mapRot = 0;
  const rotOrigin = `center`;

  // Auto-fit: scale map to alive players bbox, crop empty places
  const autoFitOn = settings.autoFit !== false;
  let fitScale = 1;
  let fitOrigin = `center`;
  {
    const pts = [];
    playerArray.forEach((p) => {
      if (p.m_is_dead) return;
      const pos = getRadarPosition(mapData, p.m_position);
      if (!pos || (pos.x <= 0 && pos.y <= 0)) return;
      pts.push(pos);
    });
    if (autoFitOn && pts.length >= 2) {
      let minX = 1, maxX = 0, minY = 1, maxY = 0;
      pts.forEach((pos) => {
        if (pos.x < minX) minX = pos.x;
        if (pos.x > maxX) maxX = pos.x;
        if (pos.y < minY) minY = pos.y;
        if (pos.y > maxY) maxY = pos.y;
      });
      const spanX = Math.max(0.15, maxX - minX);
      const spanY = Math.max(0.15, maxY - minY);
      const span = Math.max(spanX, spanY);
      const PAD = 0.18;
      fitScale = Math.min(2.8, Math.max(1, 1 / (span + PAD * 2)));
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      fitOrigin = `${Math.min(0.9, Math.max(0.1, cx)) * 100}% ${Math.min(0.9, Math.max(0.1, cy)) * 100}%`;
      if (fitScale < 1.1) { fitScale = 1; fitOrigin = `center`; }
    }
  }

  const showLines = settings.showLines !== false;
  const linesEnemiesOnly = settings.linesEnemiesOnly !== false;
  const lineDistance = settings.lineDistance || 1200;

  const worldDist = (a, b) => {
    if (!a?.m_position || !b?.m_position) return Infinity;
    const dx = a.m_position.x - b.m_position.x;
    const dy = a.m_position.y - b.m_position.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const spectating = !!localPlayer?.m_is_dead;

  // Single source of truth for "does this player's dot render on the radar".
  // Used by the dot list AND by the bomb marker, so the C4 badge on a carrier's
  // dot and the standalone bomb marker can never both show at once.
  const dotVisible = (p) => {
    const isSelfHere = viewAsIdx != null
      ? p.m_idx === viewAsIdx
      : !!p.m_is_local;
    if (isSelfHere) return settings.showSelf !== false;
    if (spectating) return true;
    if (p.m_team != localTeam) return settings.showEnemies !== false;
    return settings.showTeammates !== false;
  };

  // Hide the map-level bomb marker while the carrier's own dot already shows the C4,
  // otherwise the standalone marker draws on top of the badge and you see two C4
  // icons stacked at the same spot.
  const bombCarrier = bombData?.m_state === `carried`
    ? playerArray.find((p) => p.m_has_bomb && !p.m_is_dead)
    : null;
  const hideWhenCarried = !!bombCarrier && dotVisible(bombCarrier);

  const nearbyLines = (showLines && localPlayer && hasValidLocal) ? playerArray.filter((p) => {
    if (p.m_is_local || p.m_is_dead) return false;
    const isTeammate = p.m_team == localTeam;
    // Spectating: keep the same rules as the dots - never hide someone the user turned off.
    if (!spectating) {
      if (linesEnemiesOnly && isTeammate) return false;
      if (!linesEnemiesOnly) {
        if (isTeammate && settings.showTeammates === false) return false;
        if (!isTeammate && settings.showEnemies === false) return false;
      }
    }
    return worldDist(p, localPlayer) <= lineDistance;
  }) : [];

  // Count ENEMIES ONLY per place: LIVE m_place if backend sends it, else static radius fallback
  const hasLivePlace = playerArray.some((p) => (p.m_place || "").trim() && (p.m_place || "").trim() !== "Unknown");
  const liveCounts = {};
  if (hasLivePlace) {
    playerArray.forEach((p) => {
      if (p.m_is_dead || p.m_is_local) return;
      if (p.m_team == localTeam) return;
      const place = (p.m_place || "").trim() || "Unknown";
      if (place === "Unknown") return;
      liveCounts[place] = (liveCounts[place] || 0) + 1;
    });
  }
  const liveEntries = Object.entries(liveCounts).sort((a, b) => b[1] - a[1]);
  // Static fallback (callout radius, enemies only).
  // Memoised: this is O(callouts x players) per tick, expensive at 10Hz.
  const PLACE_RADIUS = 0.09;
  const callouts = (mapData?.name && CALLOUTS[mapData.name]) || [];
  // One pass over (callouts x players) per tick. Derived counts are reused by the
  // map labels and the under-map chips; computing them inline per render was O(n*m)
  // per element and dominated CPU at 10Hz.
  const calloutState = useMemo(() => {
    if (!callouts.length) return [];
    const counts = callouts.map(() => ({ enemies: 0, me: false }));
    for (const p of playerArray) {
      if (p.m_is_dead) continue;
      const pos = getRadarPosition(mapData, p.m_position);
      if (!pos || (pos.x <= 0 && pos.y <= 0)) continue;
      const isMe = viewAsIdx != null ? p.m_idx === viewAsIdx : !!p.m_is_local;
      const isEnemy = !isMe && p.m_team != localTeam;
      for (let k = 0; k < callouts.length; k++) {
        const c = callouts[k];
        const dx = pos.x - c.x;
        const dy = pos.y - c.y;
        if (dx * dx + dy * dy <= PLACE_RADIUS * PLACE_RADIUS) {
          if (isMe) counts[k].me = true;
          else if (isEnemy) counts[k].enemies++;
          break;
        }
      }
    }
    return callouts.map((c, k) => ({ ...c, ...counts[k] }));
  }, [callouts, playerArray, mapData, localTeam, viewAsIdx]);

  const staticCounts = useMemo(
    () => (hasLivePlace ? [] : calloutState.filter((c) => c.enemies > 0)),
    [hasLivePlace, calloutState],
  );

  const totalEnemiesNamed = hasLivePlace
    ? liveEntries.reduce((s, [, n]) => s + n, 0)
    : staticCounts.reduce((s, c) => s + c.enemies, 0);

  // Scroll to keep followed player centered
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || !hasValidFocus || (!followedPlayer && !followSelf)) return;

    const contentW = vp.scrollWidth;
    const contentH = vp.scrollHeight;
    const targetX = focusPos.x * contentW - vp.clientWidth / 2;
    const targetY = focusPos.y * contentH - vp.clientHeight / 2;
    vp.scrollLeft = targetX;
    vp.scrollTop = targetY;
  }, [playerArray, followSelf, followedPlayer, hasValidFocus, focusPos?.x, focusPos?.y, zoom, mapData]);

  // Beep when enemy close to me (Web Audio, no file needed)
  useEffect(() => {
    if (settings.soundAlerts === false || !localPlayer) return;
    const now = Date.now();
    if (now - lastBeepRef.current < 2500) return;
    const closeEnemy = playerArray.some((p) => {
      if (p.m_is_local || p.m_is_dead || p.m_team == localTeam) return false;
      return worldDist(p, localPlayer) <= 800;
    });
    if (!closeEnemy) return;
    lastBeepRef.current = now;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.08, ctx.currentTime);
      o.start();
      o.stop(ctx.currentTime + 0.12);
      o.onended = () => ctx.close();
    } catch {}
  }, [playerArray]);

  return (
    <div className="flex flex-col items-center gap-1 w-full" style={{ maxWidth: `min(94vw,84vh)` }}>
    <div
      id="radar-viewport"
      ref={viewportRef}
      className={`relative overflow-hidden origin-center w-full aspect-square border border-white/10 rounded-lg bg-black/20 radar-map`}
      style={{ margin: `0 auto`, opacity: settings.radarOpacity ?? 1 }}
    >
      <div
        id="radar"
        className={`relative origin-top-left`}
        style={{
          width: `${zoom * 100}%`,
          minWidth: `100%`,
          transform: `${flipX ? `scaleX(-1) ` : ``}${totalRot ? `rotate(${totalRot}deg) ` : ``}${fitScale !== 1 ? `scale(${fitScale})` : ``}`.trim() || `none`,
          transformOrigin: fitScale !== 1 ? fitOrigin : `center`,
          transition: `transform 200ms linear`,
        }}
      >
        <img ref={radarImageRef} className={`w-full h-auto select-none`} src={radarImage} draggable={false} />

        {/* Static place names - fade when no enemy near (clean mode) */}
        {settings.showPlaces !== false && calloutState.map((c, i) => {
          const near = c.enemies;
          const meNear = c.me;
          const fade = settings.fadeCallouts !== false && near === 0 && !meNear;
          return (
          <div
            key={`callout-${i}`}
            className="absolute pointer-events-none select-none"
            style={{
              left: `${c.x * 100}%`,
              top: `${c.y * 100}%`,
              transform: `translate(-50%,-50%) rotate(${-totalRot}deg) scaleX(${flipX ? -1 : 1})`,
              fontSize: `0.52vw`,
              fontWeight: 600,
              letterSpacing: `0.14em`,
              textTransform: `uppercase`,
              color: near > 0 ? `#ff8a8a` : meNear ? `#9fd0ff` : `rgba(165,195,220,0.75)`,
              textShadow: `0 1px 2px #000, 0 0 6px rgba(0,0,0,0.9)`,
              background: `transparent`,
              border: `none`,
              padding: `0`,
              whiteSpace: `nowrap`,
              opacity: fade ? 0 : 1,
              transition: `opacity 200ms`,
              zIndex: 1,
            }}
          >
            {c.text}
          </div>
          );
        })}

        {/* Lines to nearby players */}
        {nearbyLines.length > 0 && (
          <svg className="absolute left-0 top-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ zIndex: 5 }}>
            {nearbyLines.map((p) => {
              const pos = getRadarPosition(mapData, p.m_position);
              if (!pos || (pos.x <= 0 && pos.y <= 0)) return null;
              const isTeammate = p.m_team == localTeam;
              return (
                <line
                  key={`line-${p.m_idx}`}
                  x1={localPos.x * 100} y1={localPos.y * 100}
                  x2={pos.x * 100} y2={pos.y * 100}
                  stroke={isTeammate ? "#84c8ed" : "#ff3333"}
                  strokeWidth={0.6}
                  strokeDasharray="2 1"
                  opacity={0.9}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {/* ring around me when lines on */}
            <circle cx={localPos.x * 100} cy={localPos.y * 100} r={3} fill="none" stroke="#ffff00" strokeWidth={0.5} opacity={0.8} />
          </svg>
        )}

        {(() => {
          // spectating (declared above) = "me" is dead: show every player at full
          // visibility, even if Show teammates / Show enemies is off.
          const visible = playerArray.filter(dotVisible);
          // Cluster stacked dots: assign label stack index so names don't overlap
          const posCache = new Map();
          visible.forEach((p) => {
            const pos = getRadarPosition(mapData, p.m_position);
            posCache.set(p.m_idx, pos || { x: -1, y: -1 });
          });
          const stackIdx = new Map();
          visible.forEach((p) => {
            const pos = posCache.get(p.m_idx);
            let idx = 0;
            visible.forEach((q) => {
              if (q.m_idx >= p.m_idx) return;
              const qp = posCache.get(q.m_idx);
              if (!qp || qp.x <= 0 || pos.x <= 0) return;
              const d = Math.sqrt((qp.x - pos.x) ** 2 + (qp.y - pos.y) ** 2);
              if (d < 0.035) idx++;
            });
            stackIdx.set(p.m_idx, idx);
          });
          return visible.map((player) => (
          <Player
            key={player.m_idx}
            playerData={player}
            mapData={mapData}
            radarImage={radarImageRef.current}
            localTeam={localTeam}
            settings={settings}
            isFollowed={followIdx != null && player.m_idx === followIdx}
            onFollow={onFollow}
            fixedRot={totalRot}
            flipX={flipX}
            labelStack={stackIdx.get(player.m_idx) || 0}
            isAimingAtMe={!!aimingIds?.includes(player.m_idx)}
            isViewAs={viewAsIdx != null && player.m_idx === viewAsIdx}
            viewAsActive={viewAsIdx != null}
            spectating={spectating}
          />
          ));
        })()}

        {bombData && settings.showBomb !== false && (
          <Bomb
            bombData={bombData}
            mapData={mapData}
            radarImage={radarImageRef.current}
            localTeam={localTeam}
            settings={settings}
            hideWhenCarried={hideWhenCarried}
          />
        )}
      </div>

      {/* Map overlay controls - inside the map so they show in map fullscreen */}
      <div className="absolute top-2 left-2 z-50 flex gap-1.5 map-ctl">
        <button
          onClick={() =>
            onSettingsChange({ ...settings, mapFixedRot: (((settings.mapFixedRot || 0) + 90) % 360) })
          }
          className="map-ctl-btn"
          title={`Rotate map 90 (now ${fixedRot} deg) - R`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <polyline points="21 3 21 9 15 9" />
          </svg>
        </button>
      </div>

      <div className="absolute top-2 right-2 z-50 flex gap-1.5 map-ctl">
        <button
          onClick={() => {
            if (document.fullscreenElement) {
              document.exitFullscreen?.();
            } else {
              viewportRef.current?.requestFullscreen?.().catch(() => {});
            }
          }}
          className="map-ctl-btn"
          title="Fullscreen the map only - M"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" />
            <path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" />
          </svg>
        </button>
      </div>
    </div>
    {/* Enemy summary bar - sits OUTSIDE the map box, directly under it, so it
        never paints over the map artwork and never resizes the square map. */}
    <div className="w-full pointer-events-none flex justify-center">
    {settings.showPlaceSummary !== false && (() => {
      const chips = hasLivePlace
        ? liveEntries.map(([place, n]) => ({ label: place, n }))
        : staticCounts
            .slice()
            .sort((a, b) => b.enemies - a.enemies)
            .map((c) => ({ label: c.text, n: c.enemies }));

      const totalEnemyAlive = playerArray.filter(
        (p) => !p.m_is_dead && p.m_team != localTeam
      ).length;

      const maxN = Math.max(...chips.map((c) => c.n), 1);
      const inAreas = chips.reduce((s, c) => s + c.n, 0);
      const outside = Math.max(0, totalEnemyAlive - inAreas);

      // Heat ramp. How red a chip is driven purely by how many enemies sit there,
      // so the eye lands on the hot spots first without needing a legend.
      const heat = (n, isMax) => {
        if (n >= 4)
          return { fg: `#ff5a5a`, border: `rgba(255,90,90,0.55)`, bg: `rgba(150,20,20,0.42)` };
        if (n === 3)
          return { fg: `#ff8a4c`, border: `rgba(255,138,76,0.45)`, bg: `rgba(140,48,16,0.34)` };
        if (n === 2)
          return { fg: `#ffb257`, border: `rgba(255,178,87,0.34)`, bg: `rgba(110,60,14,0.26)` };
        // Singletons stay muted, but the leading chip keeps a little extra pop so
        // the bar still has a focal point when every area holds exactly one enemy.
        return isMax && maxN > 1
          ? { fg: `#ffd08a`, border: `rgba(255,208,138,0.34)`, bg: `rgba(120,80,25,0.24)` }
          : { fg: `#ffdca8`, border: `rgba(255,220,168,0.2)`, bg: `rgba(255,255,255,0.045)` };
      };

      const cap = totalEnemyAlive > 0
        ? { text: `Threat`, pip: `hot` }
        : { text: `Clear`, pip: `clear` };

      if (!chips.length) {
        return (
          <div className="summary-shell">
            <span className="summary-cap">
              <span className={`summary-pip ${cap.pip}`} />
              {cap.text}
            </span>
            <span className="flex items-baseline gap-1.5 min-w-0 text-[11px] xl:text-xs">
              {totalEnemyAlive > 0 ? (
                <>
                  <span className="font-semibold text-red-300/90 whitespace-nowrap">
                    {totalEnemyAlive} enemy{totalEnemyAlive > 1 ? `ies` : `y`} alive
                  </span>
                  <span className="text-white/25">|</span>
                  <span className="text-white/40 truncate">outside known areas</span>
                </>
              ) : (
                <span className="font-semibold text-emerald-300/80 tracking-wide whitespace-nowrap">
                  No enemies alive
                </span>
              )}
            </span>
          </div>
        );
      }

      return (
        <div className="summary-shell">
          <span className="summary-cap">
            <span className={`summary-pip ${cap.pip}`} />
            {cap.text}
          </span>

          {/* Chips stay on one line and scroll instead of wrapping: a second row
              would push the square map and shrink it. The wrapper is
              pointer-events-none so the bar never blocks clicking a dot; only the
              strip itself is interactive so it can be scrolled. */}
          <div
            ref={summaryStripRef}
            className={`flex items-center gap-1.5 min-w-0 flex-1 overflow-x-auto overflow-y-hidden summary-scroll pointer-events-auto${chipsOverflow ? ` summary-strip` : ``}`}
          >
            {chips.map((c, i) => {
              const t = heat(c.n, c.n === maxN);
              return (
                <span key={`chip-${i}`} className="summary-chip"
                  style={{ borderColor: t.border, background: t.bg, color: t.fg }}
                  title={`${c.label}: ${c.n} enemy${c.n > 1 ? `ies` : `y`}`}
                >
                  <span className="summary-chip-label">{c.label}</span>
                  <span className="summary-chip-count" style={{ color: t.fg }}>{c.n}</span>
                </span>
              );
            })}
            {outside > 0 && (
              <span className="summary-chip elsewhere" title={`${outside} enemy${outside > 1 ? `ies` : `y`} outside known areas`}>
                +{outside} elsewhere
              </span>
            )}
          </div>
        </div>
      );
    })()}
    </div>
    </div>
  );
};

export default Radar;
