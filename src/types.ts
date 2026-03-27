export type CheckStatus = "pass" | "warning" | "fail" | "skip"
export type ScoreLabel = "All Good" | "Needs Work" | "Issues Found"

export type CheckItem = {
    readonly label: string
    readonly nodeId: string | null
}

export type CheckResult = {
    readonly id: string
    readonly label: string
    readonly status: CheckStatus
    readonly detail: string
    readonly items: ReadonlyArray<CheckItem>
    readonly isProgrammatic: boolean
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
