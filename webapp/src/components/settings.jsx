import { useState } from "react";

const Toggle = ({ label, checked, onChange }) => (
  <div className="flex justify-between items-center pt-1">
    <span className="text-radar-secondary text-sm">{label}</span>
    <input
      type="checkbox"
      checked={!!checked}
      onChange={(e) => onChange(e.target.checked)}
      className="w-4 h-4 accent-radar-primary cursor-pointer"
    />
  </div>
);

const SettingsButton = ({ settings, onSettingsChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const set = (patch) => onSettingsChange({ ...settings, ...patch });

  const resetAll = () => {
    localStorage.removeItem("radarSettings");
    window.location.reload();
  };

  const cleanMode = () => {
    localStorage.removeItem("radarSettings");
    onSettingsChange({
      ...settings,
      labelMode: "hover",
      dimTeammates: true,
      fadeCallouts: true,
      showLines: false,
      showPlaces: true,
      showPlaceSummary: true,
      autoFit: true,
      radarOpacity: 1,
      dotSize: 1.3,
      mapFixedRot: 0,
      mapFlipX: false,
    });
  };

  return (
    <div className="z-50">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 transition-all rounded-xl"
      >
        <img className={`w-[1.3rem]`} src={`./assets/icons/cog.svg`} />
        <span className="text-radar-primary">Settings</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-radar-panel/90 backdrop-blur-lg rounded-xl p-4 shadow-xl border border-radar-secondary/20 max-h-[70vh] overflow-auto">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-radar-primary text-lg font-semibold">Radar Settings</h3>
            <div className="flex gap-2">
              <button onClick={cleanMode} className="text-xs text-radar-primary underline" title="Hide labels, dim teammates, fade empty callouts, no lines">Clean mode</button>
              <button onClick={resetAll} className="text-xs text-radar-secondary underline">Reset</button>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-radar-secondary text-sm">Player size</span>
                <span className="text-radar-primary text-sm font-mono">{settings.dotSize}x</span>
              </div>
              <input
                type="range"
                min="1"
                max="2"
                step="0.1"
                value={settings.dotSize}
                onChange={(e) => set({ dotSize: parseFloat(e.target.value) })}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-radar-primary"
                style={{
                  background: `linear-gradient(to right, #b1d0e7 ${((settings.dotSize - 1) / 1) * 100}%, rgba(59, 130, 246, 0.2) ${((settings.dotSize - 1) / 1) * 100}%)`
                }}
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-radar-secondary text-sm">Bomb size</span>
                <span className="text-radar-primary text-sm font-mono">{settings.bombSize}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="1.5"
                step="0.1"
                value={settings.bombSize}
                onChange={(e) => set({ bombSize: parseFloat(e.target.value) })}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-radar-primary"
                style={{
                  background: `linear-gradient(to right, #b1d0e7 ${((settings.bombSize - 0.5) / 1) * 100}%, rgba(59, 130, 246, 0.2) ${((settings.bombSize - 0.5) / 1) * 100}%)`
                }}
              />
            </div>

            <div className="border-t border-white/10 pt-2 space-y-1">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-radar-secondary text-sm">Dot labels</span>
                  <span className="text-radar-primary text-sm font-mono">{settings.labelMode}</span>
                </div>
                <div className="flex gap-1">
                  {["off", "hover", "always"].map((m) => (
                    <button key={m} onClick={() => set({ labelMode: m })}
                      className={`flex-1 text-[11px] py-1 rounded ${settings.labelMode === m ? `bg-radar-primary text-[#0b1b26] font-bold` : `bg-white/5 text-radar-secondary`}`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <Toggle label="Dim teammates" checked={settings.dimTeammates} onChange={(v) => set({ dimTeammates: v })} />
              <Toggle label="Only show relevant places" checked={settings.fadeCallouts} onChange={(v) => set({ fadeCallouts: v })} />
              <Toggle label="Armor on label" checked={settings.showArmor} onChange={(v) => set({ showArmor: v })} />
              <Toggle label="Defuser icon" checked={settings.showDefuser} onChange={(v) => set({ showDefuser: v })} />
              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-radar-secondary text-sm">Radar opacity</span>
                  <span className="text-radar-primary text-sm font-mono">{Math.round((settings.radarOpacity ?? 1) * 100)}%</span>
                </div>
                <input
                  type="range" min="0.3" max="1" step="0.05"
                  value={settings.radarOpacity ?? 1}
                  onChange={(e) => set({ radarOpacity: parseFloat(e.target.value) })}
                  className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-radar-primary"
                />
              </div>
            </div>

            <div className="border-t border-white/10 pt-2 space-y-1">
              <Toggle label="Follow me" checked={settings.followSelf} onChange={(v) => set({ followSelf: v })} />
              <Toggle label="Highlight me yellow" checked={settings.showSelf} onChange={(v) => set({ showSelf: v })} />
              <Toggle label="Show teammates" checked={settings.showTeammates} onChange={(v) => set({ showTeammates: v })} />
              <Toggle label="Show enemies" checked={settings.showEnemies} onChange={(v) => set({ showEnemies: v })} />
              <Toggle label="Show bomb" checked={settings.showBomb} onChange={(v) => set({ showBomb: v })} />
<Toggle label="Dropped C4 marker" checked={settings.showDroppedC4} onChange={(v) => set({ showDroppedC4: v })} />
        
        <Toggle label="Planted C4 marker" checked={settings.showPlantedC4} onChange={(v) => set({ showPlantedC4: v })} />
              <Toggle label="C4 badge on carrier" checked={settings.showBombBadge} onChange={(v) => set({ showBombBadge: v })} />
              <Toggle label="Side panels" checked={settings.showPanels} onChange={(v) => set({ showPanels: v })} />
              <Toggle label="Compact panels" checked={settings.compactPanels} onChange={(v) => set({ compactPanels: v })} />
              <Toggle label="Places A/B/Long" checked={settings.showPlaces} onChange={(v) => set({ showPlaces: v })} />
              <Toggle label="Enemy spotted alerts" checked={settings.enemySpotted} onChange={(v) => set({ enemySpotted: v })} />
              <Toggle label="Summary under map" checked={settings.showPlaceSummary} onChange={(v) => set({ showPlaceSummary: v })} />
              <Toggle label="Near-enemy beep" checked={settings.soundAlerts} onChange={(v) => set({ soundAlerts: v })} />
              <Toggle label="Auto-fit players" checked={settings.autoFit} onChange={(v) => set({ autoFit: v })} />
              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-radar-secondary text-sm">Map rotation fixed</span>
                  <span className="text-radar-primary text-sm font-mono">{settings.mapFixedRot || 0}°</span>
                </div>
                <input
                  type="range" min="0" max="270" step="90"
                  value={settings.mapFixedRot || 0}
                  onChange={(e) => set({ mapFixedRot: parseInt(e.target.value) })}
                  className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-radar-primary"
                />
              </div>
              <Toggle label="Mirror map (flip)" checked={settings.mapFlipX} onChange={(v) => set({ mapFlipX: v })} />
            </div>

            <div className="border-t border-white/10 pt-2 space-y-1">
              <Toggle label="Lines to near me" checked={settings.showLines} onChange={(v) => set({ showLines: v })} />
              <Toggle label="Lines enemies only" checked={settings.linesEnemiesOnly} onChange={(v) => set({ linesEnemiesOnly: v })} />
              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-radar-secondary text-sm">Near distance</span>
                  <span className="text-radar-primary text-sm font-mono">{settings.lineDistance}</span>
                </div>
                <input
                  type="range" min="400" max="3000" step="100"
                  value={settings.lineDistance}
                  onChange={(e) => set({ lineDistance: parseInt(e.target.value) })}
                  className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-radar-primary"
                />
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsButton;
