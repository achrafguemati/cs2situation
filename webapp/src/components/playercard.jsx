import { useState, useEffect, useRef, useMemo } from "react";
import MaskedIcon from "./maskedicon";
import { playerColors, teamEnum, getRadarPosition } from "../utilities/utilities";
import { CALLOUTS } from "../utilities/callouts";

// player name -> last known character model. Survives pawn death and entity-slot
// recycling, which is what keeps a dead player's portrait from disappearing.
// Keyed by NAME, not m_steam_id: the backend sends m_steam_id as "0" for every
// player in CS2, and "0" is a truthy string, so a steam-id key would collapse all
// players onto one entry and hand them each other's faces.
const lastKnownModels = new Map();

const PlayerCard = ({ playerData, isOnRightSide, right, settings, followIdx, onFollow, viewAsIdx, mapData, localTeam }) => {
  const onRight = isOnRightSide ?? right ?? false;
  const compact = settings?.compactPanels !== false;

  // A dead pawn has no scene node, so the backend sends an empty m_model_name.
  // Remember the last one that worked. Entity slots (m_idx) get recycled on
  // respawn, so a card can remount with a fresh pawn before it has reported a
  // model - keying on m_idx would lose the portrait exactly when the player dies.
  const playerKey = `${playerData.m_name || ""}|${playerData.m_team}`;
  const modelName = useMemo(() => {
    // CS2 swaps a dead pawn's model to the spectator rig. It is a real string,
    // not an empty one, and there is no portrait for it - so it must never be
    // cached or displayed, only the last genuine character model.
    const live = playerData.m_model_name || "";
    const usable = live && !live.startsWith("cs_observer");
    if (usable) {
      lastKnownModels.set(playerKey, live);
      return live;
    }
    return lastKnownModels.get(playerKey) || "";
  }, [playerKey, playerData.m_model_name]);

  // Track images that 404 so a genuinely missing asset degrades to the fallback
  // instead of a broken-image glyph.
  const [imgBroken, setImgBroken] = useState(false);
  useEffect(() => {
    setImgBroken(false);
  }, [modelName]);

  const isLocal = viewAsIdx != null ? playerData.m_idx === viewAsIdx : !!playerData.m_is_local;
  const isFollowed = followIdx != null && playerData.m_idx === followIdx;

  const handleFollow = () => {
    if (!onFollow) return;
    if (isFollowed || isLocal) onFollow(null);
    else onFollow(playerData.m_idx);
  };

  // ENEMY SPOTTED on the card when this enemy enters a new named area.
  // Only real enemies: if localTeam is unknown (spectator / no pick yet) we must NOT
  // treat everyone as an enemy, or teammates would get the alert too.
  const knownTeam = localTeam === 2 || localTeam === 3;
  const isEnemy = !isLocal && knownTeam && playerData.m_team !== localTeam;
  const [spotted, setSpotted] = useState(null);
  const lastZoneRef = useRef(null);
  const spottedOn = settings?.enemySpotted !== false;

  useEffect(() => {
    if (!spottedOn || !isEnemy || !mapData?.name || !CALLOUTS[mapData.name]) return;

    const pos = getRadarPosition(mapData, playerData.m_position);
    if (!pos || (pos.x <= 0 && pos.y <= 0)) return;

    let zone = null;
    let bestDist = 0.11;
    for (const c of CALLOUTS[mapData.name]) {
      const d = Math.sqrt((pos.x - c.x) ** 2 + (pos.y - c.y) ** 2);
      if (d <= bestDist) { bestDist = d; zone = c; }
    }

    const zoneText = zone ? zone.text : null;
    if (playerData.m_is_dead) {
      lastZoneRef.current = null;
      setSpotted(null);
      return;
    }
    if (zoneText && lastZoneRef.current !== zoneText) {
      lastZoneRef.current = zoneText;
      setSpotted({ place: zoneText, at: Date.now() });
    } else if (!zoneText) {
      lastZoneRef.current = null;
    }
  }, [mapData, playerData.m_position, playerData.m_is_dead, isEnemy, spottedOn]);

  useEffect(() => {
    if (!spotted) return;
    const remaining = 6000 - (Date.now() - spotted.at);
    if (remaining <= 0) { setSpotted(null); return; }
    const timer = setTimeout(() => setSpotted(null), remaining);
    return () => clearTimeout(timer);
  }, [spotted]);

  return (
    <li
      onClick={handleFollow}
      title={isLocal ? `This is you` : isFollowed ? `Click to stop following` : `Click to follow ${playerData.m_name}`}
      style={{
        opacity: `${(playerData.m_is_dead && `0.62`) || `1`}`,
        border: isLocal ? `1px solid #ffff00` : isFollowed ? `1px solid #00e5ff` : `1px solid transparent`,
        borderRadius: `6px`,
        background: isLocal ? `rgba(255,255,0,0.07)` : isFollowed ? `rgba(0,229,255,0.08)` : `transparent`,
        cursor: `pointer`,
      }}
      className={`relative flex ${onRight && `flex-row-reverse`} gap-1 px-1 py-0.5 text-[11px] leading-tight hover:bg-white/5`}
    >
      <div className={`flex flex-col gap-0 justify-start items-center shrink-0 w-12 xl:w-14`}>
        <div
          className={`hover:cursor-pointer max-w-full truncate text-[10px] ${isLocal ? `text-[#ffff00] font-bold` : ``}`}
          title={playerData.m_name}
          onClick={() =>
            window.open(
              `https://steamcommunity.com/profiles/${playerData.m_steam_id}`,
              "_blank",
              "noopener,noreferrer"
            )
          }
        >
          {isLocal ? `YOU` : playerData.m_name}
        </div>
        <div
          className={`w-0 h-0 border-solid border-t-[6px] border-r-[5px] border-b-[6px] border-l-[5px]`}
          style={{
            borderColor: `${
              isLocal ? `#ffff00` : playerColors[playerData.m_color]
            } transparent transparent transparent`,
          }}
        ></div>
        {modelName && !imgBroken ? (
          <img
            className={`${compact ? `h-10 xl:h-12` : `h-16 xl:h-20`} w-auto object-contain transition-opacity duration-200 ${onRight && `scale-x-[-1]`} ${playerData.m_is_dead ? `opacity-30` : `opacity-100`}`}
            src={`./assets/characters/${modelName}.png`}
            loading="lazy"
            onError={() => setImgBroken(true)}
            alt=""
          />
        ) : (
          // No model name (dead pawn) or the asset 404s: show a neutral silhouette
          // instead of the browser's broken-image glyph.
          <div
            className={`${compact ? `h-10 xl:h-12` : `h-16 xl:h-20`} w-10 xl:w-14 rounded-md border border-white/10 bg-white/[0.03] flex items-center justify-center transition-opacity duration-200 ${playerData.m_is_dead ? `opacity-35` : `opacity-60`}`}
          >
            <svg viewBox="0 0 24 24" className="w-1/2 h-1/2" fill="currentColor" style={{ color: `rgba(255,255,255,0.35)` }}>
              <path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.2 0-7.5 2.2-7.5 5v1.5h15V19c0-2.8-3.3-5-7.5-5Z" />
            </svg>
          </div>
        )}

        {/* ENEMY SPOTTED - anchored to the OUTER edge of this player's card, so it
            stays on the player side and never overlaps the map radar.
            It must stay inside the card: the panel <ul> is overflow-hidden, so any
            box hanging outside gets clipped away entirely. */}
        {spotted && (
          <div
            className="absolute z-50 pointer-events-none"
            style={{
              top: `50%`,
              [onRight ? `right` : `left`]: 0,
              transform: `translateY(-50%)`,
            }}
          >
            <div
              className="whitespace-nowrap rounded-sm"
              style={{
                background: `rgba(60, 6, 6, 0.92)`,
                border: `1px solid rgba(255, 70, 70, 0.85)`,
                borderLeft: `3px solid #ff3b30`,
                padding: `3px 8px`,
                boxShadow: `0 2px 10px rgba(0,0,0,0.6)`,
              }}
            >
              <div style={{ fontSize: `9px`, fontWeight: 800, letterSpacing: `0.12em`, color: `#ff5c5c`, textTransform: `uppercase`, lineHeight: 1.2 }}>
                Enemy spotted
              </div>
              <div style={{ fontSize: `11px`, fontWeight: 600, color: `#ffd7d7`, lineHeight: 1.2 }}>
                {spotted.place}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className={`flex flex-col ${onRight && `items-end text-right`} justify-center gap-0.5 min-w-0 flex-1`}>
        <span className={`text-radar-green text-[10px]`}>${playerData.m_money}</span>

        <div className={`flex ${onRight && `flex-row-reverse`} gap-1.5 text-[10px]`}>
          <div className="flex gap-0.5 items-center">
            <MaskedIcon path={`./assets/icons/health.svg`} height={10} color={`bg-radar-secondary`} />
            <span className="text-radar-primary">{playerData.m_health}</span>
          </div>
          <div className="flex gap-0.5 items-center">
            <MaskedIcon path={`./assets/icons/${(playerData.m_has_helmet && `kevlar_helmet`) || `kevlar`}.svg`} height={10} color={`bg-radar-secondary`} />
            <span className="text-radar-primary">{playerData.m_armor}</span>
          </div>
        </div>

        {!compact && (
        <div className={`flex ${onRight && `flex-row-reverse`} gap-2 flex-wrap`}>
          {playerData.m_weapons && playerData.m_weapons.m_primary && (
            <MaskedIcon path={`./assets/icons/${playerData.m_weapons.m_primary}.svg`} height={20}
              color={`${(playerData.m_weapons.m_active == playerData.m_weapons.m_primary && `bg-radar-primary`) || `bg-radar-secondary`}`} />
          )}
          {playerData.m_weapons && playerData.m_weapons.m_secondary && (
            <MaskedIcon path={`./assets/icons/${playerData.m_weapons.m_secondary}.svg`} height={20}
              color={`${(playerData.m_weapons.m_active == playerData.m_weapons.m_secondary && `bg-radar-primary`) || `bg-radar-secondary`}`} />
          )}
        </div>
        )}

        {compact ? (
          <div className={`flex ${onRight && `flex-row-reverse`} gap-1 items-center text-[10px] opacity-80 truncate`}>
            <span className="truncate">{playerData.m_weapons?.m_primary || playerData.m_weapons?.m_secondary || ''}</span>
            {playerData.m_team == teamEnum.counterTerrorist && playerData.m_has_defuser && <span>🔧</span>}
            {playerData.m_team == teamEnum.terrorist && playerData.m_has_bomb && <span>💣</span>}
          </div>
        ) : (
        <div className={`flex flex-col relative`}>
          <div className={`flex ${onRight && `flex-row-reverse`} gap-2 mt-1 items-center flex-wrap`}>
            {playerData.m_weapons?.m_melee?.map((melee) => (
              <MaskedIcon key={melee} path={`./assets/icons/${melee}.svg`} height={20}
                color={`${(playerData.m_weapons.m_active == melee && `bg-radar-primary`) || `bg-radar-secondary`}`} />
            ))}
            {playerData.m_weapons?.m_utilities?.map((utility) => (
              <MaskedIcon key={utility} path={`./assets/icons/${utility}.svg`} height={20}
                color={`${(playerData.m_weapons.m_active == utility && `bg-radar-primary`) || `bg-radar-secondary`}`} />
            ))}
            {(playerData.m_team == teamEnum.counterTerrorist && playerData.m_has_defuser && (
              <MaskedIcon path={`./assets/icons/defuser.svg`} height={20} color={`bg-radar-secondary`} />
            )) ||
              (playerData.m_team == teamEnum.terrorist && playerData.m_has_bomb && (
                <MaskedIcon path={`./assets/icons/c4.svg`} height={20}
                  color={((playerData.m_weapons?.m_active) == `c4` && `bg-radar-primary`) || `bg-radar-secondary`} />
              ))}
          </div>
        </div>
        )}
      </div>
    </li>
  );
};

export default PlayerCard;
