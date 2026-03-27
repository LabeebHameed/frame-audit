import { framer } from "framer-plugin"
import React, { useState, useEffect, useCallback, memo } from "react"
import { THEME_COLORS, type ThemeMode } from "./theme"
import type { AuditReport, CheckResult, CheckCategory, CheckItem } from "./types"
import { runAudit } from "./services/checkers"
import "./App.css"

framer.showUI({ position: "top right", width: 320, height: 580 })

function detectTheme(): ThemeMode {
    const testDiv = document.createElement("div")
    testDiv.style.backgroundColor = "var(--framer-color-bg)"
    testDiv.style.position = "absolute"
    testDiv.style.visibility = "hidden"
    document.body.appendChild(testDiv)
    const computed = getComputedStyle(testDiv).backgroundColor
    document.body.removeChild(testDiv)
    const match = computed.match(/\d+/g)
    if (match && match.length >= 3) {
        const r = parseInt(match[0], 10)
        const g = parseInt(match[1], 10)
        const b = parseInt(match[2], 10)
        return (r * 299 + g * 587 + b * 114) / 1000 > 200 ? "light" : "dark"
    }
    return "dark"
}

function getScoreColor(score: number, theme: ThemeMode): string {
    const s = THEME_COLORS[theme].status
    if (score >= 90) return s.pass
    if (score >= 70) return s.warning
    return s.fail
}

function getStatusColor(status: string, theme: ThemeMode): string {
    const s = THEME_COLORS[theme].status
    if (status === "pass") return s.pass
    if (status === "warning") return s.warning
    if (status === "fail") return s.fail
    return s.skip
}

// --- Icons ---

function CheckIcon(props: { color: string }): React.ReactElement {
    return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
            <circle cx="7" cy="7" r="6.5" stroke={props.color} strokeWidth="1.3" />
            <path d="M4.5 7L6.2 8.8L9.5 5.5" stroke={props.color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

function WarnIcon(props: { color: string }): React.ReactElement {
    return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
            <path d="M7 1.5L13 12H1L7 1.5Z" stroke={props.color} strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M7 6V8.5" stroke={props.color} strokeWidth="1.3" strokeLinecap="round" />
            <circle cx="7" cy="10.5" r="0.6" fill={props.color} />
        </svg>
    )
}

function FailIcon(props: { color: string }): React.ReactElement {
    return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
            <circle cx="7" cy="7" r="6.5" stroke={props.color} strokeWidth="1.3" />
            <path d="M4.5 4.5L9.5 9.5M9.5 4.5L4.5 9.5" stroke={props.color} strokeWidth="1.3" strokeLinecap="round" />
        </svg>
    )
}

function SkipIcon(props: { color: string }): React.ReactElement {
    return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
            <circle cx="7" cy="7" r="6.5" stroke={props.color} strokeWidth="1.3" />
            <path d="M4.5 7H9.5" stroke={props.color} strokeWidth="1.3" strokeLinecap="round" />
        </svg>
    )
}

function StatusIcon(props: { status: string; theme: ThemeMode }): React.ReactElement {
    const color = getStatusColor(props.status, props.theme)
    if (props.status === "pass") return <CheckIcon color={color} />
    if (props.status === "warning") return <WarnIcon color={color} />
    if (props.status === "fail") return <FailIcon color={color} />
    return <SkipIcon color={color} />
}

function SpinnerIcon(props: { color: string }): React.ReactElement {
    return (
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ animation: "spin 0.9s linear infinite", flexShrink: 0 }}>
            <circle cx="6.5" cy="6.5" r="5" stroke={`${props.color}30`} strokeWidth="2" />
            <path d="M11.5 6.5A5 5 0 0 0 6.5 1.5" stroke={props.color} strokeWidth="2" strokeLinecap="round" />
        </svg>
    )
}

function LightningIcon(props: { color: string; size?: number }): React.ReactElement {
    const s = props.size ?? 16
    return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
            <path d="M9 1L3 9H8L7 15L13 7H8L9 1Z" fill={props.color} />
        </svg>
    )
}

function ChevronIcon(props: { open: boolean; color: string }): React.ReactElement {
    return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, transition: "transform 0.15s ease", transform: props.open ? "rotate(90deg)" : "rotate(0deg)" }}>
            <path d="M4.5 3L7.5 6L4.5 9" stroke={props.color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

// --- Score ring for empty state ---

function ScoreRing(props: { theme: ThemeMode }): React.ReactElement {
    const colors = THEME_COLORS[props.theme]
    const ringColor = colors.card.border
    return (
        <svg width="72" height="72" viewBox="0 0 72 72" fill="none">
            <circle cx="36" cy="36" r="30" stroke={ringColor} strokeWidth="3" strokeDasharray="6 4" />
            <text
                x="36"
                y="40"
                textAnchor="middle"
                fontSize="16"
                fontWeight="600"
                fill={colors.text.quaternary}
                fontFamily="Inter, -apple-system, sans-serif"
            >
                —
            </text>
        </svg>
    )
}

// --- Stats strip ---

function StatsStrip(props: { report: AuditReport; theme: ThemeMode }): React.ReactElement {
    const colors = THEME_COLORS[props.theme]
    const s = THEME_COLORS[props.theme].status
    const items = [
        { label: `${props.report.passed} passed`, color: s.pass },
        { label: `${props.report.warned} warned`, color: s.warning },
        { label: `${props.report.failed} failed`, color: s.fail },
    ]
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 2 }}>
            {items.map((item, i) => (
                <React.Fragment key={i}>
                    <span style={{ fontSize: 11, color: item.color, fontWeight: 500 }}>
                        {item.label}
                    </span>
                    {i < items.length - 1 && (
                        <span style={{ fontSize: 11, color: colors.text.quaternary }}>·</span>
                    )}
                </React.Fragment>
            ))}
        </div>
    )
}

// --- Check row (used inside SectionCard) ---

const CheckRow = memo(function CheckRow(props: {
    check: CheckResult
    theme: ThemeMode
    onClick: (() => void) | null
}): React.ReactElement {
    const colors = THEME_COLORS[props.theme]
    const { status } = props.check
    const statusColor = getStatusColor(status, props.theme)
    const isSkip = status === "skip"
    const isPass = status === "pass"
    const isClickable = props.onClick !== null

    return (
        <div
            onClick={isClickable ? props.onClick : undefined}
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 6,
                padding: "7px 10px",
                borderRadius: 7,
                marginBottom: 2,
                backgroundColor: isPass || isSkip ? "transparent" : colors.card.bg,
                border: isPass || isSkip ? `1px solid ${colors.card.border}` : `1px solid ${statusColor}28`,
                borderLeft: isPass || isSkip ? undefined : `3px solid ${statusColor}`,
                opacity: isSkip ? 0.5 : 1,
                cursor: isClickable ? "pointer" : "default",
            }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: 7, flex: 1, minWidth: 0 }}>
                <StatusIcon status={status} theme={props.theme} />
                <span
                    style={{
                        fontSize: 12,
                        fontWeight: isPass || isSkip ? 400 : 500,
                        color: isPass ? colors.text.secondary : isSkip ? colors.text.tertiary : colors.text.primary,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                    }}
                >
                    {props.check.label}
                </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                <span
                    style={{
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: "0.5px",
                        color: isPass || isSkip ? colors.text.quaternary : statusColor,
                        backgroundColor: isPass || isSkip ? "transparent" : `${statusColor}18`,
                        borderRadius: 4,
                        padding: isPass || isSkip ? "0" : "2px 6px",
                    }}
                >
                    {status === "pass" ? "PASS" : status === "warning" ? "WARN" : status === "fail" ? "FAIL" : "SKIP"}
                </span>
                {isClickable && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, opacity: 0.4 }}>
                        <path d="M3.5 2L6.5 5L3.5 8" stroke={colors.text.secondary} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                )}
            </div>
        </div>
    )
})

// --- Section card (collapsible) ---

const SectionCard = memo(function SectionCard(props: {
    category: CheckCategory
    theme: ThemeMode
    isExpanded: boolean
    onToggle: () => void
    onCheckClick: (check: CheckResult) => void
}): React.ReactElement {
    const colors = THEME_COLORS[props.theme]
    const s = THEME_COLORS[props.theme].status

    const passCount = props.category.checks.filter((c) => c.status === "pass").length
    const warnCount = props.category.checks.filter((c) => c.status === "warning").length
    const failCount = props.category.checks.filter((c) => c.status === "fail").length

    return (
        <div style={{ marginBottom: 6 }}>
            <div
                onClick={props.onToggle}
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 10px",
                    borderRadius: 8,
                    backgroundColor: colors.card.bg,
                    border: `1px solid ${colors.card.border}`,
                    cursor: "pointer",
                    userSelect: "none",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <ChevronIcon open={props.isExpanded} color={colors.text.quaternary} />
                    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase", color: colors.text.secondary }}>
                        {props.category.label}
                    </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    {failCount > 0 && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: s.fail, backgroundColor: `${s.fail}18`, borderRadius: 4, padding: "1px 5px" }}>
                            {failCount}
                        </span>
                    )}
                    {warnCount > 0 && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: s.warning, backgroundColor: `${s.warning}18`, borderRadius: 4, padding: "1px 5px" }}>
                            {warnCount}
                        </span>
                    )}
                    {passCount > 0 && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: s.pass, backgroundColor: `${s.pass}18`, borderRadius: 4, padding: "1px 5px" }}>
                            {passCount}
                        </span>
                    )}
                </div>
            </div>

            {props.isExpanded && (
                <div style={{ paddingTop: 4 }}>
                    {props.category.checks.map((check: CheckResult) => (
                        <CheckRow
                            key={check.id}
                            check={check}
                            theme={props.theme}
                            onClick={check.status === "warning" || check.status === "fail" ? () => props.onCheckClick(check) : null}
                        />
                    ))}
                </div>
            )}
        </div>
    )
})

// --- Detail view ---

type ImageAssetEditable = {
    readonly cloneWithAttributes: (attrs: { altText: string }) => ImageAssetEditable
}

function DetailView(props: {
    check: CheckResult
    theme: ThemeMode
    onBack: () => void
}): React.ReactElement {
    const colors = THEME_COLORS[props.theme]
    const statusColor = getStatusColor(props.check.status, props.theme)
    const isAltText = props.check.id === "alt-text"

    const [altInputs, setAltInputs] = useState<Record<string, string>>(() => {
        if (!isAltText) return {}
        const initial: Record<string, string> = {}
        for (const item of props.check.items) {
            if (item.nodeId !== null) initial[item.nodeId] = ""
        }
        return initial
    })
    const [savingNodes, setSavingNodes] = useState<Set<string>>(new Set())
    const [savedNodes, setSavedNodes] = useState<Set<string>>(new Set())
    const [dismissedIndices, setDismissedIndices] = useState<Set<number>>(new Set())
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

    const handleGoTo = useCallback(async (nodeId: string) => {
        try {
            await framer.navigateTo(nodeId, { select: true, zoomIntoView: true })
        } catch {
            // ignore navigation errors
        }
    }, [])

    const handleSaveAltText = useCallback(async (nodeId: string) => {
        const newAltText = altInputs[nodeId]?.trim() ?? ""
        if (!newAltText) return

        setSavingNodes((prev) => { const n = new Set(prev); n.add(nodeId); return n })
        try {
            const frameNodes = await framer.getNodesWithType("FrameNode")
            const frame = frameNodes.find((f) => f.id === nodeId) as (Record<string, unknown>) | undefined
            if (!frame) return

            const image = frame.backgroundImage as ImageAssetEditable | null
            if (!image || typeof image.cloneWithAttributes !== "function") return

            const updated = image.cloneWithAttributes({ altText: newAltText })
            const framerAny = framer as Record<string, unknown>
            if (typeof framerAny.setAttributes === "function") {
                await (framerAny.setAttributes as (id: string, attrs: Record<string, unknown>) => Promise<void>)(
                    nodeId,
                    { backgroundImage: updated },
                )
            }

            setSavedNodes((prev) => { const n = new Set(prev); n.add(nodeId); return n })
        } catch {
            // ignore errors
        } finally {
            setSavingNodes((prev) => { const n = new Set(prev); n.delete(nodeId); return n })
        }
    }, [altInputs])

    return (
        <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
            {/* Back button */}
            <button
                onClick={props.onBack}
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "none",
                    border: "none",
                    color: colors.text.secondary,
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: "pointer",
                    padding: "0 0 12px 0",
                    alignSelf: "flex-start",
                }}
            >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
                    <path d="M9 2.5L5 7L9 11.5" stroke={colors.text.secondary} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Back
            </button>

            {/* Check label + status */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <StatusIcon status={props.check.status} theme={props.theme} />
                <span style={{ fontSize: 14, fontWeight: 600, color: colors.text.primary, flex: 1, minWidth: 0 }}>
                    {props.check.label}
                </span>
            </div>

            {/* Detail text */}
            {props.check.detail && (
                <div
                    style={{
                        fontSize: 12,
                        color: colors.text.secondary,
                        backgroundColor: `${statusColor}0C`,
                        border: `1px solid ${statusColor}22`,
                        borderRadius: 7,
                        padding: "8px 10px",
                        marginBottom: 12,
                        lineHeight: 1.5,
                    }}
                >
                    {props.check.detail}
                </div>
            )}

            {/* Items list */}
            {props.check.items.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingBottom: 8, width: "100%" }}>
                    {props.check.items.map((item: CheckItem, i: number) => {
                        if (dismissedIndices.has(i)) return null

                        if (isAltText && item.nodeId !== null) {
                            const nodeId = item.nodeId
                            const isSaving = savingNodes.has(nodeId)
                            const isSaved = savedNodes.has(nodeId)
                            const inputVal = altInputs[nodeId] ?? ""
                            return (
                                <div
                                    key={i}
                                    onMouseEnter={() => setHoveredIndex(i)}
                                    onMouseLeave={() => setHoveredIndex(null)}
                                    style={{ position: "relative", width: "100%", borderRadius: 7, backgroundColor: colors.card.bg, border: `1px solid ${statusColor}28`, borderLeft: `3px solid ${statusColor}` }}
                                >
                                    {/* Top row */}
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            gap: 6,
                                            padding: "7px 10px 0",
                                            width: "100%",
                                            boxSizing: "border-box",
                                        }}
                                    >
                                        <span
                                            style={{
                                                fontSize: 12,
                                                fontWeight: 500,
                                                color: colors.text.primary,
                                                flex: 1,
                                                minWidth: 0,
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                                whiteSpace: "nowrap",
                                            }}
                                        >
                                            {item.label}
                                        </span>
                                        <button
                                            onClick={() => { void handleGoTo(nodeId) }}
                                            style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", flexShrink: 0 }}
                                        >
                                            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ opacity: 0.55 }}>
                                                <path d="M2.5 6.5H10.5M7.5 3.5L10.5 6.5L7.5 9.5" stroke={statusColor} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                                            </svg>
                                        </button>
                                    </div>
                                    {/* Input + save row */}
                                    <div style={{ display: "flex", gap: 6, padding: "6px 10px 8px" }}>
                                        <input
                                            type="text"
                                            value={inputVal}
                                            onChange={(e) => {
                                                const val = e.target.value
                                                setAltInputs((prev) => ({ ...prev, [nodeId]: val }))
                                                if (isSaved) setSavedNodes((prev) => { const n = new Set(prev); n.delete(nodeId); return n })
                                            }}
                                            placeholder="Enter alt text…"
                                            disabled={isSaving}
                                            style={{
                                                flex: 1,
                                                minWidth: 0,
                                                backgroundColor: colors.bg,
                                                border: `1px solid ${colors.card.border}`,
                                                borderRadius: 5,
                                                padding: "5px 8px",
                                                fontSize: 11,
                                                color: colors.text.primary,
                                            }}
                                        />
                                        <button
                                            onClick={() => { void handleSaveAltText(nodeId) }}
                                            disabled={isSaving || !inputVal.trim()}
                                            style={{
                                                flexShrink: 0,
                                                width: 46,
                                                backgroundColor: isSaved ? `${colors.status.pass}20` : `${statusColor}20`,
                                                border: `1px solid ${isSaved ? colors.status.pass : statusColor}50`,
                                                borderRadius: 5,
                                                padding: "5px 0",
                                                fontSize: 11,
                                                fontWeight: 600,
                                                color: isSaved ? colors.status.pass : statusColor,
                                                cursor: isSaving || !inputVal.trim() ? "not-allowed" : "pointer",
                                                opacity: isSaving || !inputVal.trim() ? 0.45 : 1,
                                            }}
                                        >
                                            {isSaved ? "✓" : isSaving ? "…" : "Save"}
                                        </button>
                                    </div>
                                    {hoveredIndex === i && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setDismissedIndices((prev) => { const n = new Set(prev); n.add(i); return n }) }}
                                            title="Dismiss"
                                            style={{ position: "absolute", top: -5, right: -5, width: 14, height: 14, borderRadius: "50%", backgroundColor: colors.card.bg, border: `1px solid ${colors.card.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0, zIndex: 2 }}
                                        >
                                            <svg width="7" height="7" viewBox="0 0 7 7" fill="none">
                                                <path d="M1.5 1.5L5.5 5.5M5.5 1.5L1.5 5.5" stroke={colors.text.secondary} strokeWidth="1.2" strokeLinecap="round" />
                                            </svg>
                                        </button>
                                    )}
                                </div>
                            )
                        }

                        return (
                            <div
                                key={i}
                                onMouseEnter={() => setHoveredIndex(i)}
                                onMouseLeave={() => setHoveredIndex(null)}
                                style={{
                                    position: "relative",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 6,
                                    padding: "7px 10px",
                                    borderRadius: 7,
                                    backgroundColor: colors.card.bg,
                                    border: `1px solid ${statusColor}28`,
                                    borderLeft: `3px solid ${statusColor}`,
                                    cursor: item.nodeId !== null ? "pointer" : "default",
                                }}
                                onClick={item.nodeId !== null ? () => { void handleGoTo(item.nodeId as string) } : undefined}
                            >
                                <span
                                    style={{
                                        fontSize: 12,
                                        fontWeight: 500,
                                        color: colors.text.primary,
                                        flex: 1,
                                        minWidth: 0,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {item.label}
                                </span>
                                {item.nodeId !== null && (
                                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0, opacity: 0.55 }}>
                                        <path d="M2.5 6.5H10.5M7.5 3.5L10.5 6.5L7.5 9.5" stroke={statusColor} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                )}
                                {hoveredIndex === i && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setDismissedIndices((prev) => { const n = new Set(prev); n.add(i); return n }) }}
                                        title="Dismiss"
                                        style={{ position: "absolute", top: -5, right: -5, width: 14, height: 14, borderRadius: "50%", backgroundColor: colors.card.bg, border: `1px solid ${colors.card.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0, zIndex: 2 }}
                                    >
                                        <svg width="7" height="7" viewBox="0 0 7 7" fill="none">
                                            <path d="M1.5 1.5L5.5 5.5M5.5 1.5L1.5 5.5" stroke={colors.text.secondary} strokeWidth="1.2" strokeLinecap="round" />
                                        </svg>
                                    </button>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}

            {props.check.items.length === 0 && (
                <span style={{ fontSize: 12, color: colors.text.tertiary }}>No items to show.</span>
            )}
        </div>
    )
}

// --- Main App ---

export function App(): React.ReactElement {
    const [theme, setTheme] = useState<ThemeMode>("dark")
    const [auditReport, setAuditReport] = useState<AuditReport | null>(null)
    const [isRunning, setIsRunning] = useState<boolean>(false)
    const [scanProgress, setScanProgress] = useState<number>(0)
    const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
    const [detailCheck, setDetailCheck] = useState<CheckResult | null>(null)

    useEffect(() => {
        setTheme(detectTheme())
    }, [])

    const handleAudit = useCallback(async () => {
        setIsRunning(true)
        setDetailCheck(null)
        setScanProgress(0)
        try {
            const report = await runAudit((done, total) => {
                setScanProgress(Math.round((done / total) * 100))
            })
            setAuditReport(report)
            setExpandedSections(new Set())
        } finally {
            setIsRunning(false)
            // Don't reset scanProgress — the bar transitions to showing the score
        }
    }, [])

    const toggleSection = useCallback((id: string) => {
        setExpandedSections((prev) => {
            const next = new Set(prev)
            if (next.has(id)) {
                next.delete(id)
            } else {
                next.add(id)
            }
            return next
        })
    }, [])

    const openDetail = useCallback((check: CheckResult) => {
        setDetailCheck(check)
    }, [])

    const closeDetail = useCallback(() => {
        setDetailCheck(null)
    }, [])


    const colors = THEME_COLORS[theme]
    const scoreColor = auditReport ? getScoreColor(auditReport.score, theme) : colors.text.quaternary

    return (
        <main style={{ backgroundColor: colors.bg, color: colors.text.primary, position: "relative" }}>
            {/* Sticky top header — score only */}
            <div
                style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    padding: "14px 0 12px",
                    position: "sticky",
                    top: 0,
                    width: "100%",
                    backgroundColor: colors.bg,
                    zIndex: 10,
                    borderBottom: `1px solid ${colors.divider}`,
                    marginBottom: 12,
                }}
            >
                <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <LightningIcon color={scoreColor} size={15} />
                        <span
                            style={{
                                fontSize: 22,
                                fontWeight: 700,
                                color: scoreColor,
                                letterSpacing: "-0.5px",
                                lineHeight: 1,
                            }}
                        >
                            {auditReport ? `${auditReport.score}%` : "—"}
                        </span>
                        {auditReport && (
                            <span
                                style={{
                                    fontSize: 12,
                                    fontWeight: 500,
                                    color: scoreColor,
                                    opacity: 0.75,
                                    alignSelf: "flex-end",
                                    paddingBottom: 1,
                                }}
                            >
                                {auditReport.scoreLabel}
                            </span>
                        )}
                    </div>
                    {auditReport && <StatsStrip report={auditReport} theme={theme} />}
                    {!auditReport && !isRunning && (
                        <span style={{ fontSize: 11, color: colors.text.quaternary }}>
                            Not scanned yet
                        </span>
                    )}
                    {isRunning && (
                        <span style={{ fontSize: 11, color: colors.text.quaternary }}>
                            Scanning… {scanProgress}%
                        </span>
                    )}
                    {(isRunning || auditReport) && (
                        <div style={{ height: 2, borderRadius: 1, backgroundColor: colors.divider, overflow: "hidden", marginTop: 1 }}>
                            <div style={{
                                height: "100%",
                                width: `${isRunning ? scanProgress : (auditReport?.score ?? 0)}%`,
                                backgroundColor: isRunning ? "#008CFF" : scoreColor,
                                borderRadius: 1,
                                transition: "width 0.3s ease",
                            }} />
                        </div>
                    )}
                </div>
            </div>

            {/* Scrollable content */}
            <div className="audit-scroll" style={{ paddingBottom: 60 }}>
                {detailCheck && (
                    <DetailView
                        check={detailCheck}
                        theme={theme}
                        onBack={closeDetail}
                    />
                )}

                {!detailCheck && auditReport && auditReport.categories.map((category: CheckCategory) => (
                    <SectionCard
                        key={category.id}
                        category={category}
                        theme={theme}
                        isExpanded={expandedSections.has(category.id)}
                        onToggle={() => toggleSection(category.id)}
                        onCheckClick={openDetail}
                    />
                ))}

                {/* Empty state */}
                {!detailCheck && !auditReport && (
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            paddingTop: 60,
                            paddingBottom: 40,
                            gap: 16,
                        }}
                    >
                        <ScoreRing theme={theme} />
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                gap: 6,
                            }}
                        >
                            <span
                                style={{
                                    fontSize: 13,
                                    fontWeight: 600,
                                    color: colors.text.primary,
                                }}
                            >
                                Audit your template
                            </span>
                            <span
                                style={{
                                    fontSize: 12,
                                    color: colors.text.tertiary,
                                    textAlign: "center",
                                    lineHeight: 1.5,
                                    maxWidth: 200,
                                }}
                            >
                                Checks 28 requirements against the Framer template guidelines
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* Fixed footer — AUDIT button always visible */}
            <div
                style={{
                    position: "fixed",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    padding: "10px 15px",
                    backgroundColor: colors.bg,
                    borderTop: `1px solid ${colors.divider}`,
                    zIndex: 20,
                }}
            >
                <button
                    onClick={() => { void handleAudit() }}
                    disabled={isRunning}
                    style={{
                        width: "100%",
                        background: isRunning
                            ? colors.button.disabledBg
                            : "linear-gradient(177.58deg, #008CFF 2.02%, #0671CA 97.98%)",
                        color: isRunning ? "rgba(255,255,255,0.4)" : "#FFFFFF",
                        border: "none",
                        borderRadius: 8,
                        padding: "20px 18px",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: isRunning ? "not-allowed" : "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        letterSpacing: "0.3px",
                    }}
                >
                    {isRunning ? (
                        <>
                            <SpinnerIcon color="rgba(255,255,255,0.6)" />
                            Scanning…
                        </>
                    ) : (
                        "AUDIT"
                    )}
                </button>
            </div>
        </main>
    )
}
