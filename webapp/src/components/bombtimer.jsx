import { useEffect, useRef } from "react";
import MaskedIcon from "./maskedicon";

const BombTimer = ({ bombData, localHasKit }) => {
  const lastSecRef = useRef(null);
  const beepedRef = useRef(false);

  const blow = bombData.m_blow_time || 0;
  const defuse = bombData.m_defuse_time || 0;
  const defusing = !!bombData.m_is_defusing;
  const defused = !!bombData.m_is_defused;

  const secs = Math.ceil(blow);
  const kit = !!localHasKit;
  const totalDefuse = kit ? 5 : 10;
  const willFinish = defuse <= blow;
  const progress = Math.max(0, Math.min(1, 1 - defuse / totalDefuse));
  const urgent = secs <= 10 || (defusing && defuse <= 2);

  useEffect(() => {
    if (blow <= 0) return;
    const isLast = secs <= 5;
    if (!isLast) { lastSecRef.current = secs; beepedRef.current = false; return; }
    if (lastSecRef.current === secs) return;
    lastSecRef.current = secs;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = defusing ? 1200 : 660;
      g.gain.setValueAtTime(0.12, ctx.currentTime);
      o.start();
      o.stop(ctx.currentTime + 0.15);
      o.onended = () => ctx.close();
    } catch {}
  }, [secs, defusing, blow]);

  if (defused) {
    return (
      <div className="flex items-center gap-2 bg-green-950/80 border border-green-500 px-3 py-1 rounded-lg text-sm font-bold text-green-300">
        BOMB DEFUSED
      </div>
    );
  }

  if (defusing) {
    return (
      <div className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg bg-black/70 border-2 min-w-[190px] ${willFinish ? `border-green-500` : `border-red-500`} bomb-flash`}>
        <div className="flex items-center gap-2">
          <MaskedIcon path={`./assets/icons/defuser.svg`} height={18} color={`bg-radar-green`} />
          <span className="text-[11px] font-bold tracking-widest text-green-300">DEFUSING</span>
          <span className={`text-[10px] px-1 rounded ${kit ? `bg-green-600/40 text-green-200` : `bg-red-600/40 text-red-200`}`}>
            {kit ? `KIT 5s` : `NO KIT 10s`}
          </span>
        </div>

        <div className={`text-3xl font-bold leading-none ${defuse <= 2 ? `text-red-400` : `text-green-300`}`}>
          {defuse.toFixed(1)}s
        </div>

        {/* progress bar */}
        <div className="w-full h-1.5 rounded bg-white/15 overflow-hidden">
          <div
            className={`h-full ${willFinish ? `bg-green-400` : `bg-red-400`}`}
            style={{ width: `${progress * 100}%`, transition: `width 100ms linear` }}
          />
        </div>

        <div className={`text-[11px] font-bold ${willFinish ? `text-green-300` : `text-red-400`}`}>
          {willFinish ? `SAFE - CLEARS IN ${defuse.toFixed(1)}s` : `TOO SLOW - BOMB BLOWS IN ${blow.toFixed(1)}s`}
        </div>
        <div className="text-[10px] opacity-60">blow {blow.toFixed(1)}s</div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center gap-1 px-3 py-1 rounded-lg bg-black/60 border ${urgent ? `border-red-500` : `border-white/10`}`}>
      <div className="flex items-center gap-2">
        <MaskedIcon path={`./assets/icons/c4_sml.png`} height={urgent ? 30 : 22} color={`bg-radar-secondary`} />
        <span className={urgent ? `text-2xl font-bold text-red-400` : `text-base`}>
          {blow.toFixed(1)}s
        </span>
      </div>
      {kit && <span className="text-[10px] text-green-300/80">defuse {totalDefuse}s (kit)</span>}
    </div>
  );
};

export default BombTimer;