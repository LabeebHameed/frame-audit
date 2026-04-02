export type CheckStatus = "pass" | "warning" | "fail" | "skip"
export type ScoreLabel = "All Good" | "Needs Work" | "Issues Found"

export type CheckItem = {
    readonly label: string
    readonly nodeId: string | null
    readonly previewUrl?: string | null
    readonly locked?: boolean
    readonly badge?: string | null
    readonly pageLabel?: string | null
    readonly groupLabel?: string | null
}

export type PageSpeedMetric = {
    readonly label: string
    readonly value: string
    readonly score: number | null // 0-1
}

export type PageSpeedCategoryScore = {
    readonly label: string
    readonly score: number | null // 0-1
}

export type PageSpeedStrategyData = {
    readonly performance: number | null // 0-1
    readonly accessibility: number | null
    readonly bestPractices: number | null
    readonly seo: number | null
    readonly metrics: ReadonlyArray<PageSpeedMetric>
    readonly publishedUrl: string
}

export type PageSpeedData = {
    readonly desktop: PageSpeedStrategyData | null
    readonly mobile: PageSpeedStrategyData | null
}

export type CheckResult = {
    readonly id: string
    readonly label: string
    readonly status: CheckStatus
    readonly detail: string
    readonly items: ReadonlyArray<CheckItem>
    readonly isProgrammatic: boolean
    readonly pageSpeedData?: PageSpeedData
}

export type CheckCategory = {
    readonly id: string
    readonly label: string
    readonly checks: ReadonlyArray<CheckResult>
}

export type AuditReport = {
    readonly categories: ReadonlyArray<CheckCategory>
    readonly score: number
    readonly scoreLabel: ScoreLabel
    readonly totalProgrammatic: number
    readonly passed: number
    readonly warned: number
    readonly failed: number
    readonly runAt: number
}

// ─── Padding & Gap Feature Types ────────────────────────────────────────────
//
// Component tree:
//   PaddingPage
//   ├── SectionForm (one per section, shows current section)
//   │   ├── FrameListItem (one per selected frame, hover X to dismiss)
//   │   ├── GapInput (CirclePlusToggle + number input + range slider)
//   │   └── PaddingInput (CirclePlusToggle + □/▦ toggle + uniform/individual inputs)
//   └── PaddingResults (collapsible accordion, same style as audit)
//       └── PaddingResultRow (nodeName: property: expected≠actual)

export type PaddingMode = "uniform" | "individual"

export type GapConfig = {
    readonly enabled: boolean
    readonly value: string
}

export type PaddingConfig = {
    readonly enabled: boolean
    readonly mode: PaddingMode
    readonly uniform: string
    readonly top: string
    readonly right: string
    readonly bottom: string
    readonly left: string
}

export type PaddingBreakpointConfig = {
    readonly breakpointId: string // e.g., "L", "M", "S" or full name
    readonly gap: GapConfig
    readonly padding: PaddingConfig
}

export type PaddingSection = {
    readonly id: string
    readonly frames: ReadonlyArray<{ readonly id: string; readonly name: string }>
    readonly configs: ReadonlyArray<PaddingBreakpointConfig>
    readonly isLocked: boolean
}

export type PaddingCheckItem = {
    readonly nodeId: string
    readonly nodeName: string
    readonly property: string
    readonly expected: string
    readonly actual: string
}

export type PaddingSectionResult = {
    readonly sectionIndex: number
    readonly breakpointId: string
    readonly items: ReadonlyArray<PaddingCheckItem>
}

export type PaddingReport = {
    readonly sections: ReadonlyArray<{
        readonly section: PaddingSection
        readonly results: ReadonlyArray<PaddingSectionResult>
    }>
}
