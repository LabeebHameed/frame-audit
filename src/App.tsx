import { framer, isFrameNode } from "framer-plugin"
import type { CanvasNode } from "framer-plugin"
import React, { useState, useEffect, useCallback, memo, useRef } from "react"
import { THEME_COLORS, type ThemeMode } from "./theme"
import type { AuditReport, CheckResult, CheckCategory, CheckItem, PageSpeedData, PageSpeedStrategyData, PaddingBreakpointConfig, PaddingSection, PaddingReport } from "./types"
import { runAudit, runRequirementCheck, calculateScore, checkPaddingAndGap } from "./services/checkers"
import DesignPanel from "./DesignPanel"
import "./App.css"

framer.showUI({ position: "top right", width: 320, height: 580 })

// Derive an effective audit report by treating checks whose all items are dismissed as "pass".
// Only warning/fail checks with items are affected; checks with 0 items are left as-is.
function computeEffectiveReport(
    report: AuditReport,
    dismissed: ReadonlyMap<string, ReadonlySet<number>>,
): AuditReport {
    const categories = report.categories.map((cat) => ({
        ...cat,
        checks: cat.checks.map((check) => {
            if ((check.status !== "warning" && check.status !== "fail") || check.items.length === 0) return check
            const dismissedForCheck = dismissed.get(check.id)
            if (!dismissedForCheck || dismissedForCheck.size < check.items.length) return check
            // All items dismissed → treat as pass
            return { ...check, status: "pass" as const, items: check.items }
        }),
    }))
    const scoreResult = calculateScore(categories)
    return {
        ...report,
        categories,
        score: scoreResult.score,
        scoreLabel: scoreResult.scoreLabel,
        totalProgrammatic: scoreResult.totalProgrammatic,
        passed: scoreResult.passed,
        warned: scoreResult.warned,
        failed: scoreResult.failed,
    }
}

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

function ChevronIcon(props: { open: boolean; color: string }): React.ReactElement {
    return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, transition: "transform 0.15s ease", transform: props.open ? "rotate(90deg)" : "rotate(0deg)" }}>
            <path d="M4.5 3L7.5 6L4.5 9" stroke={props.color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

function LockIcon(props: { color: string }): React.ReactElement {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
            <path
                fill={props.color}
                fillRule="evenodd"
                d="M5.25 10.055V8a6.75 6.75 0 0 1 13.5 0v2.055c1.115.083 1.84.293 2.371.824C22 11.757 22 13.172 22 16s0 4.243-.879 5.121C20.243 22 18.828 22 16 22H8c-2.828 0-4.243 0-5.121-.879C2 20.243 2 18.828 2 16s0-4.243.879-5.121c.53-.531 1.256-.741 2.371-.824M6.75 8a5.25 5.25 0 0 1 10.5 0v2.004Q16.676 9.999 16 10H8q-.677-.001-1.25.004z"
                clipRule="evenodd"
            />
        </svg>
    )
}

function RecheckButton(props: { onClick: () => void; disabled: boolean }): React.ReactElement {
    return (
        <button
            onClick={props.onClick}
            disabled={props.disabled}
            title="Recheck this requirement"
            style={{
                width: 25,
                height: 25,
                background: "rgba(255,255,255,0.08)",
                border: "none",
                borderRadius: 5,
                padding: 3,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: props.disabled ? "not-allowed" : "pointer",
                opacity: props.disabled ? 0.45 : 1,
                flexShrink: 0,
            }}
        >
            {props.disabled ? (
                <SpinnerIcon color="rgba(255,255,255,0.8)" />
            ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M11.9309 7.52094C11.7689 9.04338 10.9062 10.4701 9.47882 11.2942C7.10729 12.6634 4.07482 11.8508 2.70562 9.4793L2.55978 9.22671M2.06859 6.47909C2.23064 4.95665 3.09326 3.52997 4.52067 2.70586C6.89221 1.33665 9.92468 2.1492 11.2939 4.52074L11.4397 4.77333M2.03769 10.5385L2.46472 8.94484L4.05842 9.37187M9.94141 4.62817L11.5351 5.0552L11.9621 3.4615" stroke="white" strokeOpacity="0.8" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
            )}
        </button>
    )
}


function getDetailGuidance(check: CheckResult): { whatItMeans: string; nextStep: string } {
    const guidanceById: Record<string, { whatItMeans: string; nextStep: string }> = {
        "alt-text": {
            whatItMeans: "These images are missing alt text.",
            nextStep: "Add clear alt text that describes the image purpose or content.",
        },
        "large-uncompressed-assets": {
            whatItMeans: "Some assets are too large or image dimensions are too big.",
            nextStep: "Compress oversized images/videos and keep image width/height at or below 4096px.",
        },
        "placeholder-text": {
            whatItMeans: "These text layers still use placeholder copy.",
            nextStep: "Replace the placeholder with the final text you want published.",
        },
        "lorem-ipsum": {
            whatItMeans: "Some text layers still contain lorem ipsum placeholder words.",
            nextStep: "Replace every flagged placeholder phrase or token with final content.",
        },
        "spelling-check": {
            whatItMeans: "Some text layers contain words that are likely misspelled.",
            nextStep: "Review each flagged word and correct any spelling mistakes in the source text.",
        },
        "component-file-structure": {
            whatItMeans: "These components or frames are not organized in the expected file structure.",
            nextStep: "Move the component into the correct file or folder structure so the project stays maintainable.",
        },
        "consistent-text-styles": {
            whatItMeans: "These text layers are mixing multiple style definitions.",
            nextStep: "Apply a shared text style so the same text role uses the same typography everywhere.",
        },
        "text-styles": {
            whatItMeans: "Some text layers are not using an expected text style.",
            nextStep: "Assign the correct text style to each flagged layer so typography stays consistent.",
        },
        "color-contrast": {
            whatItMeans: "These text layers do not meet WCAG AA contrast.",
            nextStep: "Darken the text or lighten the background until every flagged layer reaches at least 4.5:1 contrast.",
        },
        "text-legibility": {
            whatItMeans: "These text layers are too small to read comfortably.",
            nextStep: "Increase the font size to at least 12px.",
        },
        "duplicate-cms-content": {
            whatItMeans: "These CMS items have identical fieldData.",
            nextStep: "Remove or rewrite duplicate items so each CMS page has unique content.",
        },
        "empty-cms-fields": {
            whatItMeans: "Some CMS items are missing required field values.",
            nextStep: "Fill every empty CMS field in the flagged items.",
        },
        "mailto-tel-links": {
            whatItMeans: "These links are missing the expected mailto/tel format.",
            nextStep: "Update each link so email actions use mailto: and phone actions use tel:.",
        },
        "hover-state-links": {
            whatItMeans: "These hover-state components are used on pages without a configured link.",
            nextStep: "Add a link variable/value to each flagged component instance used on pages.",
        },
        "color-styles": {
            whatItMeans: "These layers are using colors that should be converted to shared styles.",
            nextStep: "Apply a reusable color style so the design system stays consistent.",
        },
        "contact-form": {
            whatItMeans: "These forms are missing a send destination or redirect action.",
            nextStep: "Set a send-to email address or add a redirect URL for the form submission.",
        },
        "nav-footer-tags": {
            whatItMeans: "The shared template is missing the Nav/Footer structure.",
            nextStep: "Place the Nav component at the top and the Footer component at the bottom of the template.",
        },
        "tag-checker": {
            whatItMeans: "These immediate child sections of a page are missing an HTML tag.",
            nextStep: "Select each flagged section, open Accessibility, and assign an HTML tag.",
        },
        "custom-404-page": {
            whatItMeans: "A custom 404 page was not detected.",
            nextStep: "Create a 404 page that helps visitors recover with a clear message and a path back.",
        },
        "broken-internal-links": {
            whatItMeans: "These internal links point to missing or invalid destinations.",
            nextStep: "Fix the link target so it points to a real page or section in the site.",
        },
        "responsive-layout": {
            whatItMeans: "These frames use a fixed width.",
            nextStep: "Switch the frame to a responsive width so it can resize with the layout.",
        },
        "auto-height": {
            whatItMeans: "These frames use a fixed height.",
            nextStep: "Set the frame height to auto or fit-content so it grows with its content.",
        },
        "default-fonts": {
            whatItMeans: "These text layers are using non-default fonts.",
            nextStep: "Replace the flagged fonts with Framer default fonts.",
        },
        "google-pagespeed": {
            whatItMeans: "This page is being checked against Google PageSpeed metrics.",
            nextStep: "Review the performance metrics, then fix the slowest items first.",
        },
        "active-links": {
            whatItMeans: "Some linked elements have text that doesn't match their destination.",
            nextStep: "Update the text or link target so the label clearly describes where the link goes.",
        },
        "page-settings": {
            whatItMeans: "Published site metadata is incomplete.",
            nextStep: "Set favicon, social preview, site title, and site description in Site Settings, then republish.",
        },
        "naming": {
            whatItMeans: "These frames still use default or unclear names.",
            nextStep: "Rename each layer so its purpose is obvious when other people inspect the file.",
        },
        "h1-tags": {
            whatItMeans: "The page is missing a clear H1 heading.",
            nextStep: "Add one H1 per page and make it the main heading users see first.",
        },
        "heading-hierarchy": {
            whatItMeans: "The headings skip levels or appear in the wrong order.",
            nextStep: "Restructure the heading levels so they move in order from H1 to H2 to H3.",
        },
        "overflow": {
            whatItMeans: "These nodes are larger than their parent containers.",
            nextStep: "Resize the overflowing layer or increase the parent size so the content fits.",
        },
        "breakpoint-widths": {
            whatItMeans: "The breakpoint widths differ across pages.",
            nextStep: "Make the breakpoint widths consistent so each page uses the same responsive structure.",
        },
        "unused-assets": {
            whatItMeans: "These assets or components are not being used.",
            nextStep: "Delete the unused asset or add it where it is actually needed.",
        },
    }

    return guidanceById[check.id] ?? {
        whatItMeans: check.detail || "This check found items that need attention.",
        nextStep: "Review the flagged layers and update them to match the requirement.",
    }
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
    onClick: (() => void) | null | undefined
}): React.ReactElement {
    const colors = THEME_COLORS[props.theme]
    const { status } = props.check
    const statusColor = getStatusColor(status, props.theme)
    const isSkip = status === "skip"
    const isPass = status === "pass"
    const isClickable = props.onClick !== null

    return (
        <div
            onClick={isClickable ? props.onClick ?? undefined : undefined}
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 6,
                padding: "7px 10px",
                borderRadius: 7,
                marginBottom: 2,
                backgroundColor: "transparent",
                border: `0`,
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
                            onClick={check.id === "google-pagespeed" || check.status === "warning" || check.status === "fail" ? () => props.onCheckClick(check) : null}
                        />
                    ))}
                </div>
            )}
        </div>
    )
})

// --- Detail view ---

type ImageAssetEditable = {
    readonly id?: string
    readonly cloneWithAttributes: (attrs: { altText: string }) => ImageAssetEditable
}

type FrameNodeWithParent = {
    readonly id?: string
    readonly getParent?: (() => Promise<unknown>)
}

type ComponentNodeWithVariables = {
    readonly id: string
    readonly getVariables: (() => Promise<ReadonlyArray<unknown>>)
}

type ImageVariableEditable = {
    readonly id?: string
    readonly type?: unknown
    readonly defaultValue?: unknown
    readonly setAttributes?: ((attrs: { defaultValue: ImageAssetEditable }) => Promise<unknown>)
}

type ImageControlValue = {
    readonly type?: unknown
    readonly value?: unknown
}

function scoreColor(score: number | null): string {
    if (score === null) return "#888888"
    if (score >= 0.9) return "#0cce6b"
    if (score >= 0.5) return "#ffa400"
    return "#ff4e42"
}

function ScoreCircle(props: { score: number | null; label: string }): React.ReactElement {
    const { score, label } = props
    const pct = score !== null ? Math.round(score * 100) : null
    const color = scoreColor(score)
    const radius = 28
    const stroke = 4
    const normalizedRadius = radius - stroke / 2
    const circumference = 2 * Math.PI * normalizedRadius
    const dash = pct !== null ? (pct / 100) * circumference : 0

    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <div style={{ position: "relative", width: radius * 2, height: radius * 2 }}>
                <svg width={radius * 2} height={radius * 2} style={{ transform: "rotate(-90deg)" }}>
                    <circle
                        cx={radius}
                        cy={radius}
                        r={normalizedRadius}
                        fill="none"
                        stroke="rgba(255,255,255,0.1)"
                        strokeWidth={stroke}
                    />
                    <circle
                        cx={radius}
                        cy={radius}
                        r={normalizedRadius}
                        fill="none"
                        stroke={color}
                        strokeWidth={stroke}
                        strokeDasharray={`${dash} ${circumference}`}
                        strokeLinecap="round"
                    />
                </svg>
                <div style={{
                    position: "absolute", inset: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14, fontWeight: 700, color,
                }}>
                    {pct !== null ? pct : "—"}
                </div>
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", textAlign: "center", lineHeight: 1.2 }}>{label}</div>
        </div>
    )
}

function MetricCard(props: { label: string; value: string; score: number | null }): React.ReactElement {
    const color = scoreColor(props.score)
    return (
        <div style={{
            background: "rgba(255,255,255,0.06)",
            borderRadius: 10,
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
        }}>
            <div style={{ fontSize: 13, fontWeight: 600, color }}>{props.value}</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{props.label}</div>
        </div>
    )
}

function PageSpeedStrategyView(props: { data: PageSpeedStrategyData; publishedUrl: string }): React.ReactElement {
    const { data } = props
    const detailsUrl = `https://pagespeed.web.dev/report?url=${encodeURIComponent(props.publishedUrl)}`

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, justifyItems: "center" }}>
                <ScoreCircle score={data.performance} label="Performance" />
                <ScoreCircle score={data.accessibility} label="Accessibility" />
                <ScoreCircle score={data.bestPractices} label="Best Practices" />
                <ScoreCircle score={data.seo} label="SEO" />
            </div>
            <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>Performance Metrics</div>
                    <a
                        href={detailsUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontSize: 12, color: "#4da3ff", textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}
                    >
                        See Details
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                            <path d="M2 2h8v8M10 2 4 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                    </a>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {data.metrics.map(m => (
                        <MetricCard key={m.label} label={m.label} value={m.value} score={m.score} />
                    ))}
                </div>
            </div>
        </div>
    )
}

function PageSpeedDetailView(props: {
    check: CheckResult
    theme: ThemeMode
    onBack: () => void
    isRunning: boolean
    onRecheck: () => void
    isRechecking: boolean
}): React.ReactElement {
    const colors = THEME_COLORS[props.theme]
    const statusColor = getStatusColor(props.check.status, props.theme)
    const [tab, setTab] = useState<"desktop" | "mobile">("desktop")
    const data = props.check.pageSpeedData as PageSpeedData | undefined

    const tabStyle = (active: boolean): React.CSSProperties => ({
        flex: 1,
        padding: "7px 0",
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        color: active ? "#fff" : "rgba(255,255,255,0.5)",
        background: active ? "rgba(255,255,255,0.12)" : "transparent",
        border: "none",
        borderRadius: 8,
        cursor: "pointer",
    })

    const strategyData = data ? (tab === "desktop" ? data.desktop : data.mobile) : null

    const LoadingCard = (loadingProps: { width?: string | number; height: number; radius?: number; marginTop?: number }): React.ReactElement => (
        <div
            style={{
                width: loadingProps.width ?? "100%",
                height: loadingProps.height,
                borderRadius: loadingProps.radius ?? 10,
                marginTop: loadingProps.marginTop ?? 0,
                background: "linear-gradient(90deg, rgba(255,255,255,0.06) 25%, rgba(255,255,255,0.12) 37%, rgba(255,255,255,0.06) 63%)",
                backgroundSize: "400% 100%",
                animation: "pulse 1.4s ease infinite",
            }}
        />
    )

    return (
        <div style={{ display: "flex", flexDirection: "column", width: "100%", alignItems: "flex-start" }}>
            <div style={{ display: "flex", alignItems: "center", width: "100%", marginBottom: 12 }}>
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
                        padding: 0,
                        alignSelf: "flex-start",
                        width: "fit-content",
                    }}
                >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
                        <path d="M9 2.5L5 7L9 11.5" stroke={colors.text.secondary} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Back
                </button>
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
                    <RecheckButton onClick={props.onRecheck} disabled={props.isRechecking || props.isRunning} />
                </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, width: "100%" }}>
                <StatusIcon status={props.check.status} theme={props.theme} />
                <span style={{ fontSize: 14, fontWeight: 600, color: colors.text.primary, flex: 1, minWidth: 0 }}>
                    {props.check.label}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: colors.status.fail, backgroundColor: `${colors.status.fail}18`, borderRadius: 4, padding: "1px 5px" }}>0</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: colors.status.pass, backgroundColor: `${colors.status.pass}18`, borderRadius: 4, padding: "1px 5px" }}>0</span>
                </div>
            </div>

        

            <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 8, width: "100%" }}>
                {props.isRunning || props.isRechecking ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 12, backgroundColor: colors.card.bg, border: `1px solid ${colors.card.border}` }}>
                            <SpinnerIcon color={statusColor} />
                            <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: colors.text.primary }}>Running Google PageSpeed…</div>
                                <div style={{ fontSize: 12, color: colors.text.secondary }}>Fetching desktop and mobile scores from Google.</div>
                            </div>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, justifyItems: "center", opacity: 0.9 }}>
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                                <div style={{ width: 56, height: 56, borderRadius: "50%", border: "4px solid rgba(255,255,255,0.08)" }} />
                                <LoadingCard width={48} height={10} />
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                                <div style={{ width: 56, height: 56, borderRadius: "50%", border: "4px solid rgba(255,255,255,0.08)" }} />
                                <LoadingCard width={52} height={10} />
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                                <div style={{ width: 56, height: 56, borderRadius: "50%", border: "4px solid rgba(255,255,255,0.08)" }} />
                                <LoadingCard width={52} height={10} />
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                                <div style={{ width: 56, height: 56, borderRadius: "50%", border: "4px solid rgba(255,255,255,0.08)" }} />
                                <LoadingCard width={44} height={10} />
                            </div>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            <LoadingCard height={44} />
                            <LoadingCard height={44} />
                            <LoadingCard height={44} />
                            <LoadingCard height={44} />
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
                            <LoadingCard height={12} width="42%" />
                            <LoadingCard height={12} width="64%" />
                            <LoadingCard height={12} width="58%" />
                        </div>
                    </div>
                ) : !data ? (
                    <div
                        style={{
                            fontSize: 12,
                            color: colors.text.secondary,
                            backgroundColor: `${statusColor}0C`,
                            border: `1px solid ${statusColor}22`,
                            borderRadius: 7,
                            padding: "10px 12px",
                            lineHeight: 1.45,
                        }}
                    >
                        PageSpeed data is unavailable for this run. Use Recheck to run the API request again.
                    </div>
                ) : (
                    <>
                        <div style={{ display: "flex", background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: 3, marginBottom: 20 }}>
                            <button style={tabStyle(tab === "desktop")} onClick={() => setTab("desktop")}>Desktop</button>
                            <button style={tabStyle(tab === "mobile")} onClick={() => setTab("mobile")}>Mobile</button>
                        </div>

                        {strategyData ? (
                            <PageSpeedStrategyView data={strategyData} publishedUrl={strategyData.publishedUrl} />
                        ) : (
                            <div style={{ fontSize: 13, color: colors.text.secondary, textAlign: "center", padding: 24 }}>
                                No data available for {tab}.
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}

function DetailView(props: {
    check: CheckResult
    theme: ThemeMode
    onBack: () => void
    dismissedIndices: ReadonlySet<number>
    onDismiss: (index: number) => void
    isRunning?: boolean
    onRecheck: () => void
    isRechecking: boolean
}): React.ReactElement {
    const colors = THEME_COLORS[props.theme]
    const statusColor = getStatusColor(props.check.status, props.theme)

    if (props.check.id === "google-pagespeed") {
        return (
            <PageSpeedDetailView
                check={props.check}
                theme={props.theme}
                onBack={props.onBack}
                isRunning={props.isRunning ?? false}
                onRecheck={props.onRecheck}
                isRechecking={props.isRechecking}
            />
        )
    }

    const isAltText = props.check.id === "alt-text"
    const dismissedIndices = props.dismissedIndices

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
    const [saveErrorsByNodeId, setSaveErrorsByNodeId] = useState<Map<string, string>>(new Map())
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

    const [componentsOpen, setComponentsOpen] = useState(true)
    const [framesOpen, setFramesOpen] = useState(true)
    const [textStylesOpen, setTextStylesOpen] = useState(true)
    const [componentLockedOpen, setComponentLockedOpen] = useState(true)
    const [componentUnlockedOpen, setComponentUnlockedOpen] = useState(true)
    const [frameLockedOpen, setFrameLockedOpen] = useState(true)
    const [frameUnlockedOpen, setFrameUnlockedOpen] = useState(true)
    const [cmsCollectionOpenByName, setCmsCollectionOpenByName] = useState<Map<string, boolean>>(new Map())
    const [itemGroupByNodeId, setItemGroupByNodeId] = useState<Map<string, "component" | "frame">>(new Map())
    const [itemLockByNodeId, setItemLockByNodeId] = useState<Map<string, boolean>>(new Map())
    const [groupingReady, setGroupingReady] = useState(false)
    const isCmsPagesCheck = props.check.id === "duplicate-cms-content" || props.check.id === "empty-cms-fields"

    const getCompactItemLabel = useCallback((item: CheckItem): string => {
        // Keep full text for checks where the value details are useful.
        const fullLabelChecks = ["responsive-layout", "auto-height", "duplicate-cms-content", "empty-cms-fields", "placeholder-text", "lorem-ipsum", "large-uncompressed-assets"]
        if (fullLabelChecks.includes(props.check.id)) {
            return item.label
        }

        const raw = item.label.trim()
        if (raw.length === 0) return raw

        const colonIndex = raw.indexOf(":")
        const parenIndex = raw.indexOf(" (")
        let cutIndex = raw.length

        if (colonIndex > 0) cutIndex = Math.min(cutIndex, colonIndex)
        if (parenIndex > 0) cutIndex = Math.min(cutIndex, parenIndex)

        const compact = raw.slice(0, cutIndex).trim()
        return compact.length > 0 ? compact : raw
    }, [props.check.id])

    useEffect(() => {
        let cancelled = false

        function isNodeLockedExtensive(node: Record<string, unknown>): boolean {
            if (typeof node.locked === "boolean") return node.locked
            if (typeof node.isLocked === "boolean") return node.isLocked

            const position = node.position
            if (position === "absolute" || position === "fixed") return true

            if (("top" in node && node.top !== null && node.top !== undefined)
                || ("bottom" in node && node.bottom !== null && node.bottom !== undefined)
                || ("left" in node && node.left !== null && node.left !== undefined)
                || ("right" in node && node.right !== null && node.right !== undefined)) {
                return true
            }

            return false
        }

        async function buildItemGroups(): Promise<void> {
            setGroupingReady(false)
            const nodeIds = props.check.items
                .map((item) => item.nodeId)
                .filter((id): id is string => typeof id === "string")
            if (nodeIds.length === 0) {
                setItemGroupByNodeId(new Map())
                setItemLockByNodeId(new Map())
                setGroupingReady(true)
                return
            }

            try {
                const [frameNodes, textNodes, svgNodes, componentDefs, componentInstances] = await Promise.all([
                    framer.getNodesWithType("FrameNode").catch(() => []),
                    framer.getNodesWithType("TextNode").catch(() => []),
                    framer.getNodesWithType("SVGNode").catch(() => []),
                    framer.getNodesWithType("ComponentNode").catch(() => []),
                    framer.getNodesWithType("ComponentInstanceNode").catch(() => []),
                ])

                const allCanvasNodes = [
                    ...frameNodes,
                    ...textNodes,
                    ...svgNodes,
                    ...componentDefs,
                    ...componentInstances,
                ] as Array<CanvasNode>

                const nodeById = new Map<string, CanvasNode>()
                for (const node of allCanvasNodes) {
                    nodeById.set(node.id, node)
                }

                const componentIds = new Set<string>()
                for (const node of componentDefs) componentIds.add(node.id)
                for (const node of componentInstances) componentIds.add(node.id)

                const parentMap = new Map<string, string>()
                await Promise.all(
                    allCanvasNodes.map(async (node) => {
                        try {
                            const parent = await node.getParent()
                            if (parent) parentMap.set(node.id, parent.id)
                        } catch {
                            // ignore parent read failures
                        }
                    }),
                )

                const classifyNodeId = (nodeId: string): "component" | "frame" => {
                    if (componentIds.has(nodeId)) return "component"
                    const visited = new Set<string>()
                    let currentId: string | undefined = nodeId

                    while (currentId) {
                        if (componentIds.has(currentId)) return "component"
                        if (visited.has(currentId)) break
                        visited.add(currentId)
                        const parentId = parentMap.get(currentId)
                        if (!parentId) break
                        currentId = parentId
                    }

                    return "frame"
                }

                const next = new Map<string, "component" | "frame">()
                const nextLocks = new Map<string, boolean>()

                const computeEffectiveLock = (nodeId: string): boolean | undefined => {
                    let currentId: string | undefined = nodeId
                    const visited = new Set<string>()

                    while (currentId) {
                        if (visited.has(currentId)) break
                        visited.add(currentId)

                        const currentNode = nodeById.get(currentId) as unknown as Record<string, unknown> | undefined
                        if (currentNode && isNodeLockedExtensive(currentNode)) return true

                        const parentId = parentMap.get(currentId)
                        if (!parentId) break
                        currentId = parentId
                    }

                    const selfNode = nodeById.get(nodeId) as unknown as Record<string, unknown> | undefined
                    if (!selfNode) return undefined
                    return isNodeLockedExtensive(selfNode)
                }

                for (const nodeId of nodeIds) {
                    next.set(nodeId, classifyNodeId(nodeId))
                    const lockState = computeEffectiveLock(nodeId)
                    if (lockState !== undefined) nextLocks.set(nodeId, lockState)
                }

                if (!cancelled) {
                    setItemGroupByNodeId(next)
                    setItemLockByNodeId(nextLocks)
                    setGroupingReady(true)
                }
            } catch {
                if (!cancelled) {
                    setItemGroupByNodeId(new Map())
                    setItemLockByNodeId(new Map())
                    setGroupingReady(true)
                }
            }
        }

        void buildItemGroups()
        return () => {
            cancelled = true
        }
    }, [props.check.items])

    useEffect(() => {
        if (!isCmsPagesCheck) {
            setCmsCollectionOpenByName(new Map())
            return
        }

        const collectionNames = Array.from(new Set(props.check.items.map((item) => item.groupLabel?.trim() || "CMS Collection")))
        setCmsCollectionOpenByName((previous) => {
            const next = new Map(previous)
            let didChange = false

            for (const name of collectionNames) {
                if (!next.has(name)) {
                    next.set(name, true)
                    didChange = true
                }
            }

            for (const name of Array.from(next.keys())) {
                if (!collectionNames.includes(name)) {
                    next.delete(name)
                    didChange = true
                }
            }

            return didChange ? next : previous
        })
    }, [isCmsPagesCheck, props.check.items])
            const renderDismissButton = (
                onClick: () => void,
                title: string,
                style: React.CSSProperties,
            ) => (
                <button
                    onClick={(e) => { e.stopPropagation(); onClick() }}
                    title={title}
                    style={style}
                >
                    <svg width="7" height="7" viewBox="0 0 7 7" fill="none">
                        <path d="M1.5 1.5L5.5 5.5M5.5 1.5L1.5 5.5" stroke={colors.text.secondary} strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                </button>
            )

            const renderDismissControls = (entries: {item: CheckItem, index: number}[], title: string) => {
                if (entries.length === 0) return null

                return renderDismissButton(
                    () => {
                        entries.forEach(({ index }) => props.onDismiss(index))
                    },
                    title,
                    {
                        width: 14,
                        height: 14,
                        borderRadius: "50%",
                        backgroundColor: colors.card.bg,
                        border: `1px solid ${colors.card.border}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        padding: 0,
                        flexShrink: 0,
                    },
                )
            }

    const getItemGroup = useCallback((item: CheckItem): "component" | "frame" | "text-style" => {
        if (item.nodeId === null && item.label.startsWith("Text style \"")) return "text-style"
        if (item.nodeId !== null) {
            const grouped = itemGroupByNodeId.get(item.nodeId)
            if (grouped) return grouped
        }
        if (item.label.startsWith("Component '") || item.label.startsWith("Component \"")) return "component"
        return "frame"
    }, [itemGroupByNodeId])

    const getItemLock = useCallback((item: CheckItem): boolean | undefined => {
        if (item.nodeId !== null) {
            const liveLock = itemLockByNodeId.get(item.nodeId)
            if (liveLock !== undefined) return liveLock
        }
        return item.locked
    }, [itemLockByNodeId])

    const handleGoTo = useCallback(async (nodeId: string) => {
        try {
            await framer.navigateTo(nodeId, { select: true, zoomIntoView: true })
        } catch {
            // ignore navigation errors
        }
    }, [])

    const findAncestorComponentNode = useCallback(async (start: unknown): Promise<ComponentNodeWithVariables | null> => {
        let current = start as FrameNodeWithParent | null
        let safety = 0

        while (current && safety < 30) {
            if (typeof current.getParent !== "function") return null

            const parent = await current.getParent().catch(() => null)
            if (!parent || typeof parent !== "object") return null

            const parentObj = parent as Record<string, unknown>
            if (typeof parentObj.id === "string" && typeof parentObj.getVariables === "function") {
                return {
                    id: parentObj.id,
                    getVariables: parentObj.getVariables as () => Promise<ReadonlyArray<unknown>>,
                }
            }

            current = parent as FrameNodeWithParent
            safety += 1
        }

        return null
    }, [])

    const getImageAssetId = useCallback((value: unknown): string | null => {
        if (!value || typeof value !== "object") return null
        const maybeId = (value as { id?: unknown }).id
        return typeof maybeId === "string" && maybeId.length > 0 ? maybeId : null
    }, [])

    const getMatchingImageVariables = useCallback((variables: ReadonlyArray<unknown>, imageId: string): ImageVariableEditable[] => {
        return variables.filter((candidate): candidate is ImageVariableEditable => {
            if (!candidate || typeof candidate !== "object") return false
            const variable = candidate as ImageVariableEditable
            if (variable.type !== "image") return false
            if (typeof variable.setAttributes !== "function") return false

            const defaultId = getImageAssetId(variable.defaultValue)
            return defaultId === imageId
        })
    }, [getImageAssetId])

    const collectEditableImageVariablesFromValue = useCallback((value: unknown): ImageVariableEditable[] => {
        if (!value || typeof value !== "object") return []

        const found: ImageVariableEditable[] = []
        const seenObjects = new WeakSet<object>()
        const seenVariableIds = new Set<string>()

        const visit = (candidate: unknown, depth: number): void => {
            if (!candidate || typeof candidate !== "object" || depth > 8) return

            const objectCandidate = candidate as object
            if (seenObjects.has(objectCandidate)) return
            seenObjects.add(objectCandidate)

            const maybeVariable = candidate as ImageVariableEditable
            const defaultValue = maybeVariable.defaultValue as ImageAssetEditable | undefined
            const canEditImageVariable = maybeVariable.type === "image"
                && typeof maybeVariable.setAttributes === "function"
                && !!defaultValue
                && typeof defaultValue.cloneWithAttributes === "function"

            if (canEditImageVariable) {
                const variableId = typeof maybeVariable.id === "string" ? maybeVariable.id : null
                if (!variableId || !seenVariableIds.has(variableId)) {
                    if (variableId) seenVariableIds.add(variableId)
                    found.push(maybeVariable)
                }
            }

            if (Array.isArray(candidate)) {
                for (const entry of candidate) visit(entry, depth + 1)
                return
            }

            for (const nested of Object.values(candidate as Record<string, unknown>)) {
                visit(nested, depth + 1)
            }
        }

        visit(value, 0)
        return found
    }, [])

    const saveAltTextOnComponentInstanceImageVariables = useCallback(async (componentNode: unknown, newAltText: string): Promise<"updated" | "no-match"> => {
        if (!componentNode || typeof componentNode !== "object") return "no-match"

        const componentRecord = componentNode as Record<string, unknown>
        const variableCandidates = collectEditableImageVariablesFromValue([
            componentRecord.typedControls,
            componentRecord.controls,
            componentRecord.props,
            componentRecord.properties,
            componentRecord.componentProperties,
        ])
        if (variableCandidates.length === 0) return "no-match"

        let updatedCount = 0
        for (const variable of variableCandidates) {
            const defaultValue = variable.defaultValue as ImageAssetEditable | undefined
            if (!defaultValue || typeof defaultValue.cloneWithAttributes !== "function") continue

            const updated = defaultValue.cloneWithAttributes({ altText: newAltText })
            await variable.setAttributes?.({ defaultValue: updated })
            updatedCount += 1
        }

        return updatedCount > 0 ? "updated" : "no-match"
    }, [collectEditableImageVariablesFromValue])

    const saveAltTextOnComponentInstanceImageControls = useCallback(async (componentNode: unknown, newAltText: string): Promise<"updated" | "no-match"> => {
        if (!componentNode || typeof componentNode !== "object") return "no-match"

        const nodeRecord = componentNode as Record<string, unknown>
        const setAttributes = nodeRecord.setAttributes
        if (typeof setAttributes !== "function") return "no-match"

        const controls = (nodeRecord.controls && typeof nodeRecord.controls === "object")
            ? (nodeRecord.controls as Record<string, unknown>)
            : {}
        const typedControls = (nodeRecord.typedControls && typeof nodeRecord.typedControls === "object")
            ? (nodeRecord.typedControls as Record<string, unknown>)
            : {}

        const updatedControls: Record<string, unknown> = { ...controls }
        let updatedCount = 0

        for (const [key, typed] of Object.entries(typedControls)) {
            const typedRecord = typed as ImageControlValue | undefined
            const typedType = typeof typedRecord?.type === "string" ? typedRecord.type : ""
            if (typedType !== "image") continue

            const candidateFromTyped = typedRecord?.value as ImageAssetEditable | undefined
            const candidateFromControls = controls[key] as ImageAssetEditable | undefined
            const imageValue = (candidateFromTyped && typeof candidateFromTyped.cloneWithAttributes === "function")
                ? candidateFromTyped
                : ((candidateFromControls && typeof candidateFromControls.cloneWithAttributes === "function") ? candidateFromControls : null)
            if (!imageValue) continue

            updatedControls[key] = imageValue.cloneWithAttributes({ altText: newAltText })
            updatedCount += 1
        }

        // Some runtimes expose image control values only in controls.
        for (const [key, value] of Object.entries(controls)) {
            if (key in updatedControls && updatedControls[key] !== controls[key]) continue
            const imageValue = value as ImageAssetEditable | undefined
            if (!imageValue || typeof imageValue.cloneWithAttributes !== "function") continue
            updatedControls[key] = imageValue.cloneWithAttributes({ altText: newAltText })
            updatedCount += 1
        }

        if (updatedCount === 0) return "no-match"

        await (setAttributes as (attrs: Record<string, unknown>) => Promise<unknown>)({
            controls: updatedControls,
        })

        return "updated"
    }, [])

    const saveAltTextOnImageVariable = useCallback(async (frameNode: unknown, updated: ImageAssetEditable): Promise<"updated" | "no-match" | "not-component"> => {
        const ownerComponent = await findAncestorComponentNode(frameNode)
        if (!ownerComponent) return "not-component"

        const imageId = getImageAssetId(updated)
        if (!imageId) return "no-match"

        const componentVariables = await ownerComponent.getVariables().catch(() => [])
        const matchingVariables = getMatchingImageVariables(componentVariables, imageId)
        if (matchingVariables.length === 0) return "no-match"

        await Promise.all(
            matchingVariables.map((variable) => variable.setAttributes?.({ defaultValue: updated })),
        )

        return "updated"
    }, [])

    const handleSaveAltText = useCallback(async (nodeId: string) => {
        const newAltText = altInputs[nodeId]?.trim() ?? ""
        if (!newAltText) return

        setSavingNodes((prev) => { const n = new Set(prev); n.add(nodeId); return n })
        setSaveErrorsByNodeId((prev) => {
            if (!prev.has(nodeId)) return prev
            const next = new Map(prev)
            next.delete(nodeId)
            return next
        })
        try {
            const framerAny = framer as unknown as { getNode?: (id: string) => Promise<unknown>; setAttributes?: (id: string, attrs: Record<string, unknown>) => Promise<void> }
            const node = typeof framerAny.getNode === "function"
                ? await framerAny.getNode(nodeId).catch(() => null)
                : null

            if (!node || typeof node !== "object") {
                setSaveErrorsByNodeId((prev) => {
                    const next = new Map(prev)
                    next.set(nodeId, "Could not locate this node in Framer.")
                    return next
                })
                return
            }

            const nodeRecord = node as Record<string, unknown>
            const frameImage = nodeRecord.backgroundImage as ImageAssetEditable | null

            if (frameImage && typeof frameImage.cloneWithAttributes === "function") {
                const updated = frameImage.cloneWithAttributes({ altText: newAltText })

                const variableSaveResult = await saveAltTextOnImageVariable(node, updated)
                if (variableSaveResult === "updated") {
                    setSavedNodes((prev) => { const n = new Set(prev); n.add(nodeId); return n })
                    return
                }

                if (typeof framerAny.setAttributes === "function") {
                    await framerAny.setAttributes(nodeId, { backgroundImage: updated })
                }

                setSavedNodes((prev) => { const n = new Set(prev); n.add(nodeId); return n })
                setSaveErrorsByNodeId((prev) => {
                    if (!prev.has(nodeId)) return prev
                    const next = new Map(prev)
                    next.delete(nodeId)
                    return next
                })
                return
            }

            const componentVariableSave = await saveAltTextOnComponentInstanceImageVariables(node, newAltText)
            if (componentVariableSave === "updated") {
                setSavedNodes((prev) => { const n = new Set(prev); n.add(nodeId); return n })
                setSaveErrorsByNodeId((prev) => {
                    if (!prev.has(nodeId)) return prev
                    const next = new Map(prev)
                    next.delete(nodeId)
                    return next
                })
                return
            }

            const componentControlSave = await saveAltTextOnComponentInstanceImageControls(node, newAltText)
            if (componentControlSave === "updated") {
                setSavedNodes((prev) => { const n = new Set(prev); n.add(nodeId); return n })
                setSaveErrorsByNodeId((prev) => {
                    if (!prev.has(nodeId)) return prev
                    const next = new Map(prev)
                    next.delete(nodeId)
                    return next
                })
                return
            }

            setSaveErrorsByNodeId((prev) => {
                const next = new Map(prev)
                next.set(nodeId, "No editable image variable was found for this item.")
                return next
            })
        } catch {
            setSaveErrorsByNodeId((prev) => {
                const next = new Map(prev)
                next.set(nodeId, "Could not save alt text. Please edit this image directly in Framer.")
                return next
            })
        } finally {
            setSavingNodes((prev) => { const n = new Set(prev); n.delete(nodeId); return n })
        }
    }, [altInputs, saveAltTextOnComponentInstanceImageControls, saveAltTextOnComponentInstanceImageVariables, saveAltTextOnImageVariable])

    const renderItemMap = (entries: {item: CheckItem, index: number}[]) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, width: "100%" }}>
            {entries.map(({ item, index: i }) => {
                if (dismissedIndices.has(i)) return null

                if (isAltText && item.nodeId !== null) {
                    const nodeId = item.nodeId
                    const isSaving = savingNodes.has(nodeId)
                    const isSaved = savedNodes.has(nodeId)
                    const inputVal = altInputs[nodeId] ?? ""
                    const saveError = saveErrorsByNodeId.get(nodeId) ?? null
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
                                {item.previewUrl && (
                                    <img
                                        src={item.previewUrl}
                                        style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 4, flexShrink: 0 }}
                                        alt=""
                                    />
                                )}
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
                                    {getCompactItemLabel(item)}
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
                                        if (saveError) {
                                            setSaveErrorsByNodeId((prev) => {
                                                if (!prev.has(nodeId)) return prev
                                                const next = new Map(prev)
                                                next.delete(nodeId)
                                                return next
                                            })
                                        }
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
                            {saveError && (
                                <div
                                    style={{
                                        padding: "0 10px 8px",
                                        fontSize: 10,
                                        lineHeight: 1.35,
                                        color: colors.status.warning,
                                    }}
                                >
                                    {saveError}
                                </div>
                            )}
                            {hoveredIndex === i && renderDismissButton(
                                () => props.onDismiss(i),
                                "Dismiss",
                                {
                                    position: "absolute",
                                    top: -5,
                                    right: -5,
                                    width: 14,
                                    height: 14,
                                    borderRadius: "50%",
                                    backgroundColor: colors.card.bg,
                                    border: `1px solid ${colors.card.border}`,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    cursor: "pointer",
                                    padding: 0,
                                    zIndex: 2,
                                },
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
                            {getCompactItemLabel(item)}
                        </span>
                        {item.badge && (
                            <span
                                style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    color: colors.text.secondary,
                                    backgroundColor: `${colors.text.secondary}14`,
                                    borderRadius: 4,
                                    padding: "1px 5px",
                                    flexShrink: 0,
                                    maxWidth: 120,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                {item.badge}
                            </span>
                        )}
                        {item.pageLabel && (getItemGroup(item) === "frame" || props.check.id === "breakpoint-widths" || isCmsPagesCheck) && (
                            <span
                                style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    color: colors.badge.text,
                                    backgroundColor: colors.badge.bg,
                                    borderRadius: 4,
                                    padding: "1px 5px",
                                    flexShrink: 0,
                                    maxWidth: 120,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                {item.pageLabel}
                            </span>
                        )}
                        {item.nodeId !== null && (
                            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0, opacity: 0.55 }}>
                                <path d="M2.5 6.5H10.5M7.5 3.5L10.5 6.5L7.5 9.5" stroke={statusColor} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        )}
                        {hoveredIndex === i && renderDismissButton(
                            () => props.onDismiss(i),
                            "Dismiss",
                            {
                                position: "absolute",
                                top: -5,
                                right: -5,
                                width: 14,
                                height: 14,
                                borderRadius: "50%",
                                backgroundColor: colors.card.bg,
                                border: `1px solid ${colors.card.border}`,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                                padding: 0,
                                zIndex: 2,
                            },
                        )}
                    </div>
                )
            })}
        </div>
    )

    const itemEntries = props.check.items.map((item, i) => ({ item, index: i }))
    const filteredEntries = itemEntries.filter((e) => !props.dismissedIndices.has(e.index))
    const useSimpleListLayout = props.check.id === "component-file-structure" || props.check.id === "page-settings"
    const hasNodeBackedItems = filteredEntries.some((e) => e.item.nodeId !== null)
    const shouldRenderGroupedItems = !hasNodeBackedItems || groupingReady
    const passedCount = itemEntries.length - filteredEntries.length
    const failedCount = filteredEntries.length

    const cmsCollectionGroups = isCmsPagesCheck
        ? filteredEntries.reduce<Map<string, Array<{ item: CheckItem; index: number }>>>((groups, entry) => {
            const collectionName = entry.item.groupLabel?.trim() || "CMS Collection"
            const existing = groups.get(collectionName)
            if (existing) {
                existing.push(entry)
            } else {
                groups.set(collectionName, [entry])
            }
            return groups
        }, new Map())
        : new Map<string, Array<{ item: CheckItem; index: number }>>()

    const toggleCmsCollection = useCallback((collectionName: string) => {
        setCmsCollectionOpenByName((previous) => {
            const next = new Map(previous)
            next.set(collectionName, !(next.get(collectionName) ?? true))
            return next
        })
    }, [])

    const textStyleEntries = filteredEntries.filter((e) => getItemGroup(e.item) === "text-style")
    const componentEntries = filteredEntries.filter((e) => getItemGroup(e.item) === "component")
    const frameEntries = filteredEntries.filter((e) => getItemGroup(e.item) === "frame")

    const componentHasLockSections = componentEntries.some((e) => getItemLock(e.item) !== undefined)
    const frameHasLockSections = frameEntries.some((e) => getItemLock(e.item) !== undefined)

    const componentLockedEntries = componentEntries.filter((e) => getItemLock(e.item) === true)
    const componentUnlockedEntries = componentEntries.filter((e) => getItemLock(e.item) === false)
    const componentOtherEntries = componentEntries.filter((e) => getItemLock(e.item) === undefined)

    const frameLockedEntries = frameEntries.filter((e) => getItemLock(e.item) === true)
    const frameUnlockedEntries = frameEntries.filter((e) => getItemLock(e.item) === false)
    const frameOtherEntries = frameEntries.filter((e) => getItemLock(e.item) === undefined)

    return (
        <div style={{ display: "flex", flexDirection: "column", width: "100%", alignItems: "flex-start" }}>
            {/* Back button */}
            <div style={{ display: "flex", alignItems: "center", width: "100%", marginBottom: 12 }}>
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
                        padding: 0,
                        alignSelf: "flex-start",
                        width: "fit-content",
                    }}
                >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
                        <path d="M9 2.5L5 7L9 11.5" stroke={colors.text.secondary} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Back
                </button>
                <div style={{ marginLeft: "auto" }}>
                    <RecheckButton onClick={props.onRecheck} disabled={props.isRechecking || !!props.isRunning} />
                </div>
            </div>

            {/* Check label + status */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, width: "100%" }}>
                <StatusIcon status={props.check.status} theme={props.theme} />
                <span style={{ fontSize: 14, fontWeight: 600, color: colors.text.primary, flex: 1, minWidth: 0 }}>
                    {props.check.label}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: colors.status.fail, backgroundColor: `${colors.status.fail}18`, borderRadius: 4, padding: "1px 5px" }}>
                        {failedCount}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: colors.status.pass, backgroundColor: `${colors.status.pass}18`, borderRadius: 4, padding: "1px 5px" }}>
                        {passedCount}
                    </span>
                </div>
            </div>

            {/* Detail text */}
            {props.check.detail && (() => {
                const guidance = getDetailGuidance(props.check)
                return (
                    <div
                        style={{
                            fontSize: 12,
                            color: colors.text.secondary,
                            backgroundColor: `${statusColor}0C`,
                            border: `1px solid ${statusColor}22`,
                            borderRadius: 7,
                            padding: "8px 10px",
                            marginBottom: 12,
                            lineHeight: 1.45,
                        }}
                    >
                        <div>
                            {props.check.detail}
                        </div>
                        <div style={{ marginTop: 6 }}>
                            {guidance.nextStep}
                        </div>
                    </div>
                )
            })()}

            {isCmsPagesCheck && props.check.items.length > 0 && shouldRenderGroupedItems && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 8, width: "100%" }}>
                    {Array.from(cmsCollectionGroups.entries()).map(([collectionName, entries]) => (
                        <div key={collectionName} style={{ border: `1px solid ${colors.card.border}`, borderRadius: 8, overflow: "hidden", backgroundColor: colors.card.bg }}>
                            <div
                                onClick={() => toggleCmsCollection(collectionName)}
                                style={{ padding: "8px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, backgroundColor: colors.card.bg }}
                            >
                                <ChevronIcon open={cmsCollectionOpenByName.get(collectionName) ?? true} color={colors.text.quaternary} />
                                <span style={{ fontSize: 12, fontWeight: 600, color: colors.text.secondary, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {collectionName} ({entries.length})
                                </span>
                            </div>
                            {(cmsCollectionOpenByName.get(collectionName) ?? true) && (
                                <div style={{ padding: "0 5px 5px 5px", backgroundColor: colors.card.bg }}>
                                    {renderItemMap(entries)}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Items list */}
            {props.check.items.length > 0 && shouldRenderGroupedItems && useSimpleListLayout && !isCmsPagesCheck && (
                <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingBottom: 8, width: "100%" }}>
                    {renderItemMap(filteredEntries)}
                </div>
            )}

            {props.check.items.length > 0 && shouldRenderGroupedItems && !useSimpleListLayout && !isCmsPagesCheck && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 8, width: "100%" }}>
                    {componentEntries.length > 0 && (
                        <div style={{ border: `1px solid ${colors.card.border}`, borderRadius: 8, overflow: "hidden" }}>
                            <div
                                onClick={() => setComponentsOpen(!componentsOpen)}
                                style={{ padding: "8px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, backgroundColor: colors.card.bg }}
                            >
                                <ChevronIcon open={componentsOpen} color={colors.text.quaternary} />
                                <span style={{ fontSize: 12, fontWeight: 600, color: colors.text.secondary }}>Components ({componentEntries.length})</span>
                            </div>
                            {componentsOpen && (
                                <div style={{ padding: "0 6px 6px 6px", backgroundColor: colors.card.bg, display: "flex", flexDirection: "column", gap: 6 }}>
                                    {componentHasLockSections && componentLockedEntries.length > 0 && (
                                        <div style={{ border: `1px solid ${colors.card.border}`, borderRadius: 7, overflow: "hidden" }}>
                                            <div
                                                onClick={() => setComponentLockedOpen(!componentLockedOpen)}
                                                style={{ padding: "7px 9px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, backgroundColor: colors.card.bg }}
                                            >
                                                <ChevronIcon open={componentLockedOpen} color={colors.text.quaternary} />
                                                <span style={{ fontSize: 12, fontWeight: 600, color: colors.text.secondary, display: "flex", alignItems: "center", gap: 5 }}>
                                                    <LockIcon color={colors.text.secondary} />
                                                    Locked ({componentLockedEntries.length})
                                                </span>
                                                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
                                                    {renderDismissControls(componentLockedEntries, "Dismiss locked items")}
                                                </div>
                                            </div>
                                            {componentLockedOpen && (
                                                <div style={{ padding: "0 5px 5px 5px", backgroundColor: colors.card.bg }}>
                                                    {renderItemMap(componentLockedEntries)}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {componentHasLockSections && componentUnlockedEntries.length > 0 && (
                                        <div style={{ border: `1px solid ${colors.card.border}`, borderRadius: 7, overflow: "hidden" }}>
                                            <div
                                                onClick={() => setComponentUnlockedOpen(!componentUnlockedOpen)}
                                                style={{ padding: "7px 9px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, backgroundColor: colors.card.bg }}
                                            >
                                                <ChevronIcon open={componentUnlockedOpen} color={colors.text.quaternary} />
                                                <span style={{ fontSize: 12, fontWeight: 600, color: colors.text.secondary }}>Unlocked ({componentUnlockedEntries.length})</span>
                                                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
                                                    {renderDismissControls(componentUnlockedEntries, "Dismiss unlocked items")}
                                                </div>
                                            </div>
                                            {componentUnlockedOpen && (
                                                <div style={{ padding: "0 5px 5px 5px", backgroundColor: colors.card.bg }}>
                                                    {renderItemMap(componentUnlockedEntries)}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {(!componentHasLockSections || componentOtherEntries.length > 0) && renderItemMap(componentOtherEntries)}
                                </div>
                            )}
                        </div>
                    )}

                    {frameEntries.length > 0 && (
                        <div style={{ border: `1px solid ${colors.card.border}`, borderRadius: 8, overflow: "hidden" }}>
                            <div
                                onClick={() => setFramesOpen(!framesOpen)}
                                style={{ padding: "8px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, backgroundColor: colors.card.bg }}
                            >
                                <ChevronIcon open={framesOpen} color={colors.text.quaternary} />
                                <span style={{ fontSize: 12, fontWeight: 600, color: colors.text.secondary }}>Frames ({frameEntries.length})</span>
                            </div>
                            {framesOpen && (
                                <div style={{ padding: "0 6px 6px 6px", backgroundColor: colors.card.bg, display: "flex", flexDirection: "column", gap: 6 }}>
                                    {frameHasLockSections && frameLockedEntries.length > 0 && (
                                        <div style={{ border: `1px solid ${colors.card.border}`, borderRadius: 7, overflow: "hidden" }}>
                                            <div
                                                onClick={() => setFrameLockedOpen(!frameLockedOpen)}
                                                style={{ padding: "7px 9px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, backgroundColor: colors.card.bg }}
                                            >
                                                <ChevronIcon open={frameLockedOpen} color={colors.text.quaternary} />
                                                <span style={{ fontSize: 12, fontWeight: 600, color: colors.text.secondary, display: "flex", alignItems: "center", gap: 5 }}>
                                                    <LockIcon color={colors.text.secondary} />
                                                    Locked ({frameLockedEntries.length})
                                                </span>
                                                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
                                                    {renderDismissControls(frameLockedEntries, "Dismiss locked items")}
                                                </div>
                                            </div>
                                            {frameLockedOpen && (
                                                <div style={{ padding: "0 5px 5px 5px", backgroundColor: colors.card.bg }}>
                                                    {renderItemMap(frameLockedEntries)}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {frameHasLockSections && frameUnlockedEntries.length > 0 && (
                                        <div style={{ border: `1px solid ${colors.card.border}`, borderRadius: 7, overflow: "hidden" }}>
                                            <div
                                                onClick={() => setFrameUnlockedOpen(!frameUnlockedOpen)}
                                                style={{ padding: "7px 9px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, backgroundColor: colors.card.bg }}
                                            >
                                                <ChevronIcon open={frameUnlockedOpen} color={colors.text.quaternary} />
                                                <span style={{ fontSize: 12, fontWeight: 600, color: colors.text.secondary }}>Unlocked ({frameUnlockedEntries.length})</span>
                                                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
                                                    {renderDismissControls(frameUnlockedEntries, "Dismiss unlocked items")}
                                                </div>
                                            </div>
                                            {frameUnlockedOpen && (
                                                <div style={{ padding: "0 5px 5px 5px", backgroundColor: colors.card.bg }}>
                                                    {renderItemMap(frameUnlockedEntries)}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {(!frameHasLockSections || frameOtherEntries.length > 0) && renderItemMap(frameOtherEntries)}
                                </div>
                            )}
                        </div>
                    )}

                    {textStyleEntries.length > 0 && (
                        <div style={{ border: `1px solid ${colors.card.border}`, borderRadius: 8, overflow: "hidden" }}>
                            <div
                                onClick={() => setTextStylesOpen(!textStylesOpen)}
                                style={{ padding: "8px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, backgroundColor: colors.card.bg }}
                            >
                                <ChevronIcon open={textStylesOpen} color={colors.text.quaternary} />
                                <span style={{ fontSize: 12, fontWeight: 600, color: colors.text.secondary }}>Text Styles ({textStyleEntries.length})</span>
                            </div>
                            {textStylesOpen && (
                                <div style={{ padding: "0 6px 6px 6px", backgroundColor: colors.card.bg, display: "flex", flexDirection: "column", gap: 6 }}>
                                    {renderItemMap(textStyleEntries)}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {props.check.items.length > 0 && !shouldRenderGroupedItems && (
                <div style={{ width: "100%", paddingBottom: 8 }}>
                    <div style={{ fontSize: 12, color: colors.text.tertiary, padding: "6px 2px" }}>Loading…</div>
                </div>
            )}

            {props.check.items.length === 0 && (
                <span style={{ fontSize: 12, color: colors.text.tertiary }}>No items to show.</span>
            )}
        </div>
    )
}

// --- Padding & Gap Page ---

function PaddingPage(props: { theme: ThemeMode; colors: typeof THEME_COLORS.dark }): React.ReactElement {
    const { colors } = props

    const defaultBpConfig = (id: string): PaddingBreakpointConfig => ({
        breakpointId: id,
        gap: { enabled: true, value: "" },
        padding: { enabled: true, mode: "uniform", uniform: "", top: "", right: "", bottom: "", left: "" }
    })

    const createEmptySection = (id: string): PaddingSection => ({
        id,
        frames: [],
        configs: [defaultBpConfig("L")],
        isLocked: false,
    })

    const [sections, setSections] = useState<PaddingSection[]>([createEmptySection("section-1")])
    const [currentSectionIndex, setCurrentSectionIndex] = useState(0)
    const [currentBpId, setCurrentBpId] = useState<string>("L")

    const currentSection = sections[currentSectionIndex]
    const currentConfig = currentSection?.configs.find((c: PaddingBreakpointConfig) => c.breakpointId === currentBpId) || currentSection?.configs[0]

    const [hoveredFrameIdx, setHoveredFrameIdx] = useState<number | null>(null)
    const [addFramesState, setAddFramesState] = useState<"idle" | "active" | "prompt">("idle")
    const [promptMsg, setPromptMsg] = useState("")

    const padRefs = useRef<Array<HTMLInputElement | null>>([null, null, null, null])
    const [results, setResults] = useState<PaddingReport | null>(null)
    const [isChecking, setIsChecking] = useState(false)
    const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set([0]))
    const [resultsBpFilter, setResultsBpFilter] = useState<string>("L")

    useEffect(() => {
        if (currentConfig?.padding.mode === "individual" && !currentSection.isLocked) {
            setTimeout(() => padRefs.current[0]?.focus(), 0)
        }
    }, [currentConfig?.padding.mode, currentSection?.isLocked])

    const updateConfig = (updater: (config: PaddingBreakpointConfig) => PaddingBreakpointConfig) => {
        setSections(prev => {
            const next = [...prev]
            const sec = { ...next[currentSectionIndex] }
            sec.configs = sec.configs.map(c => c.breakpointId === currentConfig.breakpointId ? updater(c) : c)
            next[currentSectionIndex] = sec
            return next
        })
    }

    const handleAddSelected = useCallback(async () => {
        setAddFramesState("active")
        try {
            const framerAny = framer as unknown as Record<string, unknown>
            if (typeof framerAny.getSelection !== "function") return
            const selected = await (framerAny.getSelection as () => Promise<CanvasNode[]>)()
            const frameNodes = selected.filter(isFrameNode)
            
            if (frameNodes.length === 0) {
                setPromptMsg("No frames selected")
            } else {
                setSections(prev => {
                    const next = [...prev]
                    const sec = { ...next[currentSectionIndex] }
                    const existingIds = new Set(sec.frames.map(f => f.id))
                    const incoming = frameNodes
                        .filter(f => !existingIds.has(f.id))
                        .map(f => ({
                            id: f.id,
                            name: (typeof (f as unknown as Record<string, unknown>).name === "string" ? (f as unknown as Record<string, unknown>).name as string : null) || f.id,
                        }))
                    sec.frames = [...sec.frames, ...incoming]
                    next[currentSectionIndex] = sec
                    return next
                })
                setPromptMsg(`Added ${frameNodes.length} frames`)
            }
        } catch { 
            setPromptMsg("Error adding frames")
        } finally { 
            setAddFramesState("prompt")
            setTimeout(() => setAddFramesState("idle"), 1500)
        }
    }, [currentSectionIndex])

    const handleAddBreakpoint = useCallback(() => {
        const availableBps = ["L", "M", "S"]
        const existingBps = new Set(currentSection.configs.map((c: PaddingBreakpointConfig) => c.breakpointId))
        const nextBp = availableBps.find(b => !existingBps.has(b))
        if (!nextBp) return // max reached

        setSections(prev => {
            const next = [...prev]
            const sec = { ...next[currentSectionIndex] }
            sec.configs = [...sec.configs, defaultBpConfig(nextBp)]
            next[currentSectionIndex] = sec
            return next
        })
        setCurrentBpId(nextBp)
    }, [currentSectionIndex, currentSection])

    const handleNextSection = useCallback(() => {
        setSections(prev => [...prev, createEmptySection(`section-${prev.length + 1}`)])
        setCurrentSectionIndex(prev => prev + 1)
        setCurrentBpId("L")
    }, [])

    const handleFinish = useCallback(async () => {
        setIsChecking(true)
        try {
            const report = await checkPaddingAndGap(sections)
            setResults(report)
            const availableBps = Array.from(new Set(report.sections.flatMap(s => s.results.map(r => r.breakpointId))))
            if (availableBps.length > 0 && !availableBps.includes(resultsBpFilter)) {
                setResultsBpFilter(availableBps[0])
            }
        } catch { /* ignore */ } finally { setIsChecking(false) }
    }, [sections, resultsBpFilter])

    const handleReset = useCallback(() => {
        setResults(null); setSections([createEmptySection("section-1")]); setCurrentSectionIndex(0); setCurrentBpId("L")
    }, [])

    if (results !== null) {
        const s = THEME_COLORS[props.theme].status
        const availableBps = Array.from(new Set(results.sections.flatMap(sec => sec.results.map(r => r.breakpointId))))
        return (
            <>
            <div style={{ flex: 1, overflowY: "auto", paddingTop: 12, paddingBottom: 60 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase" as const, color: colors.text.secondary }}>
                        Results
                    </span>
                    {availableBps.length > 0 && (
                        <div style={{ display: "flex", backgroundColor: colors.card.bg, borderRadius: 6, border: `1px solid ${colors.card.border}`, overflow: "hidden" }}>
                            {availableBps.map((bp, i) => (
                                <button
                                    key={bp}
                                    onClick={() => setResultsBpFilter(bp)}
                                    style={{
                                        backgroundColor: bp === resultsBpFilter ? colors.card.border : "transparent",
                                        color: bp === resultsBpFilter ? colors.text.primary : colors.text.secondary,
                                        border: "none", padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                                        borderRight: i < availableBps.length - 1 ? `1px solid ${colors.card.border}` : "none"
                                    }}
                                >
                                    {bp}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {results.sections.map((entry, sIdx) => {
                    const bpResult = entry.results.find(r => r.breakpointId === resultsBpFilter)
                    if (!bpResult) return null

                    const failMap = new Map<string, { nodeName: string; issues: string[] }>()
                    for (const item of bpResult.items) {
                        const existing = failMap.get(item.nodeId)
                        if (existing) {
                            existing.issues.push(`${item.property}: ${item.expected}≠${item.actual}`)
                        } else {
                            failMap.set(item.nodeId, { nodeName: item.nodeName, issues: [`${item.property}: ${item.expected}≠${item.actual}`] })
                        }
                    }
                    
                    const failingIds = new Set(failMap.keys())
                    const passingFrames = entry.section.frames.filter(f => !failingIds.has(f.id))
                    const isOpen = expandedSections.has(sIdx)
                    const toggleSection = () => setExpandedSections(prev => {
                        const next = new Set(prev)
                        if (next.has(sIdx)) next.delete(sIdx); else next.add(sIdx)
                        return next
                    })

                    return (
                        <div key={entry.section.id} style={{ marginBottom: 6 }}>
                            <div onClick={toggleSection}
                                style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                                    padding: "8px 10px", borderRadius: 8,
                                    backgroundColor: colors.card.bg, border: `1px solid ${colors.card.border}`,
                                    cursor: "pointer", userSelect: "none" as const }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                    <ChevronIcon open={isOpen} color={colors.text.quaternary} />
                                    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase" as const, color: colors.text.secondary }}>
                                        Check {sIdx + 1}
                                    </span>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                    {failMap.size > 0 && (
                                        <span style={{ fontSize: 10, fontWeight: 700, color: s.fail, backgroundColor: `${s.fail}18`, borderRadius: 4, padding: "1px 5px" }}>
                                            {failMap.size}
                                        </span>
                                    )}
                                    {passingFrames.length > 0 && (
                                        <span style={{ fontSize: 10, fontWeight: 700, color: s.pass, backgroundColor: `${s.pass}18`, borderRadius: 4, padding: "1px 5px" }}>
                                            {passingFrames.length}
                                        </span>
                                    )}
                                </div>
                            </div>
                            {isOpen && (
                                <div style={{ paddingTop: 4 }}>
                                    {Array.from(failMap.entries()).map(([nodeId, { nodeName, issues }]) => (
                                        <div key={nodeId}
                                            onClick={() => { void framer.navigateTo(nodeId, { select: true }) }}
                                            style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6,
                                                padding: "7px 10px", borderRadius: 7, marginBottom: 2,
                                                backgroundColor: colors.card.bg,
                                                border: `1px solid ${s.fail}28`, borderLeft: `3px solid ${s.fail}`,
                                                cursor: "pointer" }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 7, flex: 1, minWidth: 0 }}>
                                                <StatusIcon status="fail" theme={props.theme} />
                                                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                                                    <span style={{ fontSize: 12, fontWeight: 500, color: colors.text.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                        {nodeName}
                                                    </span>
                                                    {issues.map((issue, i) => (
                                                        <span key={i} style={{ fontSize: 10, color: s.fail, lineHeight: 1.4 }}>{issue}</span>
                                                    ))}
                                                </div>
                                            </div>
                                            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.5px", color: s.fail, backgroundColor: `${s.fail}18`, borderRadius: 4, padding: "2px 6px", flexShrink: 0 }}>
                                                FAIL
                                            </span>
                                        </div>
                                    ))}
                                    {passingFrames.map(frame => (
                                        <div key={frame.id}
                                            onClick={() => { void framer.navigateTo(frame.id, { select: true }) }}
                                            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6,
                                                padding: "7px 10px", borderRadius: 7, marginBottom: 2,
                                                backgroundColor: "transparent", border: `1px solid ${colors.card.border}`,
                                                cursor: "pointer" }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 7, flex: 1, minWidth: 0 }}>
                                                <StatusIcon status="pass" theme={props.theme} />
                                                <span style={{ fontSize: 12, fontWeight: 400, color: colors.text.secondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                    {frame.name}
                                                </span>
                                            </div>
                                            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.5px", color: colors.text.quaternary, flexShrink: 0 }}>
                                                PASS
                                            </span>
                                        </div>
                                    ))}
                                    {failMap.size === 0 && passingFrames.length === 0 && (
                                        <div style={{ padding: "7px 10px", borderRadius: 7, border: `1px solid ${colors.card.border}`, fontSize: 12, color: colors.text.tertiary }}>
                                            No frames checked
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
            <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "10px 15px", backgroundColor: colors.bg, borderTop: `1px solid ${colors.divider}`, zIndex: 20 }}>
                <button onClick={handleReset}
                    style={{ width: "100%", background: "linear-gradient(177.58deg, #008CFF 2.02%, #0671CA 97.98%)",
                        color: "#fff", border: "none", borderRadius: 8, padding: "20px 18px",
                        fontSize: 12, fontWeight: 600, cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 6, letterSpacing: "0.3px" }}>
                    RESET
                </button>
            </div>
            </>
        )
    }

    const availableBpsInConfig = currentSection.configs.map((c: PaddingBreakpointConfig) => c.breakpointId)
    const canAddBp = availableBpsInConfig.length < 3
    const activeConfig = currentConfig ?? currentSection.configs[0]
    const gapValue = Number.parseInt(activeConfig.gap.value || "0", 10) || 0
    const paddingSingleValue = Number.parseInt(activeConfig.padding.uniform || "0", 10) || 0
    const paddingValues = {
        T: Number.parseInt(activeConfig.padding.top || "0", 10) || 0,
        R: Number.parseInt(activeConfig.padding.right || "0", 10) || 0,
        B: Number.parseInt(activeConfig.padding.bottom || "0", 10) || 0,
        L: Number.parseInt(activeConfig.padding.left || "0", 10) || 0,
    } as const

    return (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
            <div style={{ flex: 1, overflowY: "auto", paddingTop: 12, paddingBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    {/* Left: back/forward buttons + label */}
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            {/* Back button */}
                            <button
                                onClick={() => setCurrentSectionIndex(i => Math.max(0, i - 1))}
                                disabled={currentSectionIndex === 0}
                                style={{
                                    width: 25, height: 25,
                                    backgroundColor: "rgba(255,255,255,0.08)",
                                    border: "none", borderRadius: 5, padding: 3,
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    cursor: currentSectionIndex === 0 ? "default" : "pointer",
                                    opacity: currentSectionIndex === 0 ? 0.5 : 1,
                                    flexShrink: 0,
                                }}
                            >
                                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                                    <path d="M11 4.5L6.5 9L11 13.5" stroke="rgba(255,255,255,0.8)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            </button>
                            {/* Forward button */}
                            <button
                                onClick={() => setCurrentSectionIndex(i => Math.min(sections.length - 1, i + 1))}
                                disabled={currentSectionIndex === sections.length - 1}
                                style={{
                                    width: 25, height: 25,
                                    backgroundColor: "rgba(255,255,255,0.08)",
                                    border: "none", borderRadius: 5, padding: 3,
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    cursor: currentSectionIndex === sections.length - 1 ? "default" : "pointer",
                                    opacity: currentSectionIndex === sections.length - 1 ? 0.5 : 1,
                                    flexShrink: 0,
                                }}
                            >
                                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                                    <path d="M7 4.5L11.5 9L7 13.5" stroke="rgba(255,255,255,0.8)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            </button>
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", whiteSpace: "nowrap" }}>
                            CHECK {currentSectionIndex + 1}
                        </span>
                    </div>

                    {/* Right: reload/reset current section */}
                    <button
                        onClick={() => {
                            setSections(prev => {
                                const next = [...prev]
                                next[currentSectionIndex] = createEmptySection(next[currentSectionIndex].id)
                                return next
                            })
                        }}
                        title="Reset this section"
                        style={{
                            width: 25, height: 25,
                            backgroundColor: "rgba(255,255,255,0.08)",
                            border: "none", borderRadius: 5, padding: 3,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            cursor: "pointer", flexShrink: 0,
                        }}
                    >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M12.5 7C12.5 10.04 10.04 12.5 7 12.5C3.96 12.5 1.5 10.04 1.5 7C1.5 3.96 3.96 1.5 7 1.5C8.82 1.5 10.44 2.37 11.5 3.72" stroke="rgba(255,255,255,0.8)" strokeWidth="1.3" strokeLinecap="round" />
                            <path d="M10 1.5H11.5V3" stroke="rgba(255,255,255,0.8)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                </div>

                {currentSection.frames.map((frame, i) => (
                    <div key={Math.random()} onMouseEnter={() => setHoveredFrameIdx(i)} onMouseLeave={() => setHoveredFrameIdx(null)}
                        style={{ position: "relative", display: "flex", alignItems: "center", padding: "7px 10px",
                            borderRadius: 7, backgroundColor: colors.card.bg, border: `1px solid ${colors.card.border}`, marginBottom: 4 }}>
                        <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: colors.text.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {frame.name}
                        </span>
                        {hoveredFrameIdx === i && (
                            <button onClick={() => {
                                setSections(prev => {
                                    const next = [...prev]
                                    const sec = { ...next[currentSectionIndex] }
                                    sec.frames = sec.frames.filter((_, j) => j !== i)
                                    next[currentSectionIndex] = sec
                                    return next
                                })
                            }}
                                style={{ flexShrink: 0, width: 16, height: 16, borderRadius: "50%",
                                    backgroundColor: colors.card.bg, border: `1px solid ${colors.card.border}`,
                                    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0, marginLeft: 6 }}>
                                <svg width="7" height="7" viewBox="0 0 7 7" fill="none">
                                    <path d="M1.5 1.5L5.5 5.5M5.5 1.5L1.5 5.5" stroke={colors.text.secondary} strokeWidth="1.2" strokeLinecap="round" />
                                </svg>
                            </button>
                        )}
                    </div>
                ))}

                <button onClick={() => { void handleAddSelected() }} 
                    disabled={addFramesState !== "idle"}
                    style={{ 
                        border: `1px ${addFramesState === 'prompt' ? 'solid' : 'dashed'} ${addFramesState === 'prompt' ? '#008CFF' : colors.card.border}`, 
                        borderRadius: 7, padding: "7px 10px",
                        backgroundColor: addFramesState === "prompt" ? "rgba(0,140,255,0.1)" : "transparent", 
                        fontSize: 12, 
                        color: addFramesState === "prompt" ? "#008CFF" : colors.text.secondary,
                        cursor: addFramesState === "active" ? "wait" : "pointer", 
                        display: "flex", alignItems: "center", justifyContent: "center",
                        width: "100%", boxSizing: "border-box" as const,
                        marginTop: 4
                    }}>
                    {addFramesState === "active" ? "Reading selection…" : addFramesState === "prompt" ? promptMsg : "+ Add selected frames"}
                </button>
            </div>

            <div style={{ flexShrink: 0, borderTop: `1px solid ${colors.divider}`, paddingTop: 16, display: "flex", flexDirection: "column", gap: 16 }}>

                                <DesignPanel
                                        colors={colors}
                                        breakpoints={availableBpsInConfig as Array<"L" | "M" | "S">}
                                        activeBreakpoint={currentBpId as "L" | "M" | "S"}
                                        isLocked={currentSection.isLocked}
                                        canAddBreakpoint={canAddBp}
                                        gap={gapValue}
                                        paddingMode={activeConfig.padding.mode}
                                        paddingValue={paddingSingleValue}
                                        paddingValues={paddingValues}
                                        onAddBreakpoint={handleAddBreakpoint}
                                        onToggleLocked={() => {
                                                setSections(prev => {
                                                        const next = [...prev]
                                                        next[currentSectionIndex] = { ...next[currentSectionIndex], isLocked: !next[currentSectionIndex].isLocked }
                                                        return next
                                                })
                                        }}
                                        onBreakpointChange={(breakpoint) => setCurrentBpId(breakpoint)}
                                        onGapChange={(value) => {
                                                updateConfig((config) => ({
                                                        ...config,
                                                        gap: {
                                                                ...config.gap,
                                                                value: value.toString(),
                                                        },
                                                }))
                                        }}
                                        onPaddingModeChange={(mode) => {
                                                updateConfig((config) => ({
                                                        ...config,
                                                        padding: {
                                                                ...config.padding,
                                                                mode,
                                                        },
                                                }))
                                        }}
                                        onPaddingValueChange={(value) => {
                                                updateConfig((config) => ({
                                                        ...config,
                                                        padding: {
                                                                ...config.padding,
                                                                uniform: value.toString(),
                                                        },
                                                }))
                                        }}
                                        onPaddingEdgeChange={(edge, value) => {
                                                updateConfig((config) => ({
                                                        ...config,
                                                        padding: {
                                                                ...config.padding,
                                                                top: edge === "T" ? value.toString() : config.padding.top,
                                                                right: edge === "R" ? value.toString() : config.padding.right,
                                                                bottom: edge === "B" ? value.toString() : config.padding.bottom,
                                                                left: edge === "L" ? value.toString() : config.padding.left,
                                                        },
                                                }))
                                        }}
                                />

                {/* Main buttons */}
                <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={handleNextSection}
                        style={{ flex: 1, backgroundColor: colors.card.bg, border: `1px solid ${colors.card.border}`,
                            borderRadius: 8, padding: "20px 18px", fontSize: 12, fontWeight: 600,
                            color: colors.text.primary, cursor: "pointer" }}>
                        New Check
                    </button>
                    <button onClick={() => { void handleFinish() }} disabled={isChecking}
                        style={{ flex: 1, background: isChecking ? colors.button.disabledBg : "linear-gradient(177.58deg, #008CFF 2.02%, #0671CA 97.98%)",
                            border: "none", borderRadius: 8, padding: "20px 18px", fontSize: 12, fontWeight: 600,
                            color: isChecking ? "rgba(255,255,255,0.4)" : "#fff",
                            cursor: isChecking ? "not-allowed" : "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                        {isChecking ? <><SpinnerIcon color="rgba(255,255,255,0.6)" /> Checking…</> : "Audit"}
                    </button>
                </div>
            </div>
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
    const [activeTab, setActiveTab] = useState<"results" | "padding">("results")
    const [dismissedItems, setDismissedItems] = useState<Map<string, Set<number>>>(new Map())
    const [scoreVersion, setScoreVersion] = useState<number>(0)
    const [hasRunPageSpeedOnce, setHasRunPageSpeedOnce] = useState<boolean>(false)
    const [recheckingCheckId, setRecheckingCheckId] = useState<string | null>(null)

    useEffect(() => {
        setTheme(detectTheme())
    }, [])

    const handleAudit = useCallback(async () => {
        const isOnPageSpeedDetail = detailCheck?.id === "google-pagespeed"
        const shouldRunPageSpeed = !hasRunPageSpeedOnce || isOnPageSpeedDetail

        setIsRunning(true)
        if (!isOnPageSpeedDetail) {
            setDetailCheck(null)
        }
        setScanProgress(0)
        setDismissedItems(new Map())
        try {
            const report = await runAudit((done, total) => {
                setScanProgress(Math.round((done / total) * 100))
            }, shouldRunPageSpeed, isOnPageSpeedDetail)

            const previousPageSpeedCheck = auditReport?.categories
                .flatMap((category) => category.checks)
                .find((check) => check.id === "google-pagespeed")

            let nextReport = report
            if (!shouldRunPageSpeed && previousPageSpeedCheck) {
                const categories = report.categories.map((category) => ({
                    ...category,
                    checks: category.checks.map((check) => (check.id === "google-pagespeed" ? previousPageSpeedCheck : check)),
                }))
                const scoreResult = calculateScore(categories)
                nextReport = {
                    ...report,
                    categories,
                    score: scoreResult.score,
                    scoreLabel: scoreResult.scoreLabel,
                    totalProgrammatic: scoreResult.totalProgrammatic,
                    passed: scoreResult.passed,
                    warned: scoreResult.warned,
                    failed: scoreResult.failed,
                }
            }

            if (shouldRunPageSpeed) {
                setHasRunPageSpeedOnce(true)
            }

            setAuditReport(nextReport)
            if (isOnPageSpeedDetail) {
                const refreshedPageSpeedCheck = nextReport.categories
                    .flatMap((category) => category.checks)
                    .find((check) => check.id === "google-pagespeed")
                if (refreshedPageSpeedCheck) {
                    setDetailCheck(refreshedPageSpeedCheck)
                }
            }
            setExpandedSections(new Set())
            setScoreVersion((v) => v + 1)
        } finally {
            setIsRunning(false)
        }
    }, [detailCheck?.id, hasRunPageSpeedOnce, auditReport])

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

    const handleRecheck = useCallback(async () => {
        if (!detailCheck) return

        const checkId = detailCheck.id
        setRecheckingCheckId(checkId)
        try {
            const updatedCheck = await runRequirementCheck(checkId, true, true)
            if (!updatedCheck) return

            setDismissedItems((prev) => {
                const next = new Map(prev)
                next.delete(checkId)
                return next
            })

            setDetailCheck(updatedCheck)
            setAuditReport((prev) => {
                if (!prev) return prev
                const categories = prev.categories.map((category) => ({
                    ...category,
                    checks: category.checks.map((check) => (check.id === updatedCheck.id ? updatedCheck : check)),
                }))
                const scoreResult = calculateScore(categories)
                return {
                    ...prev,
                    categories,
                    score: scoreResult.score,
                    scoreLabel: scoreResult.scoreLabel,
                    totalProgrammatic: scoreResult.totalProgrammatic,
                    passed: scoreResult.passed,
                    warned: scoreResult.warned,
                    failed: scoreResult.failed,
                    runAt: Date.now(),
                }
            })
            setScoreVersion((v) => v + 1)
        } finally {
            setRecheckingCheckId(null)
        }
    }, [detailCheck])

    const handleDismiss = useCallback((checkId: string, index: number) => {
        setDismissedItems((prev) => {
            const next = new Map(prev)
            const set = new Set(next.get(checkId) ?? [])
            set.add(index)
            next.set(checkId, set)
            return next
        })
        setScoreVersion((v) => v + 1)
    }, [])

    const colors = THEME_COLORS[theme]
    const effectiveReport = auditReport ? computeEffectiveReport(auditReport, dismissedItems) : null
    const scoreColor = effectiveReport ? getScoreColor(effectiveReport.score, theme) : colors.text.quaternary

    return (
        <main style={{ backgroundColor: colors.bg, color: colors.text.primary, position: "relative" }}>
            {/* Tab bar — sticky, always on top, content scrolls behind it */}
            <div style={{ borderBottom: `1px solid ${colors.divider}`, display: "flex", margin: "0 -15px",
                position: "sticky", top: 0, zIndex: 10, backgroundColor: colors.bg }}>
                <button onClick={() => setActiveTab("results")}
                    style={{ flex: 1, background: "none", border: "none", borderRadius: 0,
                        borderBottom: activeTab === "results" ? "2px solid #008CFF" : "2px solid transparent",
                        color: activeTab === "results" ? colors.text.primary : colors.text.secondary,
                        fontWeight: activeTab === "results" ? 700 : 400,
                        fontSize: 13, padding: "10px 0", cursor: "pointer", marginBottom: -1 }}>
                    Results 
                </button>
                <button onClick={() => setActiveTab("padding")}
                    style={{ flex: 1, background: "none", border: "none", borderRadius: 0,
                        borderBottom: activeTab === "padding" ? "2px solid #008CFF" : "2px solid transparent",
                        color: activeTab === "padding" ? colors.text.primary : colors.text.secondary,
                        fontWeight: activeTab === "padding" ? 700 : 400,
                        fontSize: 13, padding: "10px 0", cursor: "pointer", marginBottom: -1 }}>
                    Padding & Gap
                </button>
            </div>

            {/* Results tab — always mounted, hidden when inactive so state is preserved */}
            <div style={{ display: activeTab === "results" ? "flex" : "none", flexDirection: "column", flex: 1 }}>
                        {/* Score area — pinned, never scrolls */}
                        <div style={{ padding: "14px 0 10px", marginBottom: 12, flexShrink: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 7 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                    <span style={{ fontSize: 22, fontWeight: 700, color: scoreColor, letterSpacing: "-0.5px", lineHeight: 1 }}>
                                        {effectiveReport ? `${effectiveReport.score}%` : "—"}
                                    </span>
                                    {effectiveReport && (
                                        <span style={{ fontSize: 12, fontWeight: 500, color: scoreColor, opacity: 0.75, alignSelf: "flex-end", paddingBottom: 1 }}>
                                            {effectiveReport.scoreLabel}
                                        </span>
                                    )}
                                </div>
                            </div>
                            {effectiveReport && <StatsStrip report={effectiveReport} theme={theme} />}
                            {!effectiveReport && !isRunning && (
                                <span style={{ fontSize: 11, color: colors.text.quaternary }}>Not scanned yet</span>
                            )}
                            {isRunning && (
                                <span style={{ fontSize: 11, color: colors.text.quaternary }}>Scanning… {scanProgress}%</span>
                            )}
                            {(isRunning || effectiveReport) && (
                                <div style={{ height: 2, borderRadius: 1, backgroundColor: colors.divider, overflow: "hidden", marginTop: 4 }}>
                                    <div
                                        key={scoreVersion}
                                        style={{
                                            height: "100%",
                                            width: `${isRunning ? scanProgress : (effectiveReport?.score ?? 0)}%`,
                                            backgroundColor: isRunning ? "#008CFF" : scoreColor,
                                            borderRadius: 1,
                                            transition: "width 0.3s ease",
                                        }}
                                    />
                                </div>
                            )}
                        </div>

                    <div className="audit-scroll" style={{ paddingBottom: 60 }}>
                        {detailCheck && (
                            <DetailView
                                check={detailCheck}
                                theme={theme}
                                onBack={closeDetail}
                                dismissedIndices={dismissedItems.get(detailCheck.id) ?? new Set()}
                                onDismiss={(index) => handleDismiss(detailCheck.id, index)}
                                isRunning={isRunning}
                                onRecheck={() => { void handleRecheck() }}
                                isRechecking={recheckingCheckId === detailCheck.id}
                            />
                        )}
                        {!detailCheck && effectiveReport && (
                            <>
                                {effectiveReport.categories.map((category: CheckCategory) => (
                                    <SectionCard
                                        key={category.id}
                                        category={category}
                                        theme={theme}
                                        isExpanded={expandedSections.has(category.id)}
                                        onToggle={() => toggleSection(category.id)}
                                        onCheckClick={openDetail}
                                    />
                                ))}
                            </>
                        )}
                        {!detailCheck && !effectiveReport && (
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", paddingTop: 60, paddingBottom: 40, gap: 16 }}>
                                <ScoreRing theme={theme} />
                                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                                    <span style={{ fontSize: 13, fontWeight: 600, color: colors.text.primary }}>Audit your template</span>
                                    <span style={{ fontSize: 12, color: colors.text.tertiary, textAlign: "center", lineHeight: 1.5, maxWidth: 200 }}>
                                        Checks 28 requirements against the Framer template guidelines
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>

                    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "10px 15px", backgroundColor: colors.bg, borderTop: `1px solid ${colors.divider}`, zIndex: 20 }}>
                        <button onClick={() => { void handleAudit() }} disabled={isRunning}
                            style={{
                                width: "100%",
                                background: isRunning ? colors.button.disabledBg : "linear-gradient(177.58deg, #008CFF 2.02%, #0671CA 97.98%)",
                                color: isRunning ? "rgba(255,255,255,0.4)" : "#FFFFFF",
                                border: "none", borderRadius: 8, padding: "20px 18px",
                                fontSize: 12, fontWeight: 600,
                                cursor: isRunning ? "not-allowed" : "pointer",
                                display: "flex", alignItems: "center", justifyContent: "center", gap: 6, letterSpacing: "0.3px",
                            }}>
                            {isRunning ? <><SpinnerIcon color="rgba(255,255,255,0.6)" /> Scanning…</> : "AUDIT"}
                        </button>
                    </div>
            </div>

            {/* Padding tab — always mounted, hidden when inactive so state is preserved */}
            <div style={{ display: activeTab === "padding" ? "flex" : "none", flexDirection: "column", flex: 1, overflow: "hidden" }}>
                <PaddingPage theme={theme} colors={colors} />
            </div>
        </main>
    )
}
