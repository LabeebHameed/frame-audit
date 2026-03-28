import { framer, isFrameNode } from "framer-plugin"
import type { CanvasNode, FrameNode } from "framer-plugin"
import type { AuditReport, CheckCategory, CheckItem, CheckResult, CheckStatus, PaddingCheckItem, PaddingReport, PaddingSection, PaddingSectionResult, ScoreLabel } from "../types"

// ---------------------------------------------------------------------------
// Internal types — Framer runtime shapes not fully typed in the package
// ---------------------------------------------------------------------------

type AnyNode = CanvasNode & Record<string, unknown>

type ImageData = {
    readonly bytes: Uint8Array
    readonly mimeType: string
}

type ImageAsset = {
    readonly url: string
    readonly thumbnailUrl: string
    readonly altText: string | undefined
    readonly getData: () => Promise<ImageData>
}

type CollectionField = {
    readonly id: string
    readonly name: string
    readonly type: string
}

type CollectionItem = {
    readonly id: string
    readonly slug: string
    readonly nodeId: string
    readonly fieldData: Record<string, unknown>
}

type Collection = {
    readonly id: string
    readonly name: string
    readonly getFields: () => Promise<ReadonlyArray<CollectionField>>
    readonly getItems: () => Promise<ReadonlyArray<CollectionItem>>
}

type CodeFile = {
    readonly id: string
    readonly name: string
}

type AllNodes = {
    readonly frameNodes: ReadonlyArray<FrameNode>
    readonly textNodes: ReadonlyArray<AnyNode>
    readonly componentNodes: ReadonlyArray<AnyNode>
    readonly pages: ReadonlyArray<AnyNode>
    readonly codeFiles: ReadonlyArray<CodeFile>
    readonly collections: ReadonlyArray<Collection>
    readonly breakpointFrameIds: ReadonlySet<string>
    readonly primaryBreakpointId: string | null
}

type ScoreResult = {
    readonly score: number
    readonly scoreLabel: ScoreLabel
    readonly totalProgrammatic: number
    readonly passed: number
    readonly warned: number
    readonly failed: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SYSTEM_FONTS = new Set([
    "inter", "arial", "helvetica", "helvetica neue", "georgia",
    "times new roman", "courier new", "verdana", "system-ui",
    "sans-serif", "serif", "monospace", "-apple-system",
    "blinkmacsystemfont", "segoe ui", "roboto", "oxygen", "ubuntu",
    "cantarell", "fira sans", "droid sans", "trebuchet ms",
    "lucida console", "monaco", "tahoma", "geneva", "impact",
    "comic sans ms", "times", "courier",
])

// ---------------------------------------------------------------------------
// WCAG color contrast helpers
// ---------------------------------------------------------------------------

function parseColor(color: string): { r: number; g: number; b: number } | null {
    const hexMatch = color.match(/^#([0-9a-f]{3,8})$/i)
    if (hexMatch) {
        const hex = hexMatch[1]
        if (hex.length === 3) {
            return {
                r: parseInt(hex[0] + hex[0], 16),
                g: parseInt(hex[1] + hex[1], 16),
                b: parseInt(hex[2] + hex[2], 16),
            }
        }
        if (hex.length >= 6) {
            return {
                r: parseInt(hex.slice(0, 2), 16),
                g: parseInt(hex.slice(2, 4), 16),
                b: parseInt(hex.slice(4, 6), 16),
            }
        }
    }
    const rgbMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
    if (rgbMatch) {
        return {
            r: parseInt(rgbMatch[1], 10),
            g: parseInt(rgbMatch[2], 10),
            b: parseInt(rgbMatch[3], 10),
        }
    }
    return null
}

function relativeLuminance(r: number, g: number, b: number): number {
    const sR = r / 255
    const sG = g / 255
    const sB = b / 255
    const rL = sR <= 0.03928 ? sR / 12.92 : Math.pow((sR + 0.055) / 1.055, 2.4)
    const gL = sG <= 0.03928 ? sG / 12.92 : Math.pow((sG + 0.055) / 1.055, 2.4)
    const bL = sB <= 0.03928 ? sB / 12.92 : Math.pow((sB + 0.055) / 1.055, 2.4)
    return 0.2126 * rL + 0.7152 * gL + 0.0722 * bL
}

function contrastRatio(l1: number, l2: number): number {
    const lighter = Math.max(l1, l2)
    const darker = Math.min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)
}

// ---------------------------------------------------------------------------
// Text extraction helpers
// ---------------------------------------------------------------------------

async function getNodeText(node: AnyNode): Promise<string> {
    if (typeof node.getText === "function") {
        try {
            return (await (node as unknown as { getText: () => Promise<string> }).getText()) || ""
        } catch {
            return ""
        }
    }
    return ""
}

async function getNodeHTML(node: AnyNode): Promise<string> {
    if (typeof node.getHTML === "function") {
        try {
            return (await (node as unknown as { getHTML: () => Promise<string> }).getHTML()) || ""
        } catch {
            return ""
        }
    }
    return ""
}

function extractFontSizeFromHTML(html: string): number | null {
    const match = html.match(/font-size:\s*([\d.]+)px/)
    if (match) {
        return parseFloat(match[1])
    }
    return null
}

function extractFontFamilyFromHTML(html: string): string | null {
    const match = html.match(/font-family:\s*([^;"]+)/)
    if (match) {
        return match[1].trim()
    }
    return null
}

function extractColorFromHTML(html: string): string | null {
    const match = html.match(/(?:^|[;"\s])color:\s*([^;"]+)/)
    if (match) {
        return match[1].trim()
    }
    return null
}

function getNodeName(node: AnyNode): string {
    return (typeof node.name === "string" ? node.name : null) || node.id
}

function getFrameBackgroundImage(frame: FrameNode): ImageAsset | null {
    return (frame.backgroundImage as ImageAsset | null) ?? null
}

// ---------------------------------------------------------------------------
// Breakpoint helpers
// ---------------------------------------------------------------------------

async function isUnderPrimaryBreakpoint(
    frame: FrameNode,
    breakpointFrameIds: ReadonlySet<string>,
    primaryBreakpointId: string | null,
    cache: Map<string, boolean>,
    allFrames: ReadonlyArray<FrameNode>,
): Promise<boolean> {
    if (primaryBreakpointId === null) return true

    const cached = cache.get(frame.id)
    if (cached !== undefined) return cached

    // If this IS a breakpoint frame, check if it's the primary one
    if (breakpointFrameIds.has(frame.id)) {
        const result = frame.id === primaryBreakpointId
        cache.set(frame.id, result)
        return result
    }

    try {
        const parent = await frame.getParent()
        if (!parent) { cache.set(frame.id, true); return true }

        // If the parent is a breakpoint, check if it's primary
        if (breakpointFrameIds.has(parent.id)) {
            const result = parent.id === primaryBreakpointId
            cache.set(frame.id, result)
            return result
        }

        const parentFrame = allFrames.find((f) => f.id === parent.id)
        if (!parentFrame) { cache.set(frame.id, true); return true }

        const result = await isUnderPrimaryBreakpoint(parentFrame, breakpointFrameIds, primaryBreakpointId, cache, allFrames)
        cache.set(frame.id, result)
        return result
    } catch {
        cache.set(frame.id, true)
        return true
    }
}

// ---------------------------------------------------------------------------
// Fetch all nodes in one batch
// ---------------------------------------------------------------------------

async function fetchAllNodes(): Promise<AllNodes> {
    const framerAny = framer as Record<string, unknown>
    const [frameNodesRaw, textNodesRaw, componentNodesRaw, pagesRaw, codeFilesRaw, collectionsRaw] = await Promise.all([
        framer.getNodesWithType("FrameNode").catch(() => []),
        framer.getNodesWithType("TextNode").catch(() => []),
        framer.getNodesWithType("ComponentInstanceNode").catch(() => []),
        framer.getNodesWithType("WebPageNode").catch(() => []),
        framer.getCodeFiles().catch(() => []),
        (typeof framerAny.getManagedCollections === "function"
            ? (framerAny.getManagedCollections as () => Promise<ReadonlyArray<Collection>>)()
            : typeof framerAny.getCollections === "function"
                ? (framerAny.getCollections as () => Promise<ReadonlyArray<Collection>>)()
                : Promise.resolve([])
        ).catch(() => []),
    ])

    // Detect breakpoint frames: frames whose direct parent is a page (WebPageNode)
    const pageIds = new Set((pagesRaw as ReadonlyArray<AnyNode>).map((p) => p.id))
    const breakpointFrameIds = new Set<string>()
    const breakpointWidths = new Map<string, number>()

    await Promise.all(
        (frameNodesRaw as FrameNode[]).map(async (frame) => {
            try {
                const parent = await frame.getParent()
                if (parent && pageIds.has(parent.id)) {
                    breakpointFrameIds.add(frame.id)
                    const widthStr = String((frame as AnyNode).width ?? "")
                    const w = parseFloat(widthStr)
                    if (!isNaN(w) && w > 0) breakpointWidths.set(frame.id, w)
                }
            } catch {
                // skip
            }
        }),
    )

    // Primary breakpoint = widest (desktop)
    let primaryBreakpointId: string | null = null
    let maxWidth = 0
    for (const [id, w] of breakpointWidths) {
        if (w > maxWidth) { maxWidth = w; primaryBreakpointId = id }
    }

    return {
        frameNodes: frameNodesRaw as ReadonlyArray<FrameNode>,
        textNodes: textNodesRaw as ReadonlyArray<AnyNode>,
        componentNodes: componentNodesRaw as ReadonlyArray<AnyNode>,
        pages: pagesRaw as ReadonlyArray<AnyNode>,
        codeFiles: codeFilesRaw as ReadonlyArray<CodeFile>,
        collections: collectionsRaw as ReadonlyArray<Collection>,
        breakpointFrameIds,
        primaryBreakpointId,
    }
}

// ---------------------------------------------------------------------------
// Helper to build a CheckResult
// ---------------------------------------------------------------------------

function makeCheck(
    id: string,
    label: string,
    status: CheckStatus,
    detail: string,
    items: ReadonlyArray<CheckItem>,
    isProgrammatic: boolean,
): CheckResult {
    return { id, label, status, detail, items, isProgrammatic }
}

function skipCheck(id: string, label: string, detail: string): CheckResult {
    return makeCheck(id, label, "skip", detail, [], false)
}

// ---------------------------------------------------------------------------
// ASSETS CHECKS (11)
// ---------------------------------------------------------------------------

async function checkImageQuality(nodes: AllNodes): Promise<CheckResult> {
    const id = "image-quality"
    const label = "Image Quality"
    const issues: Array<CheckItem> = []
    let imageCount = 0

    for (const frame of nodes.frameNodes) {
        const asset = getFrameBackgroundImage(frame)
        if (!asset) continue
        imageCount++

        try {
            const data = await asset.getData()
            const mimeType = data.mimeType || ""
            const sizeKB = Math.round(data.bytes.length / 1024)

            if ((mimeType.includes("png") || mimeType.includes("jpeg") || mimeType.includes("jpg")) && data.bytes.length > 500_000) {
                issues.push({ label: `${getNodeName(frame as AnyNode)}: ${mimeType}, ${sizeKB}KB`, nodeId: frame.id })
            }
        } catch {
            // skip unreadable
        }
    }

    if (issues.length === 0) {
        return makeCheck(id, label, "pass", `All ${imageCount} images are optimized`, [], true)
    }
    return makeCheck(id, label, "warning", `${issues.length} images over 500KB could be optimized`, issues, true)
}

async function checkAltText(nodes: AllNodes): Promise<CheckResult> {
    const id = "alt-text"
    const label = "Alt Text"
    const missing: Array<CheckItem> = []
    let imageCount = 0

    for (const frame of nodes.frameNodes) {
        const asset = getFrameBackgroundImage(frame)
        if (!asset) continue
        imageCount++

        const altText = asset.altText
        if (!altText || altText.trim().length === 0) {
            missing.push({ label: getNodeName(frame as AnyNode), nodeId: frame.id })
        }
    }

    if (imageCount === 0) {
        return makeCheck(id, label, "pass", "No images found", [], true)
    }
    if (missing.length === 0) {
        return makeCheck(id, label, "pass", `All ${imageCount} images have alt text`, [], true)
    }
    return makeCheck(id, label, "warning", `${missing.length} of ${imageCount} images missing alt text`, missing, true)
}

async function checkRepetitiveText(nodes: AllNodes): Promise<CheckResult> {
    const id = "placeholder-text"
    const label = "Repetitive Text"

    const textMap = new Map<string, Array<{ name: string; nodeId: string }>>()

    // Cache for primary-breakpoint check, shared across all text nodes
    const bpCache = new Map<string, boolean>()
    const { breakpointFrameIds, primaryBreakpointId } = nodes

    for (const node of nodes.textNodes) {
        const text = (await getNodeText(node)).trim()
        // Require at least 5 words and 30 chars to avoid flagging short titles
        const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length
        if (wordCount < 5) continue
        if (text.length < 30) continue

        // Only include text nodes under the primary (desktop) breakpoint
        const underPrimary = await isUnderPrimaryBreakpoint(
            node as unknown as FrameNode,
            breakpointFrameIds,
            primaryBreakpointId,
            bpCache,
            nodes.frameNodes,
        )
        if (!underPrimary) continue

        const normalized = text.toLowerCase()
        const existing = textMap.get(normalized)
        if (existing) {
            existing.push({ name: getNodeName(node), nodeId: node.id })
        } else {
            textMap.set(normalized, [{ name: getNodeName(node), nodeId: node.id }])
        }
    }

    const found: Array<CheckItem> = []
    for (const [text, occurrences] of textMap) {
        // On the desktop breakpoint, the same block text shouldn't appear more than once
        if (occurrences.length > 1) {
            const preview = text.length > 35 ? text.slice(0, 35) + "…" : text
            for (const occ of occurrences) {
                found.push({ label: `${occ.name}: "${preview}"`, nodeId: occ.nodeId })
            }
        }
    }

    if (found.length === 0) {
        return makeCheck(id, label, "pass", "No repetitive text found", [], true)
    }
    return makeCheck(id, label, "warning", `${found.length} layers contain repetitive text — may be placeholder content`, found, true)
}

async function checkBlurryImages(nodes: AllNodes): Promise<CheckResult> {
    const id = "blurry-images"
    const label = "Blurry Images"
    const flagged: Array<CheckItem> = []

    for (const frame of nodes.frameNodes) {
        const asset = getFrameBackgroundImage(frame)
        if (!asset) continue

        try {
            const rect = await framer.getRect(frame.id)
            if (!rect || rect.width === 0 || rect.height === 0) continue

            const data = await asset.getData()
            if (data.bytes.length < rect.width * rect.height * 0.1) {
                flagged.push({ label: `${getNodeName(frame as AnyNode)}: ${data.bytes.length}B for ${Math.round(rect.width)}x${Math.round(rect.height)}px display`, nodeId: frame.id })
            }
        } catch {
            // skip
        }
    }

    if (flagged.length === 0) {
        return makeCheck(id, label, "pass", "No blurry images detected", [], true)
    }
    return makeCheck(id, label, "warning", `${flagged.length} images may be blurry (low bytes per pixel)`, flagged, true)
}

async function checkCustomCodeFiles(nodes: AllNodes): Promise<CheckResult> {
    const id = "custom-code-files"
    const label = "Custom Code Files"

    if (nodes.codeFiles.length === 0) {
        return makeCheck(id, label, "pass", "No custom code files", [], true)
    }
    const names: Array<CheckItem> = nodes.codeFiles.map((f) => ({ label: f.name || "unnamed", nodeId: null }))
    return makeCheck(id, label, "warning", `${nodes.codeFiles.length} custom code files found`, names, true)
}

// ---------------------------------------------------------------------------
// ACCESSIBILITY CHECKS (9)
// ---------------------------------------------------------------------------

async function checkConsistentTextStyles(nodes: AllNodes): Promise<CheckResult> {
    const id = "consistent-text-styles"
    const label = "Consistent Text Styles"
    const sizes = new Set<number>()

    for (const node of nodes.textNodes) {
        const html = await getNodeHTML(node)
        const fontSize = extractFontSizeFromHTML(html)
        if (fontSize !== null) {
            sizes.add(fontSize)
        } else {
            // Try the font property as fallback
            const font = node.font as Record<string, unknown> | undefined
            if (font && typeof font.size === "number") {
                sizes.add(font.size)
            }
        }
    }

    const sizeList: Array<CheckItem> = Array.from(sizes).sort((a, b) => b - a).map((s) => ({ label: `${s}px`, nodeId: null }))

    if (sizes.size <= 5) {
        return makeCheck(id, label, "pass", `${sizes.size} unique font sizes — consistent`, sizeList, true)
    }
    if (sizes.size <= 8) {
        return makeCheck(id, label, "warning", `${sizes.size} unique font sizes — consider consolidating`, sizeList, true)
    }
    return makeCheck(id, label, "fail", `${sizes.size} unique font sizes — inconsistent text styles`, sizeList, true)
}

async function checkTextStyles(nodes: AllNodes): Promise<CheckResult> {
    const id = "text-styles"
    const label = "Text Styles"
    const missing: Array<CheckItem> = []

    for (const node of nodes.textNodes) {
        const inlineTextStyle = (node as AnyNode).inlineTextStyle
        if (inlineTextStyle === null || inlineTextStyle === undefined) {
            missing.push({ label: getNodeName(node), nodeId: node.id })
        }
    }

    if (missing.length === 0) {
        return makeCheck(id, label, "pass", "All text layers use text styles", [], true)
    }
    return makeCheck(id, label, "warning", `${missing.length} text layers not using a text style`, missing, true)
}

async function checkColorContrast(nodes: AllNodes): Promise<CheckResult> {
    const id = "color-contrast"
    const label = "Color Contrast"
    const failing: Array<CheckItem> = []

    for (const node of nodes.textNodes) {
        const html = await getNodeHTML(node)
        const textColorStr = extractColorFromHTML(html)
        if (!textColorStr) continue

        const textParsed = parseColor(textColorStr)
        if (!textParsed) continue

        try {
            const parent = await node.getParent()
            if (!parent) continue
            const parentBg = (parent as AnyNode).backgroundColor
            if (typeof parentBg !== "string") continue
            const bgParsed = parseColor(parentBg)
            if (!bgParsed) continue

            const textLum = relativeLuminance(textParsed.r, textParsed.g, textParsed.b)
            const bgLum = relativeLuminance(bgParsed.r, bgParsed.g, bgParsed.b)
            const ratio = contrastRatio(textLum, bgLum)

            // Determine required ratio: large text (>=18px bold or >=24px) needs 3:1, others 4.5:1
            const fontSize = extractFontSizeFromHTML(html)
            const requiredRatio = (fontSize !== null && fontSize >= 24) ? 3 : 4.5

            if (ratio < requiredRatio) {
                failing.push({ label: `${getNodeName(node)}: ratio ${ratio.toFixed(1)}:1 (needs ${requiredRatio}:1)`, nodeId: node.id })
            }
        } catch {
            // skip if can't determine parent
        }
    }

    if (failing.length === 0) {
        return makeCheck(id, label, "pass", "All text meets WCAG AA contrast", [], true)
    }
    return makeCheck(id, label, "warning", `${failing.length} text layers may have insufficient contrast`, failing, true)
}

async function checkTextLegibility(nodes: AllNodes): Promise<CheckResult> {
    const id = "text-legibility"
    const label = "Text Legibility"
    const tooSmall: Array<CheckItem> = []

    for (const node of nodes.textNodes) {
        const html = await getNodeHTML(node)
        let fontSize = extractFontSizeFromHTML(html)
        if (fontSize === null) {
            const font = node.font as Record<string, unknown> | undefined
            if (font && typeof font.size === "number") {
                fontSize = font.size
            }
        }
        if (fontSize !== null && fontSize < 12) {
            tooSmall.push({ label: `${getNodeName(node)}: ${fontSize}px`, nodeId: node.id })
        }
    }

    if (tooSmall.length === 0) {
        return makeCheck(id, label, "pass", "All text is legible (12px or larger)", [], true)
    }
    return makeCheck(id, label, "warning", `${tooSmall.length} text layers below 12px — may be hard to read`, tooSmall, true)
}

// ---------------------------------------------------------------------------
// CMS CHECKS (5)
// ---------------------------------------------------------------------------

async function checkCmsUsage(nodes: AllNodes): Promise<CheckResult> {
    const id = "cms-usage"
    const label = "CMS Usage"

    if (nodes.collections.length === 0) {
        return makeCheck(id, label, "skip", "No CMS collections — skipped", [], true)
    }

    let totalItems = 0
    const emptyCollections: Array<CheckItem> = []
    for (const collection of nodes.collections) {
        try {
            const items = await collection.getItems()
            totalItems += items.length
            if (items.length === 0) {
                emptyCollections.push({ label: `${collection.name}: empty`, nodeId: null })
            }
        } catch {
            emptyCollections.push({ label: `${collection.name}: unable to read items`, nodeId: null })
        }
    }

    if (emptyCollections.length === 0) {
        return makeCheck(id, label, "pass", `${nodes.collections.length} collections with ${totalItems} total items`, [], true)
    }
    return makeCheck(id, label, "warning", `${emptyCollections.length} empty collections found`, emptyCollections, true)
}

async function checkCmsFieldNamingConvention(nodes: AllNodes): Promise<CheckResult> {
    const id = "cms-field-naming"
    const label = "CMS Field Naming Convention"

    if (nodes.collections.length === 0) {
        return makeCheck(id, label, "skip", "No CMS collections", [], true)
    }

    const issues: Array<CheckItem> = []
    let totalFields = 0

    for (const collection of nodes.collections) {
        try {
            const fields = await collection.getFields()
            totalFields += fields.length
            for (const field of fields) {
                const name = field.name
                if (name !== name.trim()) {
                    issues.push({ label: `${collection.name}.'${name}' — leading/trailing spaces`, nodeId: null })
                } else if (/^\s*$/.test(name)) {
                    issues.push({ label: `${collection.name}.'${name}' — empty field name`, nodeId: null })
                }
            }
        } catch {
            // skip
        }
    }

    if (issues.length === 0) {
        return makeCheck(id, label, "pass", `All ${totalFields} field names follow conventions`, [], true)
    }
    return makeCheck(id, label, "warning", `${issues.length} field names need cleanup`, issues, true)
}

async function checkDuplicateCmsContent(nodes: AllNodes): Promise<CheckResult> {
    const id = "duplicate-cms-content"
    const label = "Duplicate CMS Content"

    if (nodes.collections.length === 0) {
        return makeCheck(id, label, "skip", "No CMS collections", [], true)
    }

    const duplicates: Array<CheckItem> = []

    for (const collection of nodes.collections) {
        try {
            const items = await collection.getItems()
            const slugCounts = new Map<string, number>()
            for (const item of items) {
                const slug = item.slug || ""
                if (slug.length > 0) {
                    slugCounts.set(slug, (slugCounts.get(slug) || 0) + 1)
                }
            }
            for (const [slug, count] of slugCounts) {
                if (count >= 2) {
                    duplicates.push({ label: `Collection '${collection.name}': slug '${slug}' appears ${count} times`, nodeId: null })
                }
            }
        } catch {
            // skip
        }
    }

    if (duplicates.length === 0) {
        return makeCheck(id, label, "pass", "No duplicate CMS content", [], true)
    }
    return makeCheck(id, label, "warning", `${duplicates.length} potential duplicates found`, duplicates, true)
}

// ---------------------------------------------------------------------------
// LINKS CHECKS (5)
// ---------------------------------------------------------------------------

function getNodeLink(node: AnyNode): string | null {
    const link = node.link
    if (typeof link === "string" && link.length > 0) return link
    return null
}

async function collectAllLinks(nodes: AllNodes): Promise<ReadonlyArray<{ name: string; link: string }>> {
    const results: Array<{ name: string; link: string }> = []
    const allNodes: ReadonlyArray<AnyNode> = [
        ...(nodes.frameNodes as ReadonlyArray<AnyNode>),
        ...nodes.textNodes,
        ...nodes.componentNodes,
    ]
    for (const node of allNodes) {
        const link = getNodeLink(node)
        if (link) {
            results.push({ name: getNodeName(node), link })
        }
    }
    return results
}

async function checkMailtoTelLinks(nodes: AllNodes): Promise<CheckResult> {
    const id = "mailto-tel-links"
    const label = "Mailto/Tel Links"
    const allLinks = await collectAllLinks(nodes)
    const mailtoTelLinks = allLinks.filter((l) => l.link.startsWith("mailto:") || l.link.startsWith("tel:"))

    if (mailtoTelLinks.length === 0) {
        return makeCheck(id, label, "skip", "No mailto/tel links found — skipped", [], true)
    }

    const issues: Array<CheckItem> = []
    for (const entry of mailtoTelLinks) {
        if (entry.link.startsWith("mailto:")) {
            if (!/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+/.test(entry.link)) {
                issues.push({ label: `${entry.name}: '${entry.link}' — invalid email format`, nodeId: null })
            }
        }
        if (entry.link.startsWith("tel:")) {
            if (!/^tel:\+?[\d\s()-]+$/.test(entry.link)) {
                issues.push({ label: `${entry.name}: '${entry.link}' — invalid phone format`, nodeId: null })
            }
        }
    }

    if (issues.length === 0) {
        return makeCheck(id, label, "pass", `All ${mailtoTelLinks.length} mailto/tel links are valid`, [], true)
    }
    return makeCheck(id, label, "warning", `${issues.length} mailto/tel links have invalid format`, issues, true)
}

async function checkCustom404Page(nodes: AllNodes): Promise<CheckResult> {
    const id = "custom-404-page"
    const label = "Custom 404 Page"

    const has404 = nodes.pages.some((page) => {
        const path = (typeof page.path === "string" ? page.path : "") as string
        return /404/i.test(path)
    })

    if (has404) {
        return makeCheck(id, label, "pass", "Custom 404 page found", [], true)
    }
    return makeCheck(id, label, "fail", "No custom 404 page — visitors will see default error page", [], true)
}

async function checkBrokenInternalLinks(nodes: AllNodes): Promise<CheckResult> {
    const id = "broken-internal-links"
    const label = "Broken Internal Links"

    const pagePaths = new Set(
        nodes.pages.map((p) => (typeof p.path === "string" ? p.path : "")).filter((p) => p.length > 0),
    )

    const allLinks = await collectAllLinks(nodes)
    const internalLinks = allLinks.filter((l) => l.link.startsWith("/") && !l.link.startsWith("//"))

    if (internalLinks.length === 0) {
        return makeCheck(id, label, "pass", "No internal links to check", [], true)
    }

    const broken: Array<CheckItem> = []
    for (const entry of internalLinks) {
        if (entry.link === "/") continue // home page always valid
        if (!pagePaths.has(entry.link)) {
            broken.push({ label: `${entry.name}: links to '${entry.link}' — page not found`, nodeId: null })
        }
    }

    if (broken.length === 0) {
        return makeCheck(id, label, "pass", `All ${internalLinks.length} internal links are valid`, [], true)
    }
    return makeCheck(id, label, "fail", `${broken.length} internal links point to non-existent pages`, broken, true)
}

// ---------------------------------------------------------------------------
// LAYOUT CHECKS (2)
// ---------------------------------------------------------------------------

async function checkResponsiveLayout(nodes: AllNodes): Promise<CheckResult> {
    const id = "responsive-layout"
    const label = "Responsive Layout"
    const fixed: Array<CheckItem> = []
    const cache = new Map<string, boolean>()
    const { breakpointFrameIds, primaryBreakpointId } = nodes

    for (const frame of nodes.frameNodes) {
        const frameAny = frame as AnyNode
        // Skip breakpoint frames themselves (desktop/tablet/mobile containers)
        if (breakpointFrameIds.has(frame.id)) continue

        const width = frameAny.width
        if (typeof width !== "string") continue
        const pxMatch = width.match(/^(\d+(?:\.\d+)?)px$/)
        if (!pxMatch) continue
        const pxValue = parseFloat(pxMatch[1])
        if (pxValue <= 100) continue

        // Only show elements under the primary (desktop) breakpoint — deduplicates 3× repetition
        const underPrimary = await isUnderPrimaryBreakpoint(frame, breakpointFrameIds, primaryBreakpointId, cache, nodes.frameNodes)
        if (!underPrimary) continue

        fixed.push({ label: `${getNodeName(frameAny)}: width=${width}`, nodeId: frame.id })
    }

    if (fixed.length === 0) {
        return makeCheck(id, label, "pass", "All elements use responsive layout", [], true)
    }
    return makeCheck(id, label, "warning", `${fixed.length} elements have fixed pixel widths`, fixed, true)
}

async function checkAutoHeight(nodes: AllNodes): Promise<CheckResult> {
    const id = "auto-height"
    const label = "Auto Height"
    const fixed: Array<CheckItem> = []
    const cache = new Map<string, boolean>()
    const { breakpointFrameIds, primaryBreakpointId } = nodes

    for (const frame of nodes.frameNodes) {
        const frameAny = frame as AnyNode
        // Skip breakpoint frames themselves
        if (breakpointFrameIds.has(frame.id)) continue

        const height = frameAny.height
        if (typeof height !== "string") continue
        // "fit-content" = auto/hug; pixel strings = fixed
        if (height === "fit-content") continue
        if (!/^\d+(?:\.\d+)?px$/.test(height)) continue

        // Only show elements under the primary (desktop) breakpoint
        const underPrimary = await isUnderPrimaryBreakpoint(frame, breakpointFrameIds, primaryBreakpointId, cache, nodes.frameNodes)
        if (!underPrimary) continue

        fixed.push({ label: `${getNodeName(frameAny)}: height=${height}`, nodeId: frame.id })
    }

    if (fixed.length === 0) {
        return makeCheck(id, label, "pass", "All elements use auto height", [], true)
    }
    return makeCheck(id, label, "warning", `${fixed.length} elements have fixed heights — set to auto/fit-content`, fixed, true)
}

// ---------------------------------------------------------------------------
// CUSTOM FONT (1)
// ---------------------------------------------------------------------------

async function checkDefaultFonts(nodes: AllNodes): Promise<CheckResult> {
    const id = "default-fonts"
    const label = "Default Framer Fonts"
    const items: Array<CheckItem> = []
    const detectedFontNames = new Set<string>()

    for (const node of nodes.textNodes) {
        const html = await getNodeHTML(node)
        const family = extractFontFamilyFromHTML(html)
        let externalFamily: string | null = null

        if (family) {
            const families = family.split(",").map((f) => f.trim().replace(/['"]/g, ""))
            for (const f of families) {
                if (f.length > 0 && !SYSTEM_FONTS.has(f.toLowerCase())) {
                    externalFamily = f
                    break
                }
            }
        } else {
            const font = node.font as Record<string, unknown> | undefined
            if (font && typeof font.family === "string") {
                const f = font.family.trim()
                if (f.length > 0 && !SYSTEM_FONTS.has(f.toLowerCase())) {
                    externalFamily = f
                }
            }
        }

        if (externalFamily !== null) {
            detectedFontNames.add(externalFamily)
            items.push({ label: `${getNodeName(node)} — ${externalFamily}`, nodeId: node.id })
        }
    }

    if (items.length === 0) {
        return makeCheck(id, label, "pass", "Only default Framer fonts used", [], true)
    }
    return makeCheck(id, label, "warning", `${detectedFontNames.size} custom font(s) in ${items.length} layers — use default Framer fonts instead: ${Array.from(detectedFontNames).join(", ")}`, items, true)
}

// ---------------------------------------------------------------------------
// PERFORMANCE (2)
// ---------------------------------------------------------------------------

async function checkSiteOptimization(nodes: AllNodes): Promise<CheckResult> {
    const id = "site-optimization"
    const label = "Site Optimization"
    const issues: Array<CheckItem> = []

    // Check for very large images
    for (const frame of nodes.frameNodes) {
        const asset = getFrameBackgroundImage(frame)
        if (!asset) continue
        try {
            const data = await asset.getData()
            if (data.bytes.length > 1_000_000) {
                const sizeMB = (data.bytes.length / 1_000_000).toFixed(1)
                issues.push({ label: `Image '${getNodeName(frame as AnyNode)}': ${sizeMB}MB`, nodeId: frame.id })
            }
        } catch {
            // skip
        }
    }

    // Check nesting depth heuristic (sample up to 200 frames to avoid timeout)
    let maxDepth = 0
    const frameSample = nodes.frameNodes.slice(0, 200)
    for (const frame of frameSample) {
        let depth = 0
        let current: CanvasNode | null = frame
        try {
            while (current && depth < 12) {
                current = await current.getParent()
                if (current) depth++
            }
            if (depth > maxDepth) maxDepth = depth
            if (depth > 8) {
                issues.push({ label: `Nesting depth ${depth} at '${getNodeName(frame as AnyNode)}'`, nodeId: frame.id })
            }
        } catch {
            break
        }
    }

    if (issues.length === 0) {
        return makeCheck(id, label, "pass", "Site is well optimized", [], true)
    }
    const imgIssueCount = issues.filter((i) => i.label.startsWith("Image")).length
    return makeCheck(id, label, "warning", `${imgIssueCount} images over 1MB, max nesting depth: ${maxDepth}`, issues, true)
}

async function checkPageSettings(_nodes: AllNodes): Promise<CheckResult> {
    return skipCheck("page-settings", "Page Title & Description", "Cannot verify — site title and description are not accessible via the plugin API. Check Site Settings → SEO manually.")
}

async function checkGooglePageSpeed(_nodes: AllNodes): Promise<CheckResult> {
    return skipCheck("google-pagespeed", "Google PageSpeed", "Run PageSpeed manually at pagespeed.web.dev")
}

// ---------------------------------------------------------------------------
// Score calculation
// ---------------------------------------------------------------------------

function calculateScore(categories: ReadonlyArray<CheckCategory>): ScoreResult {
    let totalProgrammatic = 0
    let passed = 0
    let warned = 0
    let failed = 0
    let sum = 0

    for (const category of categories) {
        for (const check of category.checks) {
            if (!check.isProgrammatic) continue
            if (check.status === "skip") continue
            totalProgrammatic++
            if (check.status === "pass") {
                passed++
                sum += 1.0
            } else if (check.status === "warning") {
                warned++
                sum += 0.5
            } else {
                failed++
            }
        }
    }

    const score = totalProgrammatic > 0 ? Math.round((sum / totalProgrammatic) * 100) : 100
    let scoreLabel: ScoreLabel
    if (score >= 90) {
        scoreLabel = "All Good"
    } else if (score >= 70) {
        scoreLabel = "Needs Work"
    } else {
        scoreLabel = "Issues Found"
    }

    return { score, scoreLabel, totalProgrammatic, passed, warned, failed }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function runAudit(onProgress?: (done: number, total: number) => void): Promise<AuditReport> {
    const nodes = await fetchAllNodes()

    const TOTAL = 21
    let completed = 0

    function track<T>(p: Promise<T>): Promise<T> {
        return p.then((result) => {
            completed++
            onProgress?.(completed, TOTAL)
            return result
        })
    }

    const [
        // Assets
        imageQuality,
        blurryImages,
        altText,
        // Text
        repetitiveText,
        defaultFonts,
        textLegibility,
        // Design
        custom404,
        consistentTextStyles,
        textStyles,
        // Accessibility
        colorContrast,
        pageSettings,
        // Responsive
        responsiveLayout,
        autoHeight,
        // Links
        mailtoTel,
        brokenInternal,
        // CMS
        cmsUsage,
        cmsFieldNaming,
        duplicateCms,
        // Code
        customCodeFiles,
        // Performance
        siteOptimization,
        pageSpeed,
    ] = await Promise.all([
        track(checkImageQuality(nodes)),
        track(checkBlurryImages(nodes)),
        track(checkAltText(nodes)),
        track(checkRepetitiveText(nodes)),
        track(checkDefaultFonts(nodes)),
        track(checkTextLegibility(nodes)),
        track(checkCustom404Page(nodes)),
        track(checkConsistentTextStyles(nodes)),
        track(checkTextStyles(nodes)),
        track(checkColorContrast(nodes)),
        track(checkPageSettings(nodes)),
        track(checkResponsiveLayout(nodes)),
        track(checkAutoHeight(nodes)),
        track(checkMailtoTelLinks(nodes)),
        track(checkBrokenInternalLinks(nodes)),
        track(checkCmsUsage(nodes)),
        track(checkCmsFieldNamingConvention(nodes)),
        track(checkDuplicateCmsContent(nodes)),
        track(checkCustomCodeFiles(nodes)),
        track(checkSiteOptimization(nodes)),
        track(checkGooglePageSpeed(nodes)),
    ])

    const categories: ReadonlyArray<CheckCategory> = [
        {
            id: "assets",
            label: "Assets",
            checks: [imageQuality, blurryImages, altText],
        },
        {
            id: "text",
            label: "Text",
            checks: [repetitiveText, defaultFonts, textLegibility],
        },
        {
            id: "design",
            label: "Design",
            checks: [custom404, consistentTextStyles, textStyles],
        },
        {
            id: "accessibility",
            label: "Accessibility",
            checks: [colorContrast, pageSettings],
        },
        {
            id: "responsive",
            label: "Responsive",
            checks: [responsiveLayout, autoHeight],
        },
        {
            id: "links",
            label: "Links",
            checks: [mailtoTel, brokenInternal],
        },
        {
            id: "cms",
            label: "CMS",
            checks: [cmsUsage, cmsFieldNaming, duplicateCms],
        },
        {
            id: "code",
            label: "Code",
            checks: [customCodeFiles],
        },
        {
            id: "performance",
            label: "Performance",
            checks: [siteOptimization, pageSpeed],
        },
    ]

    const scoreResult = calculateScore(categories)

    return {
        categories,
        score: scoreResult.score,
        scoreLabel: scoreResult.scoreLabel,
        totalProgrammatic: scoreResult.totalProgrammatic,
        passed: scoreResult.passed,
        warned: scoreResult.warned,
        failed: scoreResult.failed,
        runAt: Date.now(),
    }
}

// ---------------------------------------------------------------------------
// Padding & Gap checker
// ---------------------------------------------------------------------------

function parsePx(value: string | null | undefined): number {
    if (!value) return 0
    const n = parseFloat(value)
    return isNaN(n) ? 0 : n
}

function parsePaddingSides(padding: string | null | undefined): { top: number; right: number; bottom: number; left: number } {
    if (!padding) return { top: 0, right: 0, bottom: 0, left: 0 }
    const parts = padding.trim().split(/\s+/).map(parsePx)
    if (parts.length === 1) return { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] }
    if (parts.length === 2) return { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] }
    if (parts.length === 4) return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] }
    return { top: 0, right: 0, bottom: 0, left: 0 }
}

export async function checkPaddingAndGap(sections: ReadonlyArray<PaddingSection>): Promise<PaddingReport> {
    const allFrames = await framer.getNodesWithType("FrameNode")

    const sectionOutputs = await Promise.all(
        sections.map(async (section, sectionIndex) => {
            const items: PaddingCheckItem[] = []

            for (const frameRef of section.frames) {
                const node = allFrames.find(n => n.id === frameRef.id)
                if (!node) continue

                if (section.gap.enabled && section.gap.value !== "") {
                    // node.gap is a CSS string like "80px" or "80px 40px"
                    const gapStr = node.gap ?? null
                    const actualNum = parsePx(typeof gapStr === "string" ? gapStr.split(" ")[0] : null)
                    if (Number(section.gap.value) !== actualNum) {
                        items.push({
                            nodeId: node.id,
                            nodeName: node.name ?? frameRef.name,
                            property: "gap",
                            expected: section.gap.value,
                            actual: String(actualNum),
                        })
                    }
                }

                if (section.padding.enabled) {
                    // node.padding is a CSS shorthand string like "200px 50px 500px 50px"
                    const sides = parsePaddingSides(node.padding ?? null)
                    const expected =
                        section.padding.mode === "uniform"
                            ? { top: section.padding.uniform, right: section.padding.uniform, bottom: section.padding.uniform, left: section.padding.uniform }
                            : { top: section.padding.top, right: section.padding.right, bottom: section.padding.bottom, left: section.padding.left }

                    const sideEntries: Array<{ prop: string; expected: string; actual: number }> = [
                        { prop: "paddingTop", expected: expected.top, actual: sides.top },
                        { prop: "paddingRight", expected: expected.right, actual: sides.right },
                        { prop: "paddingBottom", expected: expected.bottom, actual: sides.bottom },
                        { prop: "paddingLeft", expected: expected.left, actual: sides.left },
                    ]

                    for (const side of sideEntries) {
                        if (side.expected === "") continue
                        if (Number(side.expected) !== side.actual) {
                            items.push({
                                nodeId: node.id,
                                nodeName: node.name ?? frameRef.name,
                                property: side.prop,
                                expected: side.expected,
                                actual: String(side.actual),
                            })
                        }
                    }
                }
            }

            const result: PaddingSectionResult = { sectionIndex, items }
            return { section, results: [result] }
        })
    )

    return { sections: sectionOutputs }
}

export { runAudit }
