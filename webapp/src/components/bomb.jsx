import { useRef } from "react";
import { getRadarPosition } from "../utilities/utilities";

// Three visually distinct C4 markers driven by m_state:
//   carried  - orange, sits on the carrier (hidden here when that dot is visible)
//   dropped  - yellow, pulsing beacon so you spot the loose bomb
//   planted  - red, flashing, pairs with the bomb timer panel
const STATE_STYLE = {
  carried: { color: `#ff9f0a`, glow: `rgba(255,159,10,0.9)`, label: `C4` },
  dropped: { color: `#ffd60a`, glow: `rgba(255,214,10,0.9)`, label: `DROPPED` },
  planted: { color: `#ff3b30`, glow: `rgba(255,59,48,0.9)`, label: `PLANTED` },
};

const Bomb = ({ bombData, mapData, radarImage, settings = {}, hideWhenCarried = false }) => {
  const bombRef = useRef();

  const state = bombData.m_state || `dropped`;
  if (state === `carried` && hideWhenCarried) return null;
  if (state === `dropped` && settings.showDroppedC4 === false) return null;
  if (state === `planted` && settings.showPlantedC4 === false) return null;

  const radarPosition = getRadarPosition(mapData, bombData);
  if (!radarPosition || (radarPosition.x <= 0 && radarPosition.y <= 0)) return null;

  const bombBounding = (bombRef.current &&
    bombRef.current.getBoundingClientRect()) || { width: 0, height: 0 };

  const radarImageBounding = (radarImage &&
    radarImage.getBoundingClientRect()) || { width: 0, height: 0 };
  const radarImageTranslation = {
    x: radarImageBounding.width * radarPosition.x - bombBounding.width * 0.5,
    y: radarImageBounding.height * radarPosition.y - bombBounding.height * 0.5,
  };

  const style = STATE_STYLE[state] || STATE_STYLE.dropped;
  const baseSize = 1.5; // Base size in vw
  const scaledSize = baseSize * (settings.bombSize ?? 1);
  const defused = !!bombData.m_is_defused;
  const color = defused ? `#50904c` : style.color;
  const glow = defused ? `rgba(80,144,76,0.9)` : style.glow;
  const beacon = state !== `carried`;

  return (
    <div
      className={`absolute left-0 top-0`}
      ref={bombRef}
      style={{
        width: `${scaledSize}vw`,
        height: `${scaledSize}vw`,
        transform: `translate(${radarImageTranslation.x}px, ${radarImageTranslation.y}px)`,
        pointerEvents: `none`,
        zIndex: `1`,
      }}
      title={defused ? `Bomb defused` : `C4 ${state}`}
    >
      {/* pulse ring - makes dropped/planted readable at a glance */}
      {beacon && !defused && (
        <div
          className={`absolute inset-0 rounded-full bomb-beacon`}
          style={{ border: `2px solid ${color}`, boxShadow: `0 0 8px ${glow}` }}
        />
      )}

      <div
        className={`absolute inset-0 rounded-full`}
        style={{
          backgroundColor: color,
          boxShadow: `0 0 6px ${glow}`,
          WebkitMask: `url('./assets/icons/c4.svg') no-repeat center / contain`,
          mask: `url('./assets/icons/c4.svg') no-repeat center / contain`,
        }}
      />

      {(state === `dropped` || state === `planted`) && !defused && (
        <div
          className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[8px] font-bold tracking-widest`}
          style={{
            top: `100%`,
            marginTop: `1px`,
            color: color,
            textShadow: `0 1px 3px #000, 0 0 6px rgba(0,0,0,0.9)`,
          }}
        >
          {style.label}
        </div>
      )}
    </div>
  );
};

export default Bomb;
