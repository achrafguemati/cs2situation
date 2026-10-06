import { useRef, useState, useEffect } from "react";
import { getRadarPosition, playerColors } from "../utilities/utilities";


let playerRotations = [];
const calculatePlayerRotation = (playerData) => {
  // 90 (not 270) - radar Y is flipped, so the view angle is inverted.
  const playerViewAngle = 90 - playerData.m_eye_angle;
  const idx = playerData.m_idx;

  playerRotations[idx] = (playerRotations[idx] || 0) % 360;
  playerRotations[idx] +=
    ((playerViewAngle - playerRotations[idx] + 540) % 360) - 180;

  return playerRotations[idx];
};

const Player = ({
  playerData, mapData, radarImage, localTeam, settings,
  isFollowed, onFollow, fixedRot = 0, flipX = false, labelStack = 0,
  isAimingAtMe = false, isViewAs = false, viewAsActive = false,
  spectating = false,
}) => {
  const [lastKnownPosition, setLastKnownPosition] = useState(null);
  const [hovered, setHovered] = useState(false);
  const radarPosition = getRadarPosition(mapData, playerData.m_position) || { x: 0, y: 0 };
  const invalidPosition = radarPosition.x <= 0 && radarPosition.y <= 0;

  const playerRef = useRef();
  const playerRotation = calculatePlayerRotation(playerData);

  // Use LAYOUT size (offsetWidth/Height), NOT getBoundingClientRect().
  // getBoundingClientRect returns post-transform size, so the rotate/auto-fit
  // transform on #radar would get applied twice and scatter the dots.
  const mapW = radarImage?.offsetWidth || 0;
  const mapH = radarImage?.offsetHeight || 0;

  const dotPx = Math.max(6, Math.min(46, (mapW || 600) * 0.016 * (settings.dotSize || 1)));
  const selfDotPx = dotPx * (playerData.m_is_local || isViewAs ? 1.3 : 1);
  // If the viewer picked a specific player, ONLY that player is "you".
  // Otherwise fall back to the real CS2 local player.
  const isSelf = viewAsActive ? isViewAs : !!playerData.m_is_local;
  const isTeammate = isSelf ? false : playerData.m_team == localTeam;
  const showSelf = settings.showSelf !== false;
  const highlightSelf = isSelf && showSelf;
  const hp = Math.max(0, Math.min(100, playerData.m_health || 0));
  const hpColor = hp > 50 ? `#7CFC00` : hp > 20 ? `#FFD700` : `#FF5555`;
  const isLowHp = !playerData.m_is_dead && hp <= 20 && hp > 0;
  const followed = !!isFollowed;

  // CLEAN MODE: dim teammates so enemies pop
  // Spectating (I am dead): never dim, everything shows at full strength.
  const dimTeammates = settings.dimTeammates !== false && !spectating;
  const dimmed = dimTeammates && isTeammate && !isSelf && !followed && !playerData.m_is_dead;
  const dotOpacity = playerData.m_is_dead ? 0.75 : dimmed ? 0.35 : 1;

  // LABEL MODE: off | hover | always  (clean default = hover)
  // Spectating must NEVER force labels on - it only affects which players are drawn.
  const labelMode = settings.labelMode || "hover";
  const showLabel =
    labelMode === "always" ||
    (labelMode === "hover" && (hovered || highlightSelf || followed || isAimingAtMe || isLowHp));
  const labelScale = labelMode === "off" ? 0.85 : 1;

  const handleClick = (e) => {
    e.stopPropagation();
    if (!onFollow) return;
    if (followed || isSelf) onFollow(null);
    else onFollow(playerData.m_idx);
  };

  useEffect(() => {
    if (playerData.m_is_dead) {
      if (!lastKnownPosition) {
        setLastKnownPosition(radarPosition);
      }
    } else {
      setLastKnownPosition(null);
    }
  }, [playerData.m_is_dead, radarPosition, lastKnownPosition]);

  const effectivePosition = playerData.m_is_dead ? lastKnownPosition || { x: 0, y: 0 } : radarPosition;

  const dotSizePx = (viewAsActive ? isViewAs : playerData.m_is_local) && (settings.showSelf !== false)
    ? selfDotPx : dotPx;

  const radarImageTranslation = {
    x: mapW * effectivePosition.x - dotSizePx * 0.5,
    y: mapH * effectivePosition.y - dotSizePx * 0.5,
  };

  const dotColor = highlightSelf ? `#ffff00`
    : isAimingAtMe ? `#ff2200`
    : isTeammate ? playerColors[playerData.m_color] || `#84c8ed`
    : `#ff3b30`;

  return (
    <div
      className={`absolute origin-center left-0 top-0 ${isLowHp ? `lowhp-pulse` : ``}`}
      ref={playerRef}
      onClick={handleClick}
      title={isSelf ? `This is you (in this browser) - click to stop` : `Click to follow ${playerData.m_name} (ESC to stop)`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: `${dotSizePx}px`,
        height: `${dotSizePx}px`,
        transform: `translate(${radarImageTranslation.x}px, ${radarImageTranslation.y}px)`,
        transition: `transform 100ms linear`,
        zIndex: `${highlightSelf ? 30 : isAimingAtMe ? 25 : followed ? 20 : isLowHp ? 15 : playerData.m_is_dead ? 1 : dimmed ? 2 : isTeammate ? 3 : 10}`,
        WebkitMask: `${(playerData.m_is_dead && `url('./assets/icons/icon-enemy-death_png.png') no-repeat center / contain`) || `none`}`,
        cursor: `pointer`,
      }}
    >
      {/* C4 carrier badge - sits on the dot, does not rotate with the aim arrow */}
      {playerData.m_has_bomb && !playerData.m_is_dead && settings.showBomb !== false && settings.showBombBadge !== false && (
        <div
          className={`absolute pointer-events-none bomb-carry`}
          style={{
            right: `${-Math.round(dotSizePx * 0.55)}px`,
            top: `${-Math.round(dotSizePx * 0.55)}px`,
            width: `${Math.max(11, Math.round(dotSizePx * 0.85))}px`,
            height: `${Math.max(11, Math.round(dotSizePx * 0.85))}px`,
            borderRadius: `50%`,
            background: `rgba(8,14,20,0.9)`,
            border: `1px solid #ff9f0a`,
            boxShadow: `0 0 7px rgba(255,159,10,0.9)`,
            zIndex: 50,
          }}
          title={`${playerData.m_name} has the C4`}
        >
          <div
            style={{
              width: `100%`,
              height: `100%`,
              background: `#ffb43a`,
              WebkitMask: `url('./assets/icons/c4.svg') no-repeat center / 74%`,
              mask: `url('./assets/icons/c4.svg') no-repeat center / 74%`,
            }}
          />
        </div>
      )}

      {/* HP arc ring */}
      {!playerData.m_is_dead && (
        <svg className="absolute left-0 top-0 w-full h-full pointer-events-none" viewBox="0 0 36 36" style={{ transform: `rotate(-90deg)` }}>
          <circle cx="18" cy="18" r="16" fill="rgba(0,0,0,0.5)" stroke="rgba(0,0,0,0.75)" strokeWidth="4" opacity={dotOpacity} />
          <circle cx="18" cy="18" r="16" fill="none" stroke={highlightSelf ? "#ffff00" : isAimingAtMe ? "#ff2200" : hpColor}
            strokeWidth="3.5" strokeLinecap="round" opacity={dotOpacity}
            strokeDasharray={`${(hp / 100) * 100.5} 100.5`} />
        </svg>
      )}

      {/* rotating arrow */}
      <div style={{
        transform: `rotate(${(playerData.m_is_dead && 0) || playerRotation}deg)`,
        width: `${dotSizePx}px`,
        height: `${dotSizePx}px`,
        opacity: dotOpacity,
        transition: `transform 100ms linear`,
      }}>
        <div className={`w-full h-full`} style={{
          backgroundColor: dotColor,
          clipPath: `polygon(50% 0%, 100% 100%, 50% 78%, 0% 100%)`,
          filter: `${(highlightSelf && `drop-shadow(0 0 4px #ffff00)`) || (isAimingAtMe && `drop-shadow(0 0 6px #ff2200)`) || `drop-shadow(0 0 2px rgba(0,0,0,0.9))`}`,
        }} />

        {showLabel && (
          <div style={{
            position: `absolute`,
            top: `calc(100% + ${labelStack * 20}px)`,
            left: `50%`,
            transform: `translateX(-50%) scale(${labelScale}) rotate(${-(playerRotation + fixedRot)}deg) scaleX(${flipX ? -1 : 1})`,
            transformOrigin: `top center`,
            fontSize: `${Math.max(8, Math.min(14, dotPx * 0.42))}px`,
            lineHeight: `1.15`,
            color: highlightSelf ? `#ffff00` : isAimingAtMe ? `#ff5544` : `#e8f2f8`,
            textShadow: `0 1px 2px #000`,
            whiteSpace: `nowrap`,
            pointerEvents: `none`,
            textAlign: `center`,
            background: `rgba(4,10,16,0.75)`,
            border: `1px solid rgba(255,255,255,0.08)`,
            padding: `1px 5px`,
            borderRadius: `5px`,
            marginTop: `3px`,
            zIndex: 40,
          }}>
            <div style={{ fontWeight: 700 }}>
              {isAimingAtMe ? `⚠ ` : ``}{highlightSelf ? `YOU` : followed ? `◉ ${playerData.m_name}` : playerData.m_name}
              {playerData.m_has_bomb ? ` 💣` : ``}
              {playerData.m_is_dead ? ` ☠` : ``}
            </div>
            <div style={{ display: `flex`, gap: `5px`, justifyContent: `center` }}>
              <span style={{ color: hpColor, fontWeight: 700 }}>{hp}</span>
              {settings.showArmor !== false && <span style={{ opacity: 0.75 }}>{playerData.m_armor}ap</span>}
              {playerData.m_weapons?.m_active && <span style={{ opacity: 0.85 }}>{playerData.m_weapons.m_active}</span>}
              {settings.showDefuser !== false && playerData.m_has_defuser && <span>🔧</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Player;