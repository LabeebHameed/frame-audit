import React from "react"
import { THEME_COLORS } from "./theme"

type Breakpoint = "L" | "M" | "S"
type PaddingMode = "uniform" | "individual"
type PaddingEdge = "T" | "R" | "B" | "L"

type PanelColors = typeof THEME_COLORS.dark

type DesignPanelProps = {
    colors: PanelColors
    breakpoints: ReadonlyArray<Breakpoint>
    activeBreakpoint: Breakpoint
    isLocked: boolean
    canAddBreakpoint: boolean
    gap: number
    paddingMode: PaddingMode
    paddingValue: number
    paddingValues: Readonly<Record<PaddingEdge, number>>
    onAddBreakpoint: () => void
    onToggleLocked: () => void
    onBreakpointChange: (breakpoint: Breakpoint) => void
    onGapChange: (value: number) => void
    onPaddingModeChange: (mode: PaddingMode) => void
    onPaddingValueChange: (value: number) => void
    onPaddingEdgeChange: (edge: PaddingEdge, value: number) => void
}

function CheckIcon(): React.ReactElement {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 8.5L6.5 12L13 5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

function EmptySquareIcon(props: { color: string }): React.ReactElement {
    return <div style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${props.color}` }} />
}

function AxisIcon(): React.ReactElement {
    return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
        </svg>
    )
}

function IndividualIcon(): React.ReactElement {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
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
    )
}

export function DesignPanel(props: DesignPanelProps): React.ReactElement {
    const borderStyle = `1px solid ${props.colors.card.border}`
    const controlsLocked = props.isLocked

    const buttonBase: React.CSSProperties = {
        height: 36,
        border: "none",
        borderRadius: 9999,
        backgroundColor: props.colors.input.bg,
        color: props.colors.text.secondary,
        cursor: "pointer",
        transition: "opacity 0.15s ease",
    }

    const inputBase: React.CSSProperties = {
        height: 32,
        borderRadius: 8,
        border: borderStyle,
        backgroundColor: props.colors.input.bg,
        color: props.colors.text.primary,
        fontSize: 12,
        textAlign: "center",
        outline: "none",
        boxSizing: "border-box",
    }

    return (
        <div
            style={{
                width: "100%",
                maxWidth: 320,
                borderRadius: 12,
                background: props.colors.bg,
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 16,
                boxSizing: "border-box",
                userSelect: "none",
                fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                overflowX: "hidden",
            }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                    onClick={props.onAddBreakpoint}
                    disabled={!props.canAddBreakpoint || controlsLocked}
                    style={{
                        ...buttonBase,
                        flex: 1,
                        padding: "0 16px",
                        textAlign: "left",
                        opacity: !props.canAddBreakpoint || controlsLocked ? 0.4 : 1,
                        cursor: !props.canAddBreakpoint || controlsLocked ? "default" : "pointer",
                    }}
                >
                    Add Breakpoints...
                </button>
                <button
                    onClick={props.onToggleLocked}
                    style={{
                        ...buttonBase,
                        width: 36,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: props.isLocked ? "#008CFF" : props.colors.text.secondary,
                    }}
                    title={props.isLocked ? "Unlock" : "Lock"}
                >
                    {props.isLocked ? <CheckIcon /> : <EmptySquareIcon color={props.colors.text.secondary} />}
                </button>
            </div>

            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                    opacity: controlsLocked ? 0.7 : 1,
                    pointerEvents: controlsLocked ? "none" : "auto",
                    transition: "opacity 0.15s ease",
                }}
            >

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 14, color: props.colors.text.primary, width: 60, flexShrink: 0 }}>Type</span>
                <div style={{ display: "flex", flex: 1, marginLeft: 12, borderRadius: 8, overflow: "hidden", backgroundColor: props.colors.input.bg }}>
                    {props.breakpoints.map((breakpoint) => (
                        <button
                            key={breakpoint}
                            onClick={() => props.onBreakpointChange(breakpoint)}
                            disabled={controlsLocked}
                            style={{
                                height: 32,
                                flex: 1,
                                border: "none",
                                backgroundColor: props.activeBreakpoint === breakpoint ? props.colors.card.hoverBg : "transparent",
                                color: props.activeBreakpoint === breakpoint ? props.colors.text.primary : props.colors.text.secondary,
                                fontSize: 14,
                                fontWeight: 500,
                                cursor: "pointer",
                            }}
                        >
                            {breakpoint}
                        </button>
                    ))}
                </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, width: 60, flexShrink: 0 }}>
                    <span style={{ fontSize: 14, color: props.colors.text.primary }}>Gap</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, marginLeft: 12 }}>
                    <input
                        type="text"
                        disabled={controlsLocked}
                        value={props.gap}
                        onChange={(event) => {
                            const value = event.target.value
                            if (value === "") {
                                props.onGapChange(0)
                                return
                            }
                            const parsed = Number.parseInt(value, 10)
                            if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 100) {
                                props.onGapChange(parsed)
                            }
                        }}
                        style={{ ...inputBase, width: 64 }}
                    />
                    <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
                        <input
                            type="range"
                            disabled={controlsLocked}
                            min={0}
                            max={100}
                            value={props.gap}
                            onChange={(event) => props.onGapChange(Number(event.target.value))}
                            className="panel-slider"
                            style={{ width: "100%" }}
                        />
                    </div>
                </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, color: props.colors.text.primary, width: 60, flexShrink: 0 }}>Padding</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
                        <input
                            type="text"
                            disabled={controlsLocked}
                            value={props.paddingValue}
                            onChange={(event) => {
                                const value = event.target.value
                                if (value === "") {
                                    props.onPaddingValueChange(0)
                                    return
                                }
                                const parsed = Number.parseInt(value, 10)
                                if (!Number.isNaN(parsed) && parsed >= 0) {
                                    props.onPaddingValueChange(parsed)
                                }
                            }}
                            style={{ ...inputBase, flex: "1 1 102px", minWidth: 92, maxWidth: 114 }}
                        />
                        <button
                            onClick={() => props.onPaddingModeChange("uniform")}
                            disabled={controlsLocked}
                            style={{
                                ...buttonBase,
                                width: 32,
                                flexShrink: 0,
                                borderRadius: 8,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                backgroundColor: props.paddingMode === "uniform" ? props.colors.card.hoverBg : props.colors.input.bg,
                                color: props.paddingMode === "uniform" ? props.colors.text.primary : props.colors.text.secondary,
                            }}
                            title="Uniform padding"
                        >
                            <AxisIcon />
                        </button>
                        <button
                            onClick={() => props.onPaddingModeChange("individual")}
                            disabled={controlsLocked}
                            style={{
                                ...buttonBase,
                                width: 32,
                                flexShrink: 0,
                                borderRadius: 8,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                backgroundColor: props.paddingMode === "individual" ? props.colors.card.hoverBg : props.colors.input.bg,
                                color: props.paddingMode === "individual" ? props.colors.text.primary : props.colors.text.secondary,
                            }}
                            title="Individual padding"
                        >
                            <IndividualIcon />
                        </button>
                    </div>
                </div>

                {props.paddingMode === "individual" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 60, minWidth: 0 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 4 }}>
                            {(["T", "R", "B", "L"] as const).map((edge) => (
                                <input
                                    key={edge}
                                    type="text"
                                    disabled={controlsLocked}
                                    value={props.paddingValues[edge]}
                                    onChange={(event) => {
                                        const value = event.target.value
                                        if (value === "") {
                                            props.onPaddingEdgeChange(edge, 0)
                                            return
                                        }
                                        const parsed = Number.parseInt(value, 10)
                                        if (!Number.isNaN(parsed) && parsed >= 0) {
                                            props.onPaddingEdgeChange(edge, parsed)
                                        }
                                    }}
                                    style={{ ...inputBase, width: "100%", height: 28, minWidth: 0 }}
                                />
                            ))}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 4 }}>
                            {(["T", "R", "B", "L"] as const).map((edge) => (
                                <span key={edge} style={{ fontSize: 11, color: props.colors.text.secondary, textAlign: "center", lineHeight: 1, minWidth: 0 }}>
                                    {edge}
                                </span>
                            ))}
                        </div>
                    </div>
                )}
            </div>
            </div>
        </div>
    )
}

export type { Breakpoint, PaddingMode, PaddingEdge }

export default DesignPanel
