import { useState } from "react";
import { Check, Plus } from "lucide-react";

type Breakpoint = "L" | "M" | "S";
type PaddingMode = "single" | "axis" | "individual";

const DesignPanel = () => {
  const [checked, setChecked] = useState(false);
  const [breakpoints, setBreakpoints] = useState<Breakpoint[]>(["L"]);
  const [activeBreakpoint, setActiveBreakpoint] = useState<Breakpoint>("L");
  const [gap, setGap] = useState(0);
  const [paddingMode, setPaddingMode] = useState<PaddingMode>("single");
  const [paddingSingle, setPaddingSingle] = useState(0);
  const [paddingValues, setPaddingValues] = useState({ T: 0, R: 0, B: 0, L: 0 });

  const allBreakpoints: Breakpoint[] = ["L", "M", "S"];

  const addBreakpoint = () => {
    const next = allBreakpoints.find((b) => !breakpoints.includes(b));
    if (next) {
      setBreakpoints((prev) => [...prev, next]);
    }
  };

  const handleGapInput = (val: string) => {
    const num = parseInt(val);
    if (!isNaN(num) && num >= 0 && num <= 100) setGap(num);
    else if (val === "") setGap(0);
  };

  const handlePaddingInput = (key: keyof typeof paddingValues, val: string) => {
    const num = parseInt(val);
    if (!isNaN(num) && num >= 0) {
      setPaddingValues((prev) => ({ ...prev, [key]: num }));
    } else if (val === "") {
      setPaddingValues((prev) => ({ ...prev, [key]: 0 }));
    }
  };

  return (
    <div className="w-[320px] rounded-xl bg-panel p-4 flex flex-col gap-4 font-sans select-none">
      {/* Breakpoints Row */}
      <div className="flex items-center gap-2">
        <button
          onClick={addBreakpoint}
          disabled={breakpoints.length >= 3}
          className="flex-1 h-9 rounded-full bg-panel-input px-4 text-sm text-muted-foreground text-left hover:opacity-80 transition-opacity disabled:opacity-40"
        >
          Add Breakpoints...
        </button>
        <button
          onClick={() => setChecked((c) => !c)}
          className={`h-9 w-9 rounded-full bg-panel-input flex items-center justify-center transition-opacity hover:opacity-80 ${
            checked ? "text-panel-check" : "text-muted-foreground"
          }`}
        >
          {checked && <Check size={16} strokeWidth={2.5} />}
          {!checked && (
            <div className="w-4 h-4 rounded border-2 border-current" />
          )}
        </button>
      </div>

      {/* Type Row */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-foreground w-[60px]">Type</span>
        <div className="flex rounded-lg overflow-hidden bg-panel-input flex-1 ml-3">
          {breakpoints.map((t) => (
            <button
              key={t}
              onClick={() => setActiveBreakpoint(t)}
              className={`h-8 flex-1 text-sm font-medium transition-colors ${
                activeBreakpoint === t
                  ? "bg-panel-toggle-active text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Gap Row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 w-[60px]">
          <Plus size={12} className="text-muted-foreground" />
          <span className="text-sm text-foreground">Gap</span>
        </div>
        <div className="flex items-center gap-3 flex-1 ml-3">
          <input
            type="text"
            value={gap}
            onChange={(e) => handleGapInput(e.target.value)}
            className="w-16 h-8 rounded-lg bg-panel-input text-center text-sm text-foreground outline-none border-none"
          />
          <div className="flex-1 relative flex items-center">
            <input
              type="range"
              min={0}
              max={100}
              value={gap}
              onChange={(e) => setGap(Number(e.target.value))}
              className="panel-slider w-full"
            />
          </div>
        </div>
      </div>

      {/* Padding Row */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-foreground w-[60px]">Padding</span>
          <div className="flex items-center gap-1 flex-1 ml-3">
            <input
              type="text"
              value={paddingSingle}
              onChange={(e) => {
                const num = parseInt(e.target.value);
                if (!isNaN(num) && num >= 0) setPaddingSingle(num);
                else if (e.target.value === "") setPaddingSingle(0);
              }}
              className="flex-1 h-8 rounded-lg bg-panel-input text-center text-sm text-foreground outline-none border-none"
            />
            <button
              onClick={() => setPaddingMode("axis")}
              className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${
                paddingMode === "axis"
                  ? "bg-panel-toggle-active text-foreground"
                  : "bg-panel-input text-muted-foreground"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
            <button
              onClick={() => setPaddingMode("individual")}
              className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${
                paddingMode === "individual"
                  ? "bg-panel-toggle-active text-foreground"
                  : "bg-panel-input text-muted-foreground"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 1H5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M7 1H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M11 1H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M15 3V5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M15 7V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M15 11V13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M13 15H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M9 15H7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M5 15H3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M1 13V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M1 9V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M1 5V3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Individual Padding Inputs */}
        {paddingMode === "individual" && (
          <div className="flex flex-col gap-1.5 pl-[72px]">
            <div className="grid grid-cols-4 gap-1.5">
              {(["T", "R", "B", "L"] as const).map((key) => (
                <input
                  key={key}
                  type="text"
                  value={paddingValues[key]}
                  onChange={(e) => handlePaddingInput(key, e.target.value)}
                  className="h-9 rounded-lg bg-panel-input text-center text-sm text-foreground outline-none border-none"
                />
              ))}
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {["T", "R", "B", "L"].map((label) => (
                <span key={label} className="text-center text-xs text-muted-foreground">
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DesignPanel;
