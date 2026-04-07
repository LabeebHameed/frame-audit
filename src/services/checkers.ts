import { framer, $framerInternal, isComponentGestureVariant } from "framer-plugin"
import type { CanvasNode, ComponentNode, FrameNode, PublishInfo } from "framer-plugin"
import * as ts from "typescript"
import type { AuditReport, CheckCategory, CheckItem, CheckResult, CheckStatus, PageSpeedData, PageSpeedMetric, PageSpeedStrategyData, PaddingCheckItem, PaddingReport, PaddingSection, PaddingSectionResult, ScoreLabel } from "../types"

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
    readonly slugFieldName?: string | null
    readonly getFields: () => Promise<ReadonlyArray<CollectionField>>
    readonly getItems: () => Promise<ReadonlyArray<CollectionItem>>
}

type CodeFileExportItem = {
    readonly type: "component" | "override"
    readonly insertURL?: string
}

type CodeFile = {
    readonly id: string
    readonly name: string
    readonly exports: ReadonlyArray<CodeFileExportItem>
}

type AllNodes = {
    readonly frameNodes: ReadonlyArray<FrameNode>           // all frames — for asset checks (alt text)
    readonly assetFrameIds: ReadonlySet<string>             // frames that carry a backgroundImage
    readonly contentFrameNodes: ReadonlyArray<FrameNode>    // non-asset frames not directly inside an asset frame — for layout/nesting checks
    readonly reachableAssetFrames: ReadonlyArray<FrameNode> // asset frames whose parent is not another asset frame — for performance image checks
    readonly textNodes: ReadonlyArray<AnyNode>              // all text — for text styles, fonts, accessibility
    readonly contentTextNodes: ReadonlyArray<AnyNode>       // text not directly inside an asset frame — for repetitive text, legibility
    readonly textNodeSourceKeyMap: ReadonlyMap<string, string> // textNodeId → "free:{id}" | "component:{name}" — for component-aware dedup
    readonly svgNodeIds: ReadonlySet<string>                // SVGNode IDs — excluded from text checks to skip icon labels
    readonly svgNodes: ReadonlyArray<AnyNode>               // SVG nodes — for style usage scanning in unused assets
    readonly textNodesInSvg: ReadonlySet<string>            // text node IDs whose direct parent is an SVG — excluded from contrast/text checks
    readonly componentNodes: ReadonlyArray<AnyNode>
    readonly pages: ReadonlyArray<AnyNode>
    readonly designFilePageIds: ReadonlySet<string>
    readonly codeFiles: ReadonlyArray<CodeFile>
    readonly collections: ReadonlyArray<Collection>
    readonly breakpointFrameIds: ReadonlySet<string>
    readonly firstBreakpointFrameId: string | null          // first breakpoint frame to analyze; exclude other breakpoint frames
    readonly nodesInNonFirstBreakpoints: ReadonlySet<string> // node IDs inside non-first breakpoint frames (to exclude)
    readonly breakpointFramesByPageId: ReadonlyMap<string, ReadonlyArray<string>> // pageId → breakpoint frame IDs in order
    readonly componentDefinitionNodes: ReadonlyArray<AnyNode> // component definitions (not instances)
    readonly frameParentIdMap: ReadonlyMap<string, string>
    readonly variantFrameComponentIdMap: ReadonlyMap<string, string>
    readonly nodesInNonPrimaryVariants: ReadonlySet<string>  // node IDs inside non-primary variant frames (to exclude)
    readonly nodesInAnyVariant: ReadonlySet<string>          // node IDs inside any variant frame — primary or not (component definitions)
}

type ScoreResult = {
    readonly score: number
    readonly scoreLabel: ScoreLabel
    readonly totalProgrammatic: number
    readonly passed: number
    readonly warned: number
    readonly failed: number
}

type PublishedFormTarget = {
    readonly selector: string
    readonly action: string
    readonly method: string
    readonly fieldTokens: ReadonlySet<string>
    readonly submitTokens: ReadonlySet<string>
    readonly framerName: string // data-framer-name of the nearest ancestor (or the form itself)
    readonly hasConfiguredDestination: boolean // true if the published HTML signals a send-to is set
}

type FramerFormCandidate = {
    readonly node: AnyNode
    readonly metadataTokens: ReadonlySet<string>
    readonly fieldTokens: ReadonlySet<string>
    readonly submitTokens: ReadonlySet<string>
}

type PublishedToFramerMatch = {
    readonly target: PublishedFormTarget
    readonly node: AnyNode | null
    readonly score: number
}

type PublishedEnvironmentName = "production" | "staging"

type PublishedEnvironmentUrl = {
    readonly environment: PublishedEnvironmentName
    readonly url: string
}

type PublishedMetadataInfo = {
    readonly hasFavicon: boolean
    readonly hasSocialPreview: boolean
    readonly hasTitle: boolean
    readonly hasDescription: boolean
    readonly hasDefaultTitle: boolean
}

type SemanticMetadataApiResponse = {
    readonly ok?: boolean
    readonly error?: string
    readonly extraction?: {
        readonly hasFavicon?: boolean
        readonly hasSocialPreview?: boolean
        readonly hasTitle?: boolean
        readonly hasDescription?: boolean
        readonly title?: string
        readonly description?: string
    }
}

function isDefaultFramerMetadataTitle(value: string): boolean {
    return value.trim().toLowerCase() === "home"
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Framer's native / bundled fonts — system fonts + Framer's curated Google Fonts library
const FRAMER_NATIVE_FONTS = new Set([
    // System fonts
    "inter", "arial", "helvetica", "helvetica neue", "georgia",
    "times new roman", "courier new", "verdana", "system-ui",
    "sans-serif", "serif", "monospace", "-apple-system",
    "blinkmacsystemfont", "segoe ui", "roboto", "oxygen", "ubuntu",
    "cantarell", "fira sans", "droid sans", "trebuchet ms",
    "lucida console", "monaco", "tahoma", "geneva", "impact",
    "comic sans ms", "times", "courier",
    // Framer-bundled Google Fonts
    "plus jakarta sans", "dm sans", "space grotesk", "urbanist",
    "nunito", "poppins", "source sans 3", "source sans pro", "outfit",
    "raleway", "lato", "open sans", "montserrat", "work sans",
    "manrope", "sora", "be vietnam pro", "bricolage grotesque",
    "cabinet grotesk", "geist", "geist mono", "clash display",
    "general sans", "satoshi", "switzer", "synonym", "supreme",
    "neulis", "neue haas grotesk", "neue montreal",
    // Additional common Framer template fonts
    "archivo", "archivo black", "assistant", "barlow", "baskervville",
    "bitter", "cabin", "cormorant", "cormorant garamond", "crimson text",
    "dosis", "epilogue", "fira sans condensed", "fraunces", "gabarito",
    "gloock", "hanken grotesk", "ibm plex sans", "ibm plex serif", "inconsolata",
    "instrument sans", "instrument serif", "jost", "kanit", "karla",
    "libre baskerville", "libre franklin", "lora", "merriweather", "mulish",
    "newsreader", "noto sans", "noto serif", "onest", "overpass",
    "playfair display", "pt sans", "pt serif", "public sans", "quicksand",
    "red hat display", "rubik", "schibsted grotesk", "space mono", "spectral",
    "syne", "teko", "titillium web", "unbounded",
    // Google Fonts from Framer's fonts list
    "arbutus-slab", "arcane", "architects-daughter", "archivo-narrow",
    "are-you-serious", "aref-ruqaa", "aref-ruqaa-ink", "arima", "arimo",
    "arizonia", "ark-es", "armata", "array", "arsenal", "arsenal-sc", "artifika",
    "arvo", "arapey", "arbutus", "anuphan", "anybody", "aoboshi-one",
    "apfel-grotezk", "ar-one-sans", "anonymous-pro", "anta", "antic",
    "antic-didone", "antic-slab", "anton", "anton-sc", "antonio", "anek-latin",
    "anek-malayalam", "anek-odia", "anek-tamil", "anek-telugu", "amiko",
    "amiri", "amiri-quran", "amita", "amulya", "anaheim", "ancizar-sans",
    "amarante", "amaranth", "amarna", "amatic-sc", "americaine", "amethysta",
    "amiamie", "alpino", "alumni-sans", "alumni-sans-collegiate-one",
    "alumni-sans-inline-one", "alumni-sans-pinstripe", "alumni-sans-sc",
    "alyamama", "allura", "almarai", "almendra", "almendra-display",
    "almendra-sc", "alpha-lyrae", "allan", "allerta", "allerta-stencil",
    "allison", "allkin", "alfa-slab-one", "alice", "alike", "alike-angular",
    "alkalami", "alkatra", "alegreya-sans-sc", "alegreya-sc", "aleo",
    "alex-brush", "alexandria", "albert-sans", "aldrich", "alef", "alegreya",
    "alegreya-sans", "aktura", "aladin", "alan-sans", "alata", "alatsi",
    "akaya-kanadaka", "akaya-telivigala", "akronim", "akshar", "agdasima",
    "agu-display", "aguafina-script", "aileron", "akatab", "agbalumo", "arya",
    "asap", "asap-condensed", "asar", "asimovian", "aspekta-variable", "asset",
    "asta-sans", "astloch", "asul", "athiti", "atkinson-hyperlegible",
    "atkinson-hyperlegible-mono", "atkinson-hyperlegible-next", "atma",
    "atomic-age", "aubrey", "audio-junglism", "audiowide", "aujournuit",
    "author", "autour-one", "average", "average-sans", "averia-gruesa-libre",
    "averia-libre", "averia-sans-libre", "averia-serif-libre", "azeret-mono",
    "b612", "b612-mono", "babylonica", "bacasime-antique", "bad-script",
    "badeen-display", "bagel-fat-one", "bagnard", "bahiana", "bahianita",
    "bai-jamjuree", "bakbak-one", "ballet", "baloo-2", "baloo-bhai-2",
    "baloo-bhaijaan-2", "baloo-bhaina-2", "baloo-chettan-2", "baloo-da-2",
    "baloo-paaji-2", "baloo-tamma-2", "baloo-tammudu-2", "baloo-thambi-2",
    "balsamiq-sans", "balthazar", "bangers", "bankara-grotesk",
    "barlow-condensed", "barlow-semi-condensed", "barlowfold", "barriecito",
    "barrio", "basement-grotesque", "basic", "baskervville-sc", "battambang",
    "baumans", "bayon", "bbb-karrik", "bbh-bartle", "bbh-bogle", "bbh-hegarty",
    "bdo-grotesk", "be-vietnam-pro", "beast", "beau-rivage", "bebas-neue",
    "beiruti", "belanosima", "belgrano", "bellefair", "belleza", "bellota",
    "bellota-text", "benchnine", "benne", "bentham", "berkshire-swash",
    "berzulis-pizius", "besley", "bespoke-sans", "bespoke-serif", "bespoke-slab",
    "bespoke-stencil", "betania-patmos", "betania-patmos-gdl", "betania-patmos-in",
    "betania-patmos-in-gdl", "beth-ellen", "bevan", "bevellier",
    "bhutuka-expanded-one", "big-shoulders", "big-shoulders-inline",
    "big-shoulders-stencil", "bigelow-rules", "bigshot-one", "bilbo",
    "bilbo-swash-caps", "biorhyme", "biorhyme-expanded", "birthstone",
    "birthstone-bounce", "biryani", "bitcount", "bitcount-grid-double",
    "bitcount-grid-double-ink", "bitcount-grid-single", "bitcount-grid-single-ink",
    "bitcount-ink", "bitcount-prop-double", "bitcount-prop-double-ink",
    "bitcount-prop-single", "bitcount-prop-single-ink", "bitcount-single",
    "bitcount-single-ink", "biz-udgothic", "biz-udmincho", "biz-udpgothic",
    "biz-udpmincho", "black-and-white-picture", "black-han-sans", "black-ops-one",
    "blaka", "blaka-hollow", "blaka-ink", "blinker", "bodoni-moda",
    "bodoni-moda-sc", "bokor", "boldonse", "bona-nova", "bona-nova-sc",
    "bonbance", "bonbon", "bonheur-royale", "bonny", "boogaloo", "borel",
    "boris", "boska", "boucles", "bowlby-one", "bowlby-one-sc", "boxing",
    "bpmf-huninn", "bpmf-iansui", "bpmf-zihi-kai-std", "braah-one", "brawler",
    "bree-serif", "britney", "bruno-ace", "bruno-ace-sc", "brygada-1918",
    "bubblegum-sans", "bubbler-one", "buda", "buenard", "bungee",
    "bungee-hairline", "bungee-inline", "bungee-outline", "bungee-shade",
    "bungee-spice", "bungee-tint", "butcherman", "butterfly-kids", "bvllet",
    "bytesized", "cabin-condensed", "cabin-sketch", "cactus-classical-serif",
    "caesar-dressing", "cagliostro", "cairo", "cairo-play", "cal-sans",
    "caladea", "calistoga", "calligraffitti", "cambay", "cambo", "candal",
    "cantata-one", "cantora-one", "caprasimo", "capriola", "caramel",
    "carattere", "cardo", "carlito", "carme", "carrois-gothic",
    "carrois-gothic-sc", "carter-one", "cascadia-code", "cascadia-mono",
    "castoro", "castoro-titling", "catamaran", "caudex", "cause", "caveat",
    "caveat-brush", "cedarville-cursive", "cesare", "ceviche-one", "chakra-petch",
    "changa", "changa-one", "chango", "chaos16", "charis-sil", "charm",
    "charmonman", "chathura", "chau-philomene-one", "chaumont-script", "chela-one",
    "chelsea-market", "cherish", "cherry-bomb-one", "cherry-cream-soda", "cherry-swash",
    "chewy", "chicle", "chilanka", "chillax", "chiron-goround-tc", "chiron-hei-hk",
    "chiron-sung-hk", "chivo", "chivo-mono", "chocolate-classical-sans",
    "chokokutai", "chonburi", "choso", "chubbo", "cinzel", "cinzel-decorative",
    "clash-display", "clash-grotesk", "clicker-script", "climate-crisis", "coaster-sans",
    "coconat", "coda", "codystar", "coiny", "combo", "comfortaa", "comforter",
    "comforter-brush", "comic-neue", "comic-relief", "comico", "coming-soon", "comme",
    "commissioner", "concert-one", "condenbitmap", "condiment", "contrail-one",
    "convergence", "cookie", "cooper-hewitt", "copse", "coral-pixels", "corben",
    "corinthia", "cormorant", "cormorant-garamond", "cormorant-infant", "cormorant-sc",
    "cormorant-unicase", "cormorant-upright", "cossette-texte", "cossette-titre",
    "courgette", "courier-prime", "cousine", "coustard", "covered-by-your-grace",
    "creepster", "crete-round", "crimson-pro", "crimson-text", "croissant-one",
    "crushed", "cuprum", "cute-font", "cutive", "cutive-mono", "dai-banna-sil",
    "damion", "dancing-script", "danfo", "dangrek", "darker-grotesque", "darumadrop-one",
    "datatype", "david-libre", "dawning-of-a-new-day", "days-one", "defekt", "dekko",
    "dela-gothic-one", "delicious-handrawn", "delius", "delius-swash-caps",
    "delius-unicase", "della-respira", "dem-mo-mono", "denk-one", "destra",
    "devonshire", "dhurjati", "didact-gothic", "diphylleia", "diplomata",
    "diplomata-sc", "dm-mono", "dm-retrograde", "dm-sans", "dm-serif-display",
    "dm-serif-text", "do-hyeon", "dokdo", "domine", "donegal-one", "dongle",
    "doppio-one", "dorsa", "dosis", "dotgothic16", "doto", "dr-sugiyama",
    "drabina", "droide-anthro-light", "dt-getai-grotesk-display", "dt-nightingale",
    "duru-sans", "dynalight", "dynapuff", "eagle-lake", "east-sea-dokdo", "eater",
    "eb-garamond", "economica", "eczar", "edu-au-vic-wa-nt-arrows",
    "edu-au-vic-wa-nt-dots", "edu-au-vic-wa-nt-guides", "edu-au-vic-wa-nt-hand",
    "edu-au-vic-wa-nt-pre", "edu-nsw-act-cursive", "edu-nsw-act-foundation",
    "edu-nsw-act-hand-pre", "edu-qld-beginner", "edu-qld-hand", "edu-sa-beginner",
    "edu-sa-hand", "edu-tas-beginner", "edu-vic-wa-nt-beginner", "edu-vic-wa-nt-hand",
    "edu-vic-wa-nt-hand-pre", "el-messiri", "elastic", "electrolize", "elms-sans",
    "elsie", "elsie-swash-caps", "elstob", "emblema-one", "emilys-candy",
    "encode-sans", "encode-sans-condensed", "encode-sans-expanded", "encode-sans-sc",
    "encode-sans-semi-condensed", "encode-sans-semi-expanded", "engagement",
    "englebert", "enriqueta", "ephesis", "epilogue", "epunda-sans", "epunda-slab",
    "erbarre", "erica-one", "erode", "esteban", "estonia", "euphoria-script",
    "ewert", "excon", "exile", "exo", "exo-2", "expletus-sans", "explora",
    "expose", "fa-1", "fablab", "faculty-glyphic", "fahkwang", "familjen-grotesk",
    "fanwood-text", "farro", "farsan", "fascinate", "fascinate-inline", "faster-one",
    "fasthand", "fauna-one", "faustina", "federant", "federo", "felipa", "fenix",
    "festive", "figtree", "finger-paint", "finlandica", "fira-code", "fira-mono",
    "fira-sans", "fira-sans-condensed", "fira-sans-extra-condensed", "fjalla-one",
    "fjord-one", "flamenco", "flavors", "fleur-de-leah", "fleuron", "fliege-mono",
    "flow-block", "flow-circular", "flow-rounded", "flux", "fluxisch-else", "foldit",
    "fondamento", "fontdiner-swanky", "forum", "fragment-mono", "frakturmeta",
    "francois-one", "frank-ruhl-libre", "fraunces", "freak-grotesk-next",
    "freckle-face", "fredericka-the-great", "fredoka", "freehand", "freeman",
    "fresca", "frijole", "fruktur", "ft88", "fugaz-one", "fuggles", "funnel-display",
    "funnel-sans", "fustat", "fuzzy-bubbles", "ga-maamli", "gabarito", "gaegu",
    "gafata", "gajraj-one", "galada", "galdeano", "galindo", "gambarino", "gambetta",
    "gamja-flower", "gantari", "gap-sans", "gasoek-one", "gayathri", "geist",
    "geist-mono", "gelasio", "gemunu-libre", "general-sans", "genos",
    "gentium-book-plus", "gentium-plus", "geo", "geologica", "geom", "georama",
    "geostar", "geostar-fill", "germania-one", "gfs-didot", "gfs-neohellenic",
    "gideon-roman", "gidole", "gidugu", "gilda-display", "girassol",
    "give-you-glory", "glass-antiqua", "glegoo", "gloock", "gloria-hallelujah",
    "glory", "gluten", "gnomon", "goblin-one", "gochi-hand", "goldman",
    "golos-text", "google-sans", "google-sans-code", "google-sans-flex", "gorditas",
    "gothic-a1", "gotu", "goudy-bookletter-1911", "gowun-batang", "gowun-dodum",
    "graduate", "grand-hotel", "grandiflora-one", "grandstander", "grape-nuts",
    "grave-presse", "gravitas-one", "great-vibes", "grechen-fuemen", "grenze",
    "grenze-gotisch", "grey-qo", "griffy", "grith", "gruppo", "gudea", "gugi",
    "gulzar", "gupter", "gurajada", "gveret-levin", "gwendolyn", "habibi",
    "hachi-maru-pop", "hahmlet", "halant", "halibut", "hammersmith-one", "hanalei",
    "hanalei-fill", "handjet", "handlee", "hanken-grotesk", "hanuman",
    "happy-monkey", "harmattan", "hauora", "havana", "headland-one",
    "hedvig-letters-sans", "hedvig-letters-serif", "heebo", "henny-penny",
    "hepta-slab", "herr-von-muellerhoff", "hershey-noailles-times", "hi-melody",
    "hikasami", "hina-mincho", "hind", "hind-guntur", "hind-madurai",
    "hind-mysuru", "hind-siliguri", "hind-vadodara", "holtwood-one-sc",
    "homemade-apple", "homenaje", "honk", "hooskai-chamfered-square", "hoover",
    "host-grotesk", "huab", "hubballi", "hubot-sans", "huninn", "hurricane",
    "iansui", "ibarra-real-nova", "ibm-plex-mono", "ibm-plex-sans",
    "ibm-plex-sans-arabic", "ibm-plex-sans-condensed", "ibm-plex-sans-devanagari",
    "ibm-plex-sans-hebrew", "ibm-plex-sans-jp", "ibm-plex-sans-kr",
    "ibm-plex-sans-thai", "ibm-plex-sans-thai-looped", "ibm-plex-serif",
    "iceberg", "iceland", "idiqlat", "im-fell-double-pica", "im-fell-double-pica-sc",
    "im-fell-dw-pica", "im-fell-dw-pica-sc", "im-fell-english", "im-fell-english-sc",
    "im-fell-french-canon", "im-fell-french-canon-sc", "im-fell-great-primer",
    "im-fell-great-primer-sc", "imbue", "imperial-script", "imprima",
    "inclusive-sans", "inconsolata", "inder", "indie-flower", "ingrid-darling",
    "inika", "inknut-antiqua", "inria-sans", "inria-serif", "inspiration",
    "instrument-sans", "instrument-serif", "intel-one-mono", "iosevka-charon",
    "iosevka-charon-mono", "irish-grover", "island-moments", "istok-web",
    "italiana", "italianno", "itim", "jacquard-12", "jacquard-12-charted",
    "jacquard-24", "jacquard-24-charted", "jacquarda-bastarda-9",
    "jacquarda-bastarda-9-charted", "jacques-francois", "jacques-francois-shadow",
    "jaini", "jaini-purva", "jakob", "jaldi", "jaro", "jersey-10",
    "jersey-10-charted", "jersey-15", "jersey-15-charted", "jersey-20",
    "jersey-20-charted", "jersey-25", "jersey-25-charted", "jetbrains-mono",
    "jim-nightshade", "joan", "jockey-one", "jolly-lodger", "jomhuria", "jomolhari",
    "josefin-sans", "josefin-slab", "jost", "joti-one", "jua", "judson", "julee",
    "julius-sans-one", "junge", "junicode-vf", "jura", "just-another-hand",
    "just-me-again-down-here", "k2d", "kablammo", "kadwa", "kaisei-decol",
    "kaisei-harunoumi", "kaisei-opti", "kaisei-tokumin", "kalam", "kalnia",
    "kalnia-glaze", "kameron", "kanchenjunga", "kanit", "kantumruy-pro",
    "kapakana", "karantina", "karla", "karma", "katibeh", "kaushan-script",
    "kavivanar", "kavoon", "kay-pho-du", "kdam-thmor-pro", "keania-one",
    "kedebideri", "kelly-slab", "kenia", "khand", "khula", "kihim", "kings",
    "kirang-haerang", "kite-one", "kiwi-maru", "klee-one", "knewave", "kobata",
    "kodchasan", "kode-mono", "koh-santepheap", "koho", "kola", "kolker-brush",
    "konkhmer-sleokchher", "kosugi", "kosugi-maru", "kotta-one", "koulen",
    "kranky", "kreon", "kristi", "krona-one", "krub", "kufam", "kulim-park",
    "kumar-one", "kumar-one-outline", "kumbh-sans", "kurale", "la-belle-aurore",
    "labrada", "lacquer", "laila", "lakki-reddy", "lalezar", "lancelot", "langar",
    "lateef", "lato", "lavishly-yours", "lavoir", "lct-iptex", "lct-ciburial",
    "league-gothic", "league-script", "league-spartan", "leckerli-one", "ledger",
    "lekton", "lemon", "lemonada", "lexend", "lexend-deca", "lexend-exa",
    "lexend-giga", "lexend-mega", "lexend-peta", "lexend-tera", "lexend-zetta",
    "libertinus-keyboard", "libertinus-math", "libertinus-mono", "libertinus-sans",
    "libertinus-serif", "libertinus-serif-display", "libre-barcode-128",
    "libre-barcode-128-text", "libre-barcode-39", "libre-barcode-39-extended",
    "libre-barcode-39-extended-text", "libre-barcode-39-text",
    "libre-barcode-ean13-text", "libre-baskerville", "libre-bodoni",
    "libre-caslon-condensed", "libre-caslon-display", "libre-caslon-text",
    "libre-franklin", "licorice", "life-savers", "liga-sans", "lilex",
    "lilita-one", "lily-script-one", "limelight", "linden-hill", "line-seed-jp",
    "lisu-bosa", "liter", "literata", "liu-jian-mao-cao", "livvic", "lobster",
    "lobster-two", "londrina-outline", "londrina-shadow", "londrina-sketch",
    "londrina-solid", "long-cang", "lora", "love-light", "love-ya-like-a-sister",
    "loved-by-the-king", "lovers-quarrel", "lt-avocado", "lt-remark",
    "luckiest-guy", "lugrasimo", "lumanosimo", "lunasima", "lunchtype25",
    "lusitana", "lustria", "luxurious-roman", "luxurious-script", "lxgw-marker-gothic",
    "lxgw-wenkai-mono-tc", "lxgw-wenkai-tc", "m-plus-1", "m-plus-1-code",
    "m-plus-1p", "m-plus-2", "m-plus-code-latin", "m-plus-rounded-1c",
    "ma-shan-zheng", "macondo", "macondo-swash-caps", "mada", "madimi-one",
    "magiel", "magra", "maiden-orange", "maitree", "major-mono-display", "mako",
    "mali", "mallanna", "maname", "mandali", "manjari", "manrope", "mansalva",
    "manuale", "manufacturing-consent", "marcellus", "marcellus-sc", "marck-script",
    "margarine", "marhey", "markazi-text", "marko-one", "marmelad", "martel",
    "martel-sans", "martian-mono", "marvel", "matangi", "mate", "mate-sc",
    "matemasie", "mattone", "maven-pro", "mazius-display", "mclaren", "mea-culpa",
    "meddon", "medievalsharp", "medula-one", "meera-inimai", "megrim", "meie-script",
    "melodrama", "menbere", "meow-script", "merienda", "merriweather",
    "merriweather-sans", "messapia", "metal", "metal-mania", "metamorphous",
    "metrophobic", "michroma", "micro-5", "micro-5-charted", "milkman",
    "milonga", "miltonian", "miltonian-tattoo", "mina", "mingzat", "miniver",
    "miriam-libre", "mirza", "miss-fajardose", "mitr", "mluvka", "mochiy-pop-one",
    "mochiy-pop-p-one", "modak", "modern-antiqua", "moderustic", "mogra", "mohave",
    "moirai-one", "molengo", "molle", "momo-signature", "momo-trust-display",
    "momo-trust-sans", "mona-sans", "monda", "monofett", "monomakh",
    "monomaniac-one", "monoton", "monsieur-la-doulaise", "montaga", "montagu-slab",
    "montecarlo", "montez", "montserrat", "montserrat-alternates",
    "montserrat-underline", "moo-lah-lah", "mooli", "moon-dance", "moul",
    "moulpali", "mountains-of-christmas", "mourier", "mouse-memoirs",
    "mozilla-headline", "mozilla-text", "mr-bedfort", "mr-dafoe", "mr-de-haviland",
    "mrs-saint-delafield", "mrs-sheppards", "ms-madi", "mukta", "mukta-mahee",
    "mukta-malar", "mukta-vaani", "mulish", "murecho", "museomoderno", "my-soul",
    "mynerve", "mystery-quest", "nabla", "namdhinggo", "nanum-brush-script",
    "nanum-gothic", "nanum-gothic-coding", "nanum-myeongjo", "nanum-pen-script",
    "narnoor", "nata-sans", "national-park", "neco", "necto-mono", "nemoy",
    "n-o-castel", "neonderthaw", "nerko-one", "neucha", "neuton", "neutral-sans",
    "new-amsterdam", "new-rocker", "new-tegomin", "new-title", "news-cycle",
    "newsreader", "niconne", "nippo", "niramit", "nixie-one", "nobile",
    "nocurvesboustrophedon", "nokora", "norican", "norm", "nosifer", "notable",
    "nothing-you-could-do", "noticia-text", "noto-kufi-arabic", "noto-music",
    "noto-naskh-arabic", "noto-nastaliq-urdu", "noto-rashi-hebrew", "noto-sans",
    "noto-sans-adlam", "noto-sans-adlam-unjoined", "noto-sans-anatolian-hieroglyphs",
    "noto-sans-arabic", "noto-sans-armenian", "noto-sans-avestan",
    "noto-sans-balinese", "noto-sans-bamum", "noto-sans-bassa-vah",
    "noto-sans-batak", "noto-sans-bengali", "noto-sans-bhaiksuki",
    "noto-sans-brahmi", "noto-sans-buginese", "noto-sans-buhid",
    "noto-sans-canadian-aboriginal", "noto-sans-carian", "noto-sans-caucasian-albanian",
    "noto-sans-cham", "noto-sans-cherokee", "noto-sans-chorasmian",
    "noto-sans-coptic", "noto-sans-cuneiform", "noto-sans-cypriot",
    "noto-sans-cypro-minoan", "noto-sans-deseret", "noto-sans-devanagari",
    "noto-sans-display", "noto-sans-duployan", "noto-sans-egyptian-hieroglyphs",
    "noto-sans-elbasan", "noto-sans-elymaic", "noto-sans-ethiopic",
    "noto-sans-georgian", "noto-sans-glagolitic", "noto-sans-gothic",
    "noto-sans-grantha", "noto-sans-gujarati", "noto-sans-gunjala-gondi",
    "noto-sans-gurmukhi", "noto-sans-hanifi-rohingya", "noto-sans-hanunoo",
    "noto-sans-hatran", "noto-sans-hebrew", "noto-sans-hk",
    "noto-sans-imperial-aramaic", "noto-sans-indic-siyaq-numbers",
    "noto-sans-inscriptional-pahlavi", "noto-sans-inscriptional-parthian",
    "noto-sans-javanese", "noto-sans-jp", "noto-sans-kaithi", "noto-sans-kannada",
    "noto-sans-kawi", "noto-sans-kayah-li", "noto-sans-kharoshthi",
    "noto-sans-khmer", "noto-sans-khojki", "noto-sans-khudawadi", "noto-sans-kr",
    "noto-sans-lao", "noto-sans-lao-looped", "noto-sans-lepcha", "noto-sans-limbu",
    "noto-sans-linear-a", "noto-sans-linear-b", "noto-sans-lisu",
    "noto-sans-lydian", "noto-sans-mahajani", "noto-sans-malayalam",
    "noto-sans-mandaic", "noto-sans-manichaean", "noto-sans-marchen",
    "noto-sans-masaram-gondi", "noto-sans-math", "noto-sans-mayan-numerals",
    "noto-sans-medefaidrin", "noto-sans-meetei-mayek", "noto-sans-mende-kikakui",
    "noto-sans-meroitic", "noto-sans-miao", "noto-sans-modi", "noto-sans-mongolian",
    "noto-sans-mono", "noto-sans-mro", "noto-sans-multani", "noto-sans-myanmar",
    "noto-sans-nabataean", "noto-sans-nag-mundari", "noto-sans-nandinagari",
    "noto-sans-new-tai-lue", "noto-sans-newa", "noto-sans-nko",
    "noto-sans-nko-unjoined", "noto-sans-nushu", "noto-sans-ogham",
    "noto-sans-ol-chiki", "noto-sans-old-hungarian", "noto-sans-old-italic",
    "noto-sans-old-north-arabian", "noto-sans-old-permic", "noto-sans-old-persian",
    "noto-sans-old-sogdian", "noto-sans-old-south-arabian", "noto-sans-old-turkic",
    "noto-sans-oriya", "noto-sans-osage", "noto-sans-osmanya", "noto-sans-pahawh-hmong",
    "noto-sans-palmyrene", "noto-sans-pau-cin-hau", "noto-sans-phagspa",
    "noto-sans-phoenician", "noto-sans-psalter-pahlavi", "noto-sans-rejang",
    "noto-sans-runic", "noto-sans-samaritan", "noto-sans-saurashtra", "noto-sans-sc",
    "noto-sans-sharada", "noto-sans-shavian", "noto-sans-siddham",
    "noto-sans-signwriting", "noto-sans-sinhala", "noto-sans-sogdian",
    "noto-sans-sora-sompeng", "noto-sans-soyombo", "noto-sans-sundanese",
    "noto-sans-sunuwar", "noto-sans-syloti-nagri", "noto-sans-symbols",
    "noto-sans-symbols-2", "noto-sans-syriac", "noto-sans-syriac-eastern",
    "noto-sans-syriac-western", "noto-sans-tagalog", "noto-sans-tagbanwa",
    "noto-sans-tai-le", "noto-sans-tai-tham", "noto-sans-tai-viet",
    "noto-sans-takri", "noto-sans-tamil", "noto-sans-tamil-supplement",
    "noto-sans-tangsa", "noto-sans-tc", "noto-sans-telugu", "noto-sans-thaana",
    "noto-sans-thai", "noto-sans-thai-looped", "noto-sans-tifinagh",
    "noto-sans-tirhuta", "noto-sans-ugaritic", "noto-sans-vai",
    "noto-sans-vithkuqi", "noto-sans-wancho", "noto-sans-warang-citi",
    "noto-sans-yi", "noto-sans-zanabazar-square", "noto-serif",
    "noto-serif-ahom", "noto-serif-armenian", "noto-serif-balinese",
    "noto-serif-bengali", "noto-serif-devanagari", "noto-serif-display",
    "noto-serif-dives-akuru", "noto-serif-dogra", "noto-serif-ethiopic",
    "noto-serif-georgian", "noto-serif-grantha", "noto-serif-gujarati",
    "noto-serif-gurmukhi", "noto-serif-hebrew", "noto-serif-hentaigana",
    "noto-serif-hk", "noto-serif-jp", "noto-serif-kannada", "noto-serif-khitan-small-script",
    "noto-serif-khmer", "noto-serif-khojki", "noto-serif-kr", "noto-serif-lao",
    "noto-serif-makasar", "noto-serif-malayalam", "noto-serif-np-hmong",
    "noto-serif-old-uyghur", "noto-serif-oriya", "noto-serif-ottoman-siyaq",
    "noto-serif-sc", "noto-serif-sinhala", "noto-serif-tamil", "noto-serif-tangut",
    "noto-serif-tc", "noto-serif-telugu", "noto-serif-thai", "noto-serif-tibetan",
    "noto-serif-todhri", "noto-serif-toto", "noto-serif-vithkuqi", "noto-serif-yezidi",
    "noto-traditional-nushu", "noto-znamenny-musical-notation", "nouvelle-grotesquerie",
    "nova-cut", "nova-flat", "nova-mono", "nova-oval", "nova-round", "nova-script",
    "nova-slim", "nova-square", "now", "ntr", "numans", "nunito", "nunito-sans",
    "nuosu-sil", "odibee-sans", "odor-mean-chey", "offside", "oi", "ojuju",
    "old-standard-tt", "oldenburg", "ole", "oleo-script", "oleo-script-swash-caps",
    "onest", "oooh-baby", "open-runde", "open-sans", "open-sauce-one",
    "open-sauce-sans", "open-sauce-two", "opening-hours-sans", "optician-sans",
    "oranienbaum", "orbit", "orbitron", "oregano", "orelega-one", "orienta",
    "original-surfer", "ortica-angular", "ortica-linear", "oswald", "outfit",
    "over-the-rainbow", "overlock", "overlock-sc", "overpass", "overpass-mono",
    "ovo", "oxanium", "oxygen", "oxygen-mono", "pacifico", "padauk",
    "padyakke-expanded-one", "palanquin", "palanquin-dark", "palette-mosaic",
    "pally", "panchang", "pangolin", "paprika", "paquito", "parastoo",
    "parisienne", "parkinsans", "patrick-hand-sc", "patriot", "pattaya",
    "patua-one", "pavanam", "paytone-one", "pecita", "peddana", "pencerio",
    "peralta", "permanent-marker", "petemoss", "petit-formal-script", "petrona",
    "philosopher", "phudu", "piazzolla", "piedra", "pilcrow-rounded", "playball",
    "player-sans-mono-8x8", "playfair", "playfair-display", "playfair-display-sc",
    "playpen-sans", "playpen-sans-arabic", "playpen-sans-deva", "playpen-sans-hebrew",
    "playpen-sans-thai", "playwrite-ar", "playwrite-ar-guides", "playwrite-at",
    "playwrite-at-guides", "playwrite-au-nsw", "playwrite-au-nsw-guides",
    "playwrite-au-qld", "playwrite-au-qld-guides", "playwrite-au-sa",
    "playwrite-au-sa-guides", "playwrite-au-tas", "playwrite-au-tas-guides",
    "playwrite-au-vic", "playwrite-au-vic-guides", "playwrite-be-vlg",
    "playwrite-be-vlg-guides", "playwrite-be-wal", "playwrite-be-wal-guides",
    "playwrite-br", "playwrite-br-guides", "playwrite-ca", "playwrite-ca-guides",
    "playwrite-cl", "playwrite-cl-guides", "playwrite-co", "playwrite-co-guides",
    "playwrite-cu", "playwrite-cu-guides", "playwrite-cz", "playwrite-cz-guides",
    "playwrite-de-grund", "playwrite-de-grund-guides", "playwrite-de-la",
    "playwrite-de-la-guides", "playwrite-de-sas", "playwrite-de-sas-guides",
    "playwrite-de-va", "playwrite-de-va-guides", "playwrite-dk-loopet",
    "playwrite-dk-loopet-guides", "playwrite-dk-uloopet", "playwrite-dk-uloopet-guides",
    "playwrite-es", "playwrite-es-deco", "playwrite-es-deco-guides", "playwrite-es-guides",
    "playwrite-fr-moderne", "playwrite-fr-moderne-guides", "playwrite-fr-trad",
    "playwrite-fr-trad-guides", "playwrite-gb-j", "playwrite-gb-j-guides",
    "playwrite-gb-s", "playwrite-gb-s-guides", "playwrite-hr", "playwrite-hr-guides",
    "playwrite-hr-lijeva", "playwrite-hr-lijeva-guides", "playwrite-hu",
    "playwrite-hu-guides", "playwrite-id", "playwrite-id-guides", "playwrite-ie",
    "playwrite-ie-guides", "playwrite-in", "playwrite-in-guides", "playwrite-is",
    "playwrite-is-guides", "playwrite-it-moderna", "playwrite-it-moderna-guides",
    "playwrite-it-trad", "playwrite-it-trad-guides", "playwrite-mx",
    "playwrite-mx-guides", "playwrite-ng-modern", "playwrite-ng-modern-guides",
    "playwrite-nl", "playwrite-nl-guides", "playwrite-no", "playwrite-no-guides",
    "playwrite-nz", "playwrite-nz-basic", "playwrite-nz-guides", "playwrite-pe",
    "playwrite-pe-guides", "playwrite-pl", "playwrite-pl-guides", "playwrite-pt",
    "playwrite-pt-guides", "playwrite-ro", "playwrite-ro-guides", "playwrite-sk",
    "playwrite-sk-guides", "playwrite-tz", "playwrite-tz-guides", "playwrite-us-modern",
    "playwrite-us-modern-guides", "playwrite-us-trad", "playwrite-us-trad-guides",
    "playwrite-vn", "playwrite-vn-guides", "playwrite-za", "playwrite-za-guides",
    "plein", "plus-jakarta-sans", "pochaevsk", "podkova", "poetsen-one", "poiret-one",
    "poller-one", "poltawski-nowy", "poly", "pompiere", "ponnala", "ponomar",
    "pontano-sans", "poor-story", "poppins", "port-lligat-sans", "port-lligat-slab",
    "potta-one", "pragati-narrow", "praise", "pramukh-rounded", "prata",
    "preahvihear", "press-start-2p", "pretendard-variable", "quantico",
    "quarantype", "quattrocento", "quattrocento-sans", "questrial", "quicksand",
    "quilon", "quintessential", "qwigley", "qwitcher-grypen", "racing-sans-one",
    "radio-canada", "radio-canada-big", "radley", "rag", "rajdhani", "rakkas",
    "raleway", "raleway-dots", "ramabhadra", "ramaraja", "rambla", "rammetto-one",
    "rampart-one", "ramsina", "ranade", "ranchers", "rancho", "ranga", "rasa",
    "rationale", "raveo-variable", "ravi-prakash", "readex-pro", "rechteck",
    "recia", "recursive", "red-hat-display", "red-hat-mono", "red-hat-text",
    "red-rose", "redacted", "redacted-script", "reddit-mono", "reddit-sans",
    "reddit-sans-condensed", "redressed", "reem-kufi", "reem-kufi-fun",
    "reem-kufi-ink", "reenie-beanie", "reggae-one", "rem", "rena", "rethink-sans",
    "revalia", "rhodium-libre", "ribes", "ribeye", "ribeye-marrow", "righteous",
    "risque", "road-rage", "roboto", "roboto-condensed", "roboto-flex", "rochester",
    "rock-3d", "rock-salt", "rocknroll-one", "rokkitt", "romanesco", "ronzino",
    "ropa-sans", "rosaline", "rosario", "rosarivo", "rouge-script", "roundo",
    "rowan", "rowdies", "rozha-one", "rubik", "rubik-80s-fade", "rubik-beastly",
    "rubik-broken-fax", "rubik-bubbles", "rubik-burned", "rubik-dirt",
    "rubik-distressed", "rubik-doodle-shadow", "rubik-doodle-triangles",
    "rubik-gemstones", "rubik-glitch", "rubik-glitch-pop", "rubik-iso",
    "rubik-lines", "rubik-maps", "rubik-marker-hatch", "rubik-maze",
    "rubik-microbe", "rubik-mono-one", "rubik-moonrocks", "rubik-pixels",
    "rubik-puddles", "rubik-scribble", "rubik-spray-paint", "rubik-storm",
    "rubik-vinyl", "rubik-wet-paint", "ruda", "rufina", "ruge-boogie", "ruluko",
    "rum-raisin", "ruslan-display", "russo-one", "ruthie", "ruwudu", "rx100",
    "rye", "sacramento", "sahitya", "sail", "saira", "saira-condensed",
    "saira-extra-condensed", "saira-semi-condensed", "saira-stencil-one",
    "salsa", "sanchez", "sancreek", "sankofa-display", "sansation", "sansita",
    "sansita-swashed", "sarina", "sarpanch", "sassy-frass", "satisfy", "satoshi",
    "savate", "sawarabi-gothic", "sawarabi-mincho", "scada", "scheherazade-new",
    "schibsted-grotesk", "schoolbell", "schroffer-mono", "science-gothic",
    "scope-one", "seaweed-script", "secular-one", "sedan", "sedan-sc",
    "sedgwick-ave", "sedgwick-ave-display", "segment", "sekuya", "sen",
    "send-flowers", "sentient", "server-mono", "sevillana", "seymour-one",
    "shadows-into-light", "shadows-into-light-two", "shafarik", "shalimar",
    "shippori-antique", "shippori-antique-b1", "shippori-mincho",
    "shippori-mincho-b1", "shizuru", "shojumaru", "short-stack", "shrikhand",
    "side-a-inflated", "sigmar", "sigmar-one", "signika", "signika-negative",
    "silkscreen", "simonetta", "single-day", "sinistre", "sintony", "sirin-stencil",
    "sirivennela", "six-caps", "sixtyfour", "sixtyfour-convergence", "skranji",
    "slabo-13px", "slabo-27px", "slackey", "slackside-one", "smokum", "smooch",
    "smooch-sans", "smythe", "sn-pro", "sneaky", "sniglet", "snippet",
    "snowburst-one", "sofadi-one", "sofia", "sofia-sans", "sofia-sans-condensed",
    "sofia-sans-extra-condensed", "sofia-sans-semi-condensed", "solitreo",
    "solway", "sometype-mono", "song-myung", "sono", "sonsie-one", "sora",
    "soria", "sorts-mill-goudy", "sour-gummy", "source-code-pro", "source-sans-3",
    "source-serif-4", "space-grotesk", "space-mono", "special-elite",
    "special-gothic", "special-gothic-condensed-one", "special-gothic-expanded-one",
    "spectral", "spectral-sc", "spicy-rice", "spinnaker", "spirax", "splash",
    "spline-sans", "spline-sans-mono", "sprat", "squada-one", "square-peg",
    "sree-krushnadevaraya", "sriracha", "srisakdi", "staatliches",
    "stack-sans-headline", "stack-sans-notch", "stack-sans-text", "stalemate",
    "stalinist-one", "stardom", "stardos-stencil", "stick", "stick-no-bills",
    "stint-ultra-condensed", "stint-ultra-expanded", "stix-two-text", "stoke",
    "story-script", "strait", "striper", "style-script", "stylish", "styro",
    "sue-ellen-francisco", "suez-one", "sulphur-point", "sumana", "sunflower",
    "sunshiney", "supermercado-one", "supreme", "sura", "suranna", "suravaram",
    "suse", "suse-mono", "suwannaphum", "swanky-and-moo-moo", "switzer",
    "syncopate", "syne", "syne-mono", "syne-tactile", "synonym", "tabular",
    "tac-one", "tachyo", "tagesschrift", "tai-heritage-pro", "tajawal",
    "tangerine", "tanker", "telex", "telma", "tenali-ramakrishna", "tenor-sans",
    "terminal-grotesque", "text-me-one", "texturina", "thasadith",
    "the-girl-next-door", "the-nautigal", "thestral-neue", "tienne",
    "tiktok-sans", "tillana", "tilt-neon", "tilt-prism", "tilt-warp", "timmana",
    "tinos", "tiny5", "tiro-bangla", "tiro-devanagari-hindi", "tiro-devanagari-marathi",
    "tiro-devanagari-sanskrit", "tiro-gurmukhi", "tiro-kannada", "tiro-tamil",
    "tiro-telugu", "tirra", "titan-one", "titillium-web", "tmt-limkin",
    "tmt-limkin-pixel", "tmt-mini-mochi", "tmt-paint", "tomorrow", "tourney",
    "trade-winds", "whisper", "windsong", "winky-rough", "winky-sans", "wire-one",
    "wittgenstein", "wix-madefor-display", "wix-madefor-text", "work-sans",
    "workbench", "writer", "xanh-mono", "xx-liberte", "xx-stardust", "yaldevi",
    "yanone-kaffeesatz", "yantramanav", "yarndings-12", "yarndings-12-charted",
    "yarndings-20", "yarndings-20-charted", "yatra-one", "yellowtail",
    "yeon-sung", "yeseva-one", "yesteryear", "yomogi", "young-serif", "yrsa",
    "ysabeau", "ysabeau-infant", "ysabeau-office", "ysabeau-sc", "yuji-boku",
    "yuji-hentaigana-akari", "yuji-hentaigana-akebono", "yuji-mai", "yuji-syuku",
    "yunga", "yusei-magic", "zain", "zalando-sans", "zalando-sans-expanded",
    "zalando-sans-semiexpanded", "zcool-kuaile", "zcool-qingke-huangyou",
    "zcool-xiaowei", "zen-antique", "zen-dots", "zen-kaku-gothic-antique",
    "zen-kaku-gothic-new", "zen-kurenaido", "zen-loop", "zen-maru-gothic",
    "zen-old-mincho", "zen-tokyo-zoo", "zeyada", "zhi-mang-xing", "zilla-slab",
    "zilla-slab-highlight", "zina", "zodiak",
    // Generic CSS aliases sometimes returned by rich-text HTML
    "ui-sans-serif", "ui-serif", "ui-monospace",
])

// ---------------------------------------------------------------------------
// WCAG color contrast helpers
// ---------------------------------------------------------------------------

function parseColor(color: string): { r: number; g: number; b: number; a: number } | null {
    const hexMatch = color.match(/^#([0-9a-f]{3,8})$/i)
    if (hexMatch) {
        const hex = hexMatch[1]
        if (hex.length === 3) {
            return {
                r: parseInt(hex[0] + hex[0], 16),
                g: parseInt(hex[1] + hex[1], 16),
                b: parseInt(hex[2] + hex[2], 16),
                a: 1,
            }
        }
        if (hex.length === 6) {
            return {
                r: parseInt(hex.slice(0, 2), 16),
                g: parseInt(hex.slice(2, 4), 16),
                b: parseInt(hex.slice(4, 6), 16),
                a: 1,
            }
        }
        if (hex.length === 8) {
            return {
                r: parseInt(hex.slice(0, 2), 16),
                g: parseInt(hex.slice(2, 4), 16),
                b: parseInt(hex.slice(4, 6), 16),
                a: parseInt(hex.slice(6, 8), 16) / 255,
            }
        }
    }
    const rgbMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/)
    if (rgbMatch) {
        return {
            r: parseInt(rgbMatch[1], 10),
            g: parseInt(rgbMatch[2], 10),
            b: parseInt(rgbMatch[3], 10),
            a: rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1,
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

function isLockedNode(node: AnyNode): boolean {
    if (node.position === "absolute" || node.position === "fixed") return true
    if (("top" in node && node.top !== null) || ("bottom" in node && node.bottom !== null) || ("left" in node && node.left !== null) || ("right" in node && node.right !== null)) return true
    return false
}

function getNodeName(node: AnyNode): string {
    return (typeof node.name === "string" ? node.name : null) || node.id
}

function tokenizeText(value: string): Array<string> {
    const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    if (normalized.length === 0) return []
    return normalized.split(/\s+/).filter((token) => token.length >= 2)
}

function unionTokens(...sets: ReadonlyArray<ReadonlySet<string>>): Set<string> {
    const out = new Set<string>()
    for (const set of sets) {
        for (const token of set) out.add(token)
    }
    return out
}

function overlapScore(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
    if (left.size === 0 || right.size === 0) return 0
    let intersection = 0
    for (const token of left) {
        if (right.has(token)) intersection++
    }
    const minSize = Math.min(left.size, right.size)
    if (minSize === 0) return 0
    return intersection / minSize
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0
}

function getPublishedEnvironmentUrls(publishInfo: PublishInfo | null): ReadonlyArray<PublishedEnvironmentUrl> {
    const environments: Array<PublishedEnvironmentUrl> = []

    if (publishInfo?.production) {
        const production = publishInfo.production
        const productionUrl = isNonEmptyString(production.currentPageUrl) ? production.currentPageUrl : isNonEmptyString(production.url) ? production.url : null
        if (productionUrl !== null) environments.push({ environment: "production", url: productionUrl.trim() })
    }

    if (publishInfo?.staging) {
        const staging = publishInfo.staging
        const stagingUrl = isNonEmptyString(staging.currentPageUrl) ? staging.currentPageUrl : isNonEmptyString(staging.url) ? staging.url : null
        if (stagingUrl !== null) environments.push({ environment: "staging", url: stagingUrl.trim() })
    }

    return environments
}

function getPublishedUrlFromInfo(publishInfo: PublishInfo | null): string | null {
    return getPublishedEnvironmentUrls(publishInfo)[0]?.url ?? null
}

function stripTrailingSlash(value: string): string {
    return value.replace(/\/+$/, "")
}

const DEFAULT_SEMANTIC_AUDIT_API_URL = "https://semantic-audit-api.vercel.app"

function normalizePagePath(page: AnyNode): string | null {
    const rawPath = typeof page.path === "string" ? page.path.trim() : ""
    if (rawPath.length === 0) return null
    if (rawPath === "/") return "/"
    const prefixed = rawPath.startsWith("/") ? rawPath : `/${rawPath}`
    return prefixed.replace(/\/+$/, "") || "/"
}

function isDynamicTemplatePath(path: string): boolean {
    return path.split("/").some((segment) => segment.startsWith(":"))
}

function buildPublishedPageUrl(basePublishedUrl: string, page: AnyNode): string | null {
    try {
        const base = new URL(basePublishedUrl)
        const path = normalizePagePath(page)
        if (path === null) return null
        if (isDynamicTemplatePath(path)) return null
        const origin = stripTrailingSlash(base.origin)
        return path === "/" ? `${origin}/` : `${origin}${path}`
    } catch {
        return null
    }
}

function getSemanticAuditApiBaseUrl(): string | null {
    const candidate = import.meta.env?.VITE_SEMANTIC_AUDIT_API_URL ?? DEFAULT_SEMANTIC_AUDIT_API_URL
    if (typeof candidate !== "string") return null
    const trimmed = candidate.trim()
    if (trimmed.length === 0) return null
    return stripTrailingSlash(trimmed)
}

async function getPublishedSiteUrl(): Promise<string | null> {
    try {
        const info = await framer.getPublishInfo()
        const url = getPublishedUrlFromInfo(info)
        if (isNonEmptyString(url) && /^https?:\/\//.test(url.trim())) return url.trim()
        return null
    } catch {
        return null
    }
}

async function fetchPublishedHtml(url: string): Promise<string> {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}&t=${Date.now()}`
    try {
        const response = await fetch(proxyUrl, { cache: "no-store" })
        if (!response.ok) {
            throw new Error(`Published page fetch failed (HTTP ${response.status})`)
        }
        return await response.text()
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`Failed to fetch published page '${url}': ${message}`)
    }
}

function parseSemanticApiTagInfo(payload: unknown): PublishedTagInfo | null {
    if (payload === null || typeof payload !== "object") return null
    const apiPayload = payload as SemanticTagApiResponse
    if (apiPayload.ok !== true) return null
    const extraction = apiPayload.extraction
    if (!extraction || typeof extraction !== "object") return null

    const hasH1 = extraction.hasH1 === true
    const hasNav = extraction.hasNav === true
    const hasFooter = extraction.hasFooter === true
    
    const bodyStructureRaw = Array.isArray(extraction.bodyStructure) ? extraction.bodyStructure : []
    const bodyStructure = bodyStructureRaw
        .map((tag) => (typeof tag === "string" ? tag.trim().toLowerCase() : ""))
        .filter((tag) => tag.length > 0)

    const headingHierarchyRaw = Array.isArray(extraction.headingHierarchy) ? extraction.headingHierarchy : []
    const headingHierarchy = headingHierarchyRaw
        .map((tag) => (typeof tag === "string" ? tag.trim().toLowerCase() : ""))
        .filter((tag) => tag.length > 0)

    return {
        hasH1,
        hasNav,
        hasFooter,
        bodyStructure,
        headingHierarchy,
    }
}

async function fetchPublishedTagInfoViaApi(url: string): Promise<PublishedTagInfo | null> {
    const apiBaseUrl = getSemanticAuditApiBaseUrl()
    if (apiBaseUrl === null) return null

    const endpoint = `${apiBaseUrl}/api/extract-tags?url=${encodeURIComponent(url)}&t=${Date.now()}`
    const response = await fetch(endpoint, { cache: "no-store" })
    if (!response.ok) {
        throw new Error(`Semantic tag API request failed (HTTP ${response.status})`)
    }

    const payload = await response.json()
    const parsed = parseSemanticApiTagInfo(payload)
    if (parsed === null) {
        throw new Error("Semantic tag API response was missing analysis data")
    }
    return parsed
}

async function fetchPublishedTagInfo(url: string): Promise<PublishedTagInfo> {
    const apiResult = await fetchPublishedTagInfoViaApi(url)
    if (apiResult !== null) return apiResult
    const html = await fetchPublishedHtml(url)
    return extractPublishedTagInfo(html)
}

type PublishedTagInfo = {
    readonly hasH1: boolean
    readonly hasNav: boolean
    readonly hasFooter: boolean
    readonly bodyStructure: ReadonlyArray<string>
    readonly headingHierarchy: ReadonlyArray<string>
}

type SemanticTagApiResponse = {
    readonly ok?: boolean
    readonly error?: string
    readonly extraction?: {
        readonly hasH1?: boolean
        readonly hasNav?: boolean
        readonly hasFooter?: boolean
        readonly bodyStructure?: ReadonlyArray<string>
        readonly headingHierarchy?: ReadonlyArray<string>
    }
}

function extractPublishedTagInfo(html: string): PublishedTagInfo {
    if (typeof DOMParser === "undefined") {
        return { hasH1: false, hasNav: false, hasFooter: false, bodyStructure: [], headingHierarchy: [] }
    }
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, "text/html")

    const IGNORE_TAGS = new Set(["script", "style", "noscript", "link", "meta"])

    // Try to find Framer root div first, otherwise use body
    const framerRoot = doc.querySelector("[data-framer-root]")
    const containerElement = framerRoot ?? doc.body

    // Extract immediate children order
    const bodyStructure = Array.from(containerElement.children)
        .map((child) => child.tagName.toLowerCase())
        .filter((tag) => !IGNORE_TAGS.has(tag))

    // Extract heading hierarchy (only H1 and H2 in order)
    const headingHierarchy = Array.from(doc.querySelectorAll("h1, h2, h3, h4, h5, h6"))
        .filter((el) => {
            const tag = el.tagName.toLowerCase()
            return tag === "h1" || tag === "h2"
        })
        .map((el) => el.tagName.toLowerCase())

    return {
        hasH1: doc.querySelector("h1") !== null,
        hasNav: doc.querySelector("nav") !== null,
        hasFooter: doc.querySelector("footer") !== null,
        bodyStructure,
        headingHierarchy,
    }
}

async function fetchPublishedMetadataInfo(url: string): Promise<PublishedMetadataInfo> {
    const apiResult = await fetchPublishedMetadataInfoViaApi(url)
    if (apiResult !== null) return apiResult

    const html = await fetchPublishedHtml(url)

    return extractPublishedMetadataInfoFromHtml(html)
}

function parseSemanticMetadataInfo(payload: unknown): PublishedMetadataInfo | null {
    if (payload === null || typeof payload !== "object") return null
    const apiPayload = payload as SemanticMetadataApiResponse
    if (apiPayload.ok !== true) return null

    const extraction = apiPayload.extraction
    if (!extraction || typeof extraction !== "object") return null

    const rawTitle = typeof extraction.title === "string" ? extraction.title.trim() : ""
    const hasDefaultTitle = rawTitle.length > 0 && isDefaultFramerMetadataTitle(rawTitle)
    const hasTitleSignal = extraction.hasTitle === true || rawTitle.length > 0
    const hasTitle = hasTitleSignal && !hasDefaultTitle
    const hasDescription = extraction.hasDescription === true || (typeof extraction.description === "string" && extraction.description.trim().length > 0)

    return {
        hasFavicon: extraction.hasFavicon === true,
        hasSocialPreview: extraction.hasSocialPreview === true,
        hasTitle,
        hasDescription,
        hasDefaultTitle,
    }
}

async function fetchPublishedMetadataInfoViaApi(url: string): Promise<PublishedMetadataInfo | null> {
    const apiBaseUrl = getSemanticAuditApiBaseUrl()
    if (apiBaseUrl === null) return null

    const endpoint = `${apiBaseUrl}/api/extract-metadata?url=${encodeURIComponent(url)}&t=${Date.now()}`
    const response = await fetch(endpoint, { cache: "no-store" })
    if (!response.ok) {
        throw new Error(`Metadata API request failed (HTTP ${response.status})`)
    }

    const payload = await response.json()
    const parsed = parseSemanticMetadataInfo(payload)
    if (parsed === null) {
        throw new Error("Metadata API response was missing extraction data")
    }

    return parsed
}

function extractPublishedMetadataInfoFromHtml(html: string): PublishedMetadataInfo {

    if (typeof DOMParser === "undefined") {
        throw new Error("DOMParser is not available for metadata inspection")
    }

    const parser = new DOMParser()
    const doc = parser.parseFromString(html, "text/html")

    const title = (doc.querySelector("title")?.textContent ?? "").trim()
    const description = (
        doc.querySelector("meta[name='description']")?.getAttribute("content")
        ?? doc.querySelector("meta[property='og:description']")?.getAttribute("content")
        ?? ""
    ).trim()

    const faviconSelectors = [
        "link[rel='icon']",
        "link[rel='shortcut icon']",
        "link[rel='apple-touch-icon']",
    ]

    const hasFavicon = faviconSelectors.some((selector) => {
        const node = doc.querySelector(selector)
        const href = node?.getAttribute("href")?.trim() ?? ""
        return href.length > 0
    })

    const ogImage = (doc.querySelector("meta[property='og:image']")?.getAttribute("content") ?? "").trim()
    const twitterImage = (doc.querySelector("meta[name='twitter:image']")?.getAttribute("content") ?? "").trim()
    const hasSocialImage = ogImage.length > 0 || twitterImage.length > 0
    const hasDefaultTitle = title.length > 0 && isDefaultFramerMetadataTitle(title)

    return {
        hasFavicon,
        hasSocialPreview: title.length > 0 && description.length > 0 && hasSocialImage,
        hasTitle: title.length > 0 && !hasDefaultTitle,
        hasDescription: description.length > 0,
        hasDefaultTitle,
    }
}

async function getCanvasHtmlForFrame(frameId: string): Promise<string | null> {
    try {
        const fn = (framer as unknown as Record<symbol, unknown>)[$framerInternal.getHTMLForNode]
        if (typeof fn !== "function") return null
        const result = await (fn as (id: string) => Promise<string | null>).call(framer, frameId)
        return result
    } catch {
        return null
    }
}


function extractPublishedFormTargets(html: string): ReadonlyArray<PublishedFormTarget> {
    if (typeof DOMParser === "undefined") return []
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, "text/html")
    const forms = Array.from(doc.querySelectorAll("form"))

    return forms.map((form, index) => {
        const selector = form.id ? `#${form.id}` : `form:nth-of-type(${index + 1})`
        const action = (form.getAttribute("action") || "").trim()
        const method = (form.getAttribute("method") || "").trim().toLowerCase()

        // Walk up the DOM from the form element to find the nearest Framer layer name.
        // Framer injects data-framer-name on rendered component instances and frames,
        // matching the layer name in the editor — use this as a reliable mapping key.
        // Skip button elements: the submit button may carry data-framer-name but is not the form root.
        let framerName = ""
        let current: Element | null = form
        while (current !== null && framerName === "") {
            const tag = current.tagName.toLowerCase()
            if (tag !== "button" && tag !== "input") {
                framerName = current.getAttribute("data-framer-name") || ""
            }
            current = current.parentElement
        }

        const fieldTokens = new Set<string>()
        const inputs = Array.from(form.querySelectorAll("input, textarea, select"))
        for (const input of inputs) {
            const attributes = [
                input.getAttribute("name") || "",
                input.getAttribute("id") || "",
                input.getAttribute("placeholder") || "",
                input.getAttribute("type") || "",
                input.getAttribute("aria-label") || "",
            ]
            for (const attrValue of attributes) {
                for (const token of tokenizeText(attrValue)) fieldTokens.add(token)
            }
        }

        const submitTokens = new Set<string>()
        const submitNodes = Array.from(form.querySelectorAll("button, input[type='submit'], input[type='button']"))
        for (const submitNode of submitNodes) {
            const textValue = submitNode instanceof HTMLInputElement
                ? (submitNode.value || submitNode.getAttribute("aria-label") || "")
                : (submitNode.textContent || submitNode.getAttribute("aria-label") || "")
            for (const token of tokenizeText(textValue)) submitTokens.add(token)
        }

        // Detect whether the published form has a send-to destination configured.
        // Framer injects the sendTo value into the HTML as a hidden input or data attribute
        // on the form or a nearby wrapper — check all of these signals.
        const destinationAttrPattern = /^(send[-_ ]?to|sendto|email|notify|recipient|webhook|destination|mailto)$/i

        // 1. Real action URL (not empty, not "#", not relative-same-page)
        const hasActionUrl = action.length > 0 && action !== "#" && /^https?:\/\//.test(action)

        // 2. Hidden inputs whose name suggests a destination
        const hiddenInputs = Array.from(form.querySelectorAll("input[type='hidden']"))
        const hasDestinationHiddenInput = hiddenInputs.some((input) =>
            destinationAttrPattern.test((input.getAttribute("name") || "").trim()) &&
            (input.getAttribute("value") || "").trim().length > 0
        )

        // 3. data-* attributes on the form element or its immediate wrapper that signal configuration
        const checkDataAttrs = (el: Element): boolean => {
            for (const attr of Array.from(el.attributes)) {
                if (attr.name.startsWith("data-") && destinationAttrPattern.test(attr.name.replace(/^data-/, "")) && attr.value.trim().length > 0) {
                    return true
                }
            }
            return false
        }
        const hasDataAttr = checkDataAttrs(form) || (form.parentElement ? checkDataAttrs(form.parentElement) : false)

        const hasConfiguredDestination = hasActionUrl || hasDestinationHiddenInput || hasDataAttr

        return { selector, action, method, fieldTokens, submitTokens, framerName, hasConfiguredDestination }
    })
}

function hasFormDestinationInBags(bags: ReadonlyArray<Record<string, unknown>>): boolean {
    const directKeys = ["sendTo", "action", "webhook", "destination", "email", "recipients", "sheet", "sheetId"]
    for (const bag of bags) {
        for (const key of directKeys) {
            const value = bag[key]
            if (typeof value === "string" && value.trim().length > 0) return true
            if (value && typeof value === "object") return true
        }
    }
    return false
}

async function buildFramerFormCandidates(nodes: AllNodes): Promise<ReadonlyArray<FramerFormCandidate>> {
    const candidates: Array<FramerFormCandidate> = []
    const candidateIds = new Set<string>()
    // When we find a button node, we queue its parent to be promoted as the form root instead.
    const buttonParentIds = new Set<string>()

    const allNodesToCheck = [
        ...(nodes.frameNodes as ReadonlyArray<AnyNode>),
        ...(nodes.componentNodes as ReadonlyArray<AnyNode>),
    ]

    for (const node of allNodesToCheck) {
        if (nodes.nodesInNonPrimaryVariants.has(node.id)) continue
        if (nodes.nodesInNonFirstBreakpoints.has(node.id)) continue

        const bags = [
            node as Record<string, unknown>,
            (node.controls as Record<string, unknown> | undefined) ?? {},
            (node.typedControls as Record<string, unknown> | undefined) ?? {},
        ]

        const metadataTokens = new Set<string>()
        const fieldTokens = new Set<string>()
        const submitTokens = new Set<string>()

        const nodeName = String((node as Record<string, unknown>).name ?? "")
        for (const token of tokenizeText(nodeName)) metadataTokens.add(token)

        const componentName = String((node as Record<string, unknown>).componentName ?? "").toLowerCase()
        for (const token of tokenizeText(componentName)) metadataTokens.add(token)

        const htmlTag = String((node as Record<string, unknown>).__htmlTag ?? "").toLowerCase()
        if (htmlTag.length > 0) metadataTokens.add(htmlTag)

        for (const bag of bags) {
            for (const [key, value] of Object.entries(bag)) {
                for (const token of tokenizeText(key)) metadataTokens.add(token)
                if (typeof value === "string") {
                    for (const token of tokenizeText(value)) {
                        metadataTokens.add(token)
                        if (/input|field|textarea|select|email|name|message|phone/.test(token)) fieldTokens.add(token)
                        if (/submit|send|continue|next|book|contact/.test(token)) submitTokens.add(token)
                    }
                }
            }
        }

        try {
            const html = await getNodeHTML(node)
            if (html.length > 0) {
                for (const token of tokenizeText(html)) {
                    if (/input|field|textarea|select|email|name|message|phone/.test(token)) fieldTokens.add(token)
                    if (/submit|send|continue|next|book|contact/.test(token)) submitTokens.add(token)
                }
            }
        } catch {
            // ignore html extraction errors for nodes that do not support it
        }

        const isFormLike =
            metadataTokens.has("form") ||
            htmlTag === "form" ||
            hasFormDestinationInBags(bags) ||
            (fieldTokens.size >= 2 && submitTokens.size >= 1)

        if (!isFormLike) continue

        // If the detected node is a button (carries sendTo but is not the form root),
        // walk up to its parent and promote that as the candidate instead.
        const isButton = htmlTag === "button" || componentName.includes("button")
        if (isButton) {
            try {
                const parent = await framer.getParent(node.id)
                if (parent) buttonParentIds.add(parent.id)
            } catch {
                // ignore
            }
            continue
        }

        candidates.push({ node, metadataTokens, fieldTokens, submitTokens })
        candidateIds.add(node.id)
    }

    // Promote button parents that weren't already found as form candidates.
    for (const parentId of buttonParentIds) {
        if (candidateIds.has(parentId)) continue
        try {
            const parentNode = await framer.getNode(parentId)
            if (parentNode) {
                candidates.push({
                    node: parentNode as AnyNode,
                    metadataTokens: new Set(["form"]),
                    fieldTokens: new Set(),
                    submitTokens: new Set(),
                })
                candidateIds.add(parentId)
            }
        } catch {
            // ignore
        }
    }

    return candidates
}

function resolvePublishedFormsToFramerNodes(
    publishedForms: ReadonlyArray<PublishedFormTarget>,
    candidates: ReadonlyArray<FramerFormCandidate>,
): ReadonlyArray<PublishedToFramerMatch> {
    const usedNodeIds = new Set<string>()
    const matches: Array<PublishedToFramerMatch> = []

    for (const publishedForm of publishedForms) {
        // Primary: exact match on data-framer-name → node.name (case-insensitive).
        // This is the most reliable mapping because Framer injects the layer name
        // directly into the published HTML as data-framer-name.
        if (publishedForm.framerName.length > 0) {
            const normalizedFramerName = publishedForm.framerName.toLowerCase().trim()
            const exactMatch = candidates.find(
                (c) => !usedNodeIds.has(c.node.id) &&
                    getNodeName(c.node).toLowerCase().trim() === normalizedFramerName
            )
            if (exactMatch) {
                usedNodeIds.add(exactMatch.node.id)
                matches.push({ target: publishedForm, node: exactMatch.node, score: 1.0 })
                continue
            }
        }

        // Fallback: token overlap scoring (for forms without data-framer-name).
        const publishedTokens = unionTokens(
            publishedForm.fieldTokens,
            publishedForm.submitTokens,
            new Set(tokenizeText(`${publishedForm.action} ${publishedForm.method}`)),
        )

        let bestNode: AnyNode | null = null
        let bestScore = 0
        for (const candidate of candidates) {
            if (usedNodeIds.has(candidate.node.id)) continue

            const candidateTokens = unionTokens(candidate.metadataTokens, candidate.fieldTokens, candidate.submitTokens)
            const fieldMatch = overlapScore(publishedForm.fieldTokens, candidate.fieldTokens)
            const submitMatch = overlapScore(publishedForm.submitTokens, candidate.submitTokens)
            const overallMatch = overlapScore(publishedTokens, candidateTokens)
            const tagBoost = candidate.metadataTokens.has("form") ? 0.2 : 0
            const score = (fieldMatch * 0.45) + (submitMatch * 0.35) + (overallMatch * 0.2) + tagBoost

            if (score > bestScore) {
                bestScore = score
                bestNode = candidate.node
            }
        }

        if (bestNode && bestScore >= 0.2) {
            usedNodeIds.add(bestNode.id)
            matches.push({ target: publishedForm, node: bestNode, score: bestScore })
        } else {
            matches.push({ target: publishedForm, node: null, score: bestScore })
        }
    }

    return matches
}

function getFrameBackgroundImage(frame: FrameNode): ImageAsset | null {
    return (frame.backgroundImage as ImageAsset | null) ?? null
}

function extractImageDimensionFromAssetRecord(asset: Record<string, unknown>): { width: number | null; height: number | null } {
    const widthCandidates = [asset.width, asset.pixelWidth, asset.naturalWidth, asset.originalWidth]
    const heightCandidates = [asset.height, asset.pixelHeight, asset.naturalHeight, asset.originalHeight]

    const toNumber = (value: unknown): number | null => {
        if (typeof value === "number" && Number.isFinite(value)) return value
        if (typeof value === "string") {
            const parsed = Number(value)
            if (Number.isFinite(parsed)) return parsed
        }
        return null
    }

    const width = widthCandidates.map((candidate) => toNumber(candidate)).find((candidate) => candidate !== null) ?? null
    const height = heightCandidates.map((candidate) => toNumber(candidate)).find((candidate) => candidate !== null) ?? null
    return { width, height }
}

async function getImageDimensionsFromUrl(url: string): Promise<{ width: number | null; height: number | null }> {
    return new Promise((resolve) => {
        const img = new Image()
        const timeoutId = window.setTimeout(() => {
            resolve({ width: null, height: null })
        }, 8000)

        img.onload = () => {
            window.clearTimeout(timeoutId)
            const width = Number.isFinite(img.naturalWidth) ? img.naturalWidth : null
            const height = Number.isFinite(img.naturalHeight) ? img.naturalHeight : null
            resolve({ width, height })
        }
        img.onerror = () => {
            window.clearTimeout(timeoutId)
            resolve({ width: null, height: null })
        }
        img.src = url
    })
}

function getMimeTypeFromUnknown(value: unknown): string | null {
    if (typeof value === "string" && value.trim().length > 0) return value.trim().toLowerCase()
    if (value !== null && typeof value === "object") {
        const record = value as Record<string, unknown>
        for (const key of ["mimeType", "type", "format", "contentType"]) {
            const candidate = record[key]
            if (typeof candidate === "string" && candidate.trim().length > 0) {
                return candidate.trim().toLowerCase()
            }
        }
    }
    return null
}

async function getAssetBytesFromUnknown(value: unknown): Promise<number | null> {
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string") {
        const parsed = Number(value)
        if (Number.isFinite(parsed)) return parsed
    }
    if (value === null || typeof value !== "object") return null

    const record = value as Record<string, unknown>
    for (const key of ["size", "bytes", "fileSize", "sizeBytes", "byteLength", "length"]) {
        const candidate = record[key]
        if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate
        if (typeof candidate === "string") {
            const parsed = Number(candidate)
            if (Number.isFinite(parsed)) return parsed
        }
    }

    const bytesValue = record.bytes
    if (bytesValue instanceof Uint8Array) return bytesValue.byteLength

    const getData = record.getData
    if (typeof getData === "function") {
        try {
            const data = await (getData as () => Promise<Record<string, unknown>> )()
            if (data && data.bytes instanceof Uint8Array) return data.bytes.byteLength
        } catch {
            // Ignore unavailable data payload.
        }
    }

    return null
}

function normalizeNonEmptyText(value: unknown): string | null {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null
}

function extractImageAssetId(value: unknown): string | null {
    const seen = new WeakSet<object>()

    const visit = (candidate: unknown, depth: number): string | null => {
        if (!isRecord(candidate) || depth > 7) return null
        const objectCandidate = candidate as object
        if (seen.has(objectCandidate)) return null
        seen.add(objectCandidate)

        const directId = candidate.id
        if (typeof directId === "string" && directId.trim().length > 0) return directId

        const nestedPriorityKeys = ["defaultValue", "value", "image", "asset"]
        for (const key of nestedPriorityKeys) {
            const nested = candidate[key]
            const nestedId = visit(nested, depth + 1)
            if (nestedId) return nestedId
        }

        if (Array.isArray(candidate)) {
            for (const entry of candidate) {
                const nestedId = visit(entry, depth + 1)
                if (nestedId) return nestedId
            }
            return null
        }

        for (const nested of Object.values(candidate)) {
            const nestedId = visit(nested, depth + 1)
            if (nestedId) return nestedId
        }

        return null
    }

    return visit(value, 0)
}

function extractImageAltText(value: unknown): string | null {
    const seen = new WeakSet<object>()

    const visit = (candidate: unknown, depth: number): string | null => {
        if (!isRecord(candidate) || depth > 7) return null
        const objectCandidate = candidate as object
        if (seen.has(objectCandidate)) return null
        seen.add(objectCandidate)

        const directAltText = normalizeNonEmptyText(candidate.altText)
        if (directAltText) return directAltText

        const directAlt = normalizeNonEmptyText(candidate.alt)
        if (directAlt) return directAlt

        const nestedPriorityKeys = ["defaultValue", "value", "image", "asset"]
        for (const key of nestedPriorityKeys) {
            const nestedAlt = visit(candidate[key], depth + 1)
            if (nestedAlt) return nestedAlt
        }

        if (Array.isArray(candidate)) {
            for (const entry of candidate) {
                const nestedAlt = visit(entry, depth + 1)
                if (nestedAlt) return nestedAlt
            }
            return null
        }

        for (const nested of Object.values(candidate)) {
            const nestedAlt = visit(nested, depth + 1)
            if (nestedAlt) return nestedAlt
        }

        return null
    }

    return visit(value, 0)
}

function collectImageAltTextByAssetIdFromValues(values: ReadonlyArray<unknown>): ReadonlyMap<string, string> {
    const found = new Map<string, string>()
    const seen = new WeakSet<object>()

    const writeIfPresent = (candidate: Record<string, unknown>): void => {
        const directId = typeof candidate.id === "string" && candidate.id.trim().length > 0
            ? candidate.id
            : null
        if (!directId) return

        const directAlt = normalizeNonEmptyText(candidate.altText) ?? normalizeNonEmptyText(candidate.alt)
        if (!directAlt) return
        if (!found.has(directId)) found.set(directId, directAlt)
    }

    const visit = (candidate: unknown, depth: number): void => {
        if (!isRecord(candidate)) return
        if (depth > 8) return
        const objectCandidate = candidate as object
        if (seen.has(objectCandidate)) return
        seen.add(objectCandidate)

        writeIfPresent(candidate)

        const nestedPriorityKeys = ["defaultValue", "value", "image", "asset"]
        for (const key of nestedPriorityKeys) {
            visit(candidate[key], depth + 1)
        }

        if (Array.isArray(candidate)) {
            for (const entry of candidate) visit(entry, depth + 1)
            return
        }

        for (const nested of Object.values(candidate)) {
            visit(nested, depth + 1)
        }
    }

    for (const value of values) visit(value, 0)
    return found
}

type PageImageCandidate = {
    readonly key: string
    readonly assetId: string | null
    readonly altText: string | null
    readonly previewUrl: string | null
    readonly source: unknown
}

function collectImageCandidatesFromValue(value: unknown): ReadonlyArray<PageImageCandidate> {
    const candidates: PageImageCandidate[] = []
    const seen = new WeakSet<object>()

    const visit = (candidate: unknown, path: string, depth: number): void => {
        if (!isRecord(candidate) || depth > 8) return
        const objectCandidate = candidate as object
        if (seen.has(objectCandidate)) return
        seen.add(objectCandidate)

        const assetId = extractImageAssetId(candidate)
        const altText = extractImageAltText(candidate)
        const previewUrl = normalizeNonEmptyText(candidate.thumbnailUrl) ?? normalizeNonEmptyText(candidate.url)
        const hasAssetMethods = typeof candidate.getData === "function" || typeof candidate.cloneWithAttributes === "function"
        const looksLikeImageAsset = (assetId !== null) && (
            hasAssetMethods
            || normalizeNonEmptyText(candidate.mimeType) !== null
            || normalizeNonEmptyText(candidate.url) !== null
            || normalizeNonEmptyText(candidate.thumbnailUrl) !== null
        )
        const objectType = typeof candidate.type === "string" ? candidate.type.toLowerCase() : ""
        const looksLikeImageControl = objectType === "image"

        if (looksLikeImageAsset || looksLikeImageControl) {
            const key = assetId ?? path
            candidates.push({ key, assetId, altText, previewUrl, source: candidate })
        }

        const nestedPriorityKeys = ["defaultValue", "value", "image", "asset", "controls", "typedControls", "props", "properties", "componentProperties"]
        for (const key of nestedPriorityKeys) {
            const nested = candidate[key]
            const nextPath = path.length > 0 ? `${path}.${key}` : key
            visit(nested, nextPath, depth + 1)
        }

        if (Array.isArray(candidate)) {
            for (let index = 0; index < candidate.length; index++) {
                visit(candidate[index], `${path}[${index}]`, depth + 1)
            }
            return
        }

        for (const [nestedKey, nested] of Object.entries(candidate)) {
            const nextPath = path.length > 0 ? `${path}.${nestedKey}` : nestedKey
            visit(nested, nextPath, depth + 1)
        }
    }

    visit(value, "root", 0)
    return candidates
}

// ---------------------------------------------------------------------------
// Breakpoint helpers
// ---------------------------------------------------------------------------

// Breakpoint frames are identified and filtered in fetchAllNodes()
// Only nodes from the first breakpoint frame are analyzed

// ---------------------------------------------------------------------------
// Fetch all nodes in one batch
// ---------------------------------------------------------------------------

async function fetchAllNodes(): Promise<AllNodes> {
    const [frameNodesRaw, textNodesRaw, componentInstanceNodesRaw, componentDefinitionNodesRaw, svgNodesRaw, pagesRaw, designPagesRaw, codeFilesRaw, collectionsData] = await Promise.all([
        framer.getNodesWithType("FrameNode").catch(() => []),
        framer.getNodesWithType("TextNode").catch(() => []),
        framer.getNodesWithType("ComponentInstanceNode").catch(() => []),
        framer.getNodesWithType("ComponentNode").catch(() => [] as ComponentNode[]),
        framer.getNodesWithType("SVGNode").catch(() => []),
        framer.getNodesWithType("WebPageNode").catch(() => []),
        framer.getNodesWithType("DesignPageNode").catch(() => []),
        framer.getCodeFiles().catch(() => []),
        Promise.all([
            framer.getCollections().catch(() => []),
            framer.getActiveCollection().catch(() => null),
        ]),
    ])

    const [collections, activeCollection] = collectionsData
    const mergedCollections = new Map<string, Collection>()
    for (const collection of collections) {
        mergedCollections.set(collection.id, collection)
    }
    if (activeCollection) {
        mergedCollections.set(activeCollection.id, activeCollection)
    }
    const collectionsRaw = Array.from(mergedCollections.values())

    // componentNodeIdentifierMap: componentDefinitionId → componentIdentifier (stable type key)
    const componentNodeIdentifierMap = new Map<string, string>()
    for (const node of componentDefinitionNodesRaw) {
        componentNodeIdentifierMap.set(node.id, node.componentIdentifier)
    }

    // SVG node IDs — text nodes inside SVGs (icon labels etc.) are excluded from text checks
    const svgNodeIds = new Set(svgNodesRaw.map((n) => n.id))

    // Asset frames = frames that carry a background image
    const assetFrameIds = new Set<string>()
    for (const frame of frameNodesRaw as FrameNode[]) {
        if (getFrameBackgroundImage(frame) !== null) assetFrameIds.add(frame.id)
    }

    // Detect breakpoint frames (direct children of pages) and collect frame parent IDs in one pass.
    // Also detect variant frames — frames whose direct parent is a ComponentNode (component definition).
    const pageIds = new Set([
        ...(pagesRaw as ReadonlyArray<AnyNode>).map((p) => p.id),
        ...(designPagesRaw as ReadonlyArray<AnyNode>).map((p) => p.id),
    ])
    const breakpointFrameIds = new Set<string>()
    const breakpointFramesByPageId = new Map<string, string[]>() // pageId → [frame IDs in order]
    const frameParentIdMap = new Map<string, string>() // frameId → parentId
    const directVariantFrameIdsByComponent = new Map<string, string[]>() // componentIdentifier → direct variant frame IDs in order
    // variantFrameComponentIdMap: frameId → componentIdentifier of the owning ComponentNode.
    // A "variant frame" is a FrameNode whose direct parent is a ComponentNode.
    // All descendant frames inherit the same componentIdentifier via propagation below.
    const variantFrameComponentIdMap = new Map<string, string>()

    await Promise.all(
        (frameNodesRaw as FrameNode[]).map(async (frame) => {
            try {
                const parent = await frame.getParent()
                if (parent) {
                    frameParentIdMap.set(frame.id, parent.id)
                    if (pageIds.has(parent.id)) {
                        breakpointFrameIds.add(frame.id)
                        const pageId = parent.id
                        if (!breakpointFramesByPageId.has(pageId)) {
                            breakpointFramesByPageId.set(pageId, [])
                        }
                        breakpointFramesByPageId.get(pageId)!.push(frame.id)
                    }
                    // Variant frame = direct child of a ComponentNode definition
                    const compIdentifier = componentNodeIdentifierMap.get(parent.id)
                    if (compIdentifier !== undefined) {
                        variantFrameComponentIdMap.set(frame.id, compIdentifier)
                        if (!directVariantFrameIdsByComponent.has(compIdentifier)) {
                            directVariantFrameIdsByComponent.set(compIdentifier, [])
                        }
                        directVariantFrameIdsByComponent.get(compIdentifier)!.push(frame.id)
                    }
                }
            } catch {
                // skip
            }
        }),
    )


    // Build a set of node IDs that are descendants of non-first breakpoint frames
    // We'll exclude these nodes from analysis
    const nodesInNonFirstBreakpoints = new Set<string>()
    
    // Helper to recursively collect all descendant node IDs
    async function collectDescendants(nodeId: string, nodeMap: Map<string, AnyNode>, target: Set<string>): Promise<void> {
        const node = nodeMap.get(nodeId)
        if (!node) return
        
        try {
            const children = await (node as any).getChildren?.()
            if (children && Array.isArray(children)) {
                for (const child of children) {
                    const childId = (child as any).id
                    if (childId) {
                        target.add(childId)
                        await collectDescendants(childId, nodeMap, target)
                    }
                }
            }
        } catch {
            // skip
        }
    }
    
    // Build a map for quick node lookup
    const allNodesMap = new Map<string, AnyNode>()
    for (const frame of frameNodesRaw as FrameNode[]) {
        allNodesMap.set(frame.id, frame as AnyNode)
    }
    for (const textNode of textNodesRaw as AnyNode[]) {
        allNodesMap.set(textNode.id, textNode)
    }
    for (const componentNode of componentInstanceNodesRaw as AnyNode[]) {
        allNodesMap.set(componentNode.id, componentNode)
    }
    
    // Identify the primary breakpoint frame per page.
    // For template pages (breakpoints named "Desktop", "Tablet", "Mobile"), prefer "Desktop".
    // For regular pages, use the first by order.
    function getPrimaryBreakpointFrameId(frameIds: ReadonlyArray<string>): string | null {
        if (frameIds.length === 0) return null
        const desktopId = frameIds.find((id) => {
            const frame = allNodesMap.get(id)
            return frame && (frame as AnyNode & { name?: string }).name === "Desktop"
        })
        return desktopId ?? frameIds[0]
    }

    let firstBreakpointFrameId: string | null = null
    for (const [, frameIds] of breakpointFramesByPageId) {
        const primary = getPrimaryBreakpointFrameId(frameIds)
        if (primary) {
            firstBreakpointFrameId = primary
            break
        }
    }

    // Collect all descendants of non-primary breakpoint frames (parent-traversal path).
    for (const [, frameIds] of breakpointFramesByPageId) {
        const primaryId = getPrimaryBreakpointFrameId(frameIds)
        for (const frameId of frameIds) {
            if (frameId !== primaryId) {
                nodesInNonFirstBreakpoints.add(frameId)
                await collectDescendants(frameId, allNodesMap, nodesInNonFirstBreakpoints)
            }
        }
    }

    // Fallback for template files: use isBreakpoint / isPrimaryBreakpoint flags directly.
    // Template breakpoints (Desktop/Tablet/Mobile) may not have a page as their direct parent,
    // so the parent-traversal above may miss them. We group them by parent ID and exclude
    // all non-Desktop ones. A frame with name "Desktop" is always the primary; if no "Desktop"
    // exists in the group, the one with isPrimaryBreakpoint: true is kept.
    const breakpointFramesByParent = new Map<string, Array<FrameNode & { name?: string; isBreakpoint?: boolean; isPrimaryBreakpoint?: boolean }>>()
    for (const frame of frameNodesRaw as FrameNode[]) {
        const f = frame as FrameNode & { isBreakpoint?: boolean }
        if (!f.isBreakpoint) continue
        if (nodesInNonFirstBreakpoints.has(frame.id)) continue // already handled
        const parentId = frameParentIdMap.get(frame.id) ?? "__root__"
        if (!breakpointFramesByParent.has(parentId)) breakpointFramesByParent.set(parentId, [])
        breakpointFramesByParent.get(parentId)!.push(frame as FrameNode & { name?: string; isPrimaryBreakpoint?: boolean })
    }
    for (const [, frames] of breakpointFramesByParent) {
        if (frames.length <= 1) continue
        const desktopFrame = frames.find((f) => f.name === "Desktop")
        const primaryFrame = desktopFrame ?? frames.find((f) => f.isPrimaryBreakpoint) ?? frames[0]
        for (const frame of frames) {
            if (frame.id !== primaryFrame.id) {
                nodesInNonFirstBreakpoints.add(frame.id)
                await collectDescendants(frame.id, allNodesMap, nodesInNonFirstBreakpoints)
            }
        }
    }

    // Content frames = non-asset frames whose direct parent is also not an asset frame
    const contentFrameNodes = (frameNodesRaw as FrameNode[]).filter((frame) => {
        if (nodesInNonFirstBreakpoints.has(frame.id)) return false // Exclude smaller breakpoint elements entirely
        if (assetFrameIds.has(frame.id)) return false
        const parentId = frameParentIdMap.get(frame.id)
        if (parentId && assetFrameIds.has(parentId)) return false
        return true
    })

    // Reachable asset frames = asset frames whose direct parent is NOT another asset frame
    // These are the "first-level" images accessible from content — avoid scanning deeply nested image-in-image
    const reachableAssetFrames = (frameNodesRaw as FrameNode[]).filter((frame) => {
        if (nodesInNonFirstBreakpoints.has(frame.id)) return false // Exclude smaller breakpoint elements entirely
        if (!assetFrameIds.has(frame.id)) return false
        const parentId = frameParentIdMap.get(frame.id)
        return !parentId || !assetFrameIds.has(parentId)
    })

    // Propagate variantFrameComponentIdMap to all descendant frames inside component definitions.
    // A frame is "in a component definition" if its parent is already in the map.
    let propagating = true
    while (propagating) {
        propagating = false
        for (const [frameId, parentId] of frameParentIdMap) {
            if (!variantFrameComponentIdMap.has(frameId) && variantFrameComponentIdMap.has(parentId)) {
                variantFrameComponentIdMap.set(frameId, variantFrameComponentIdMap.get(parentId)!)
                propagating = true
            }
        }
    }

    // Build a set of node IDs that are descendants of non-primary variant frames
    // We'll exclude these nodes from analysis (similar to non-first breakpoint handling)
    const nodesInNonPrimaryVariants = new Set<string>()
    
    // Collect all descendants of non-primary variant frames
    for (const [, frameIds] of directVariantFrameIdsByComponent) {
        // Skip the primary variant (first one), mark all others as non-primary
        for (let i = 1; i < frameIds.length; i++) {
            const nonPrimaryFrameId = frameIds[i]
            nodesInNonPrimaryVariants.add(nonPrimaryFrameId) // Add the variant frame itself
            await collectDescendants(nonPrimaryFrameId, allNodesMap, nodesInNonPrimaryVariants)
        }
    }

    // Build a set of node IDs inside ANY variant frame (primary + non-primary) = all component definitions
    const nodesInAnyVariant = new Set<string>()
    for (const [, frameIds] of directVariantFrameIdsByComponent) {
        for (const frameId of frameIds) {
            nodesInAnyVariant.add(frameId)
            await collectDescendants(frameId, allNodesMap, nodesInAnyVariant)
        }
    }

    // Content text nodes = text nodes whose direct parent is NOT an asset frame
    // and NOT a frame inside a component definition.
    // Also compute a source key for component-aware repetition deduplication:
    //   - "free:{nodeId}" for plain page text
    //   - "component:{componentIdentifier}" for text inside a ComponentNode definition
    // Text inside component definitions is keyed by the component's stable identifier,
    // so all variants of the same component share ONE source key and don't trigger repetition.
    const textParentChecks = await Promise.all(
        (textNodesRaw as AnyNode[]).map(async (node) => {
            try {
                const parent = await node.getParent()
                if (parent === null) return { node, excluded: nodesInNonFirstBreakpoints.has(node.id), sourceKey: `free:${node.id}`, isInSvg: false }

                const isInAsset = assetFrameIds.has(parent.id)
                // Parent is a ComponentNode directly (text is direct child of component definition)
                const isDirectChildOfComponentDef = componentNodeIdentifierMap.has(parent.id)
                // Parent is a frame that lives inside a component definition (any depth)
                const isInComponentDefFrame = variantFrameComponentIdMap.has(parent.id)

                const isInSvg = svgNodeIds.has(parent.id)
                const excluded = isInAsset || isDirectChildOfComponentDef || isInComponentDefFrame || isInSvg || nodesInNonFirstBreakpoints.has(node.id)

                let sourceKey: string
                if (isDirectChildOfComponentDef) {
                    sourceKey = `component:${componentNodeIdentifierMap.get(parent.id)!}`
                } else if (isInComponentDefFrame) {
                    sourceKey = `component:${variantFrameComponentIdMap.get(parent.id)!}`
                } else {
                    sourceKey = `free:${node.id}`
                }

                return { node, excluded, sourceKey, isInSvg }
            } catch {
                return { node, excluded: nodesInNonFirstBreakpoints.has(node.id), sourceKey: `free:${node.id}`, isInSvg: false }
            }
        })
    )
    const contentTextNodes = textParentChecks
        .filter((r) => !r.excluded)
        .map((r) => r.node)

    const textNodeSourceKeyMap = new Map<string, string>()
    const textNodesInSvg = new Set<string>()
    for (const r of textParentChecks) {
        textNodeSourceKeyMap.set(r.node.id, r.sourceKey)
        if (r.isInSvg) textNodesInSvg.add(r.node.id)
    }

    return {
        frameNodes: frameNodesRaw as ReadonlyArray<FrameNode>,
        assetFrameIds,
        contentFrameNodes,
        reachableAssetFrames,
        textNodes: textNodesRaw as ReadonlyArray<AnyNode>,
        contentTextNodes,
        textNodeSourceKeyMap,
        svgNodeIds,
        svgNodes: svgNodesRaw as ReadonlyArray<AnyNode>,
        textNodesInSvg,
        componentNodes: componentInstanceNodesRaw as ReadonlyArray<AnyNode>,
        pages: pagesRaw as ReadonlyArray<AnyNode>,
        designFilePageIds: new Set(
            (designPagesRaw as ReadonlyArray<AnyNode>)
                .filter((p) => typeof p.name === "string" && p.name.trim().toLowerCase() === "design")
                .map((p) => p.id),
        ),
        codeFiles: codeFilesRaw as ReadonlyArray<CodeFile>,
        collections: collectionsRaw as ReadonlyArray<Collection>,
        breakpointFrameIds,
        firstBreakpointFrameId,
        nodesInNonFirstBreakpoints,
        breakpointFramesByPageId: breakpointFramesByPageId as ReadonlyMap<string, ReadonlyArray<string>>,
        componentDefinitionNodes: componentDefinitionNodesRaw as unknown as ReadonlyArray<AnyNode>,
        frameParentIdMap,
        variantFrameComponentIdMap,
        nodesInNonPrimaryVariants,
        nodesInAnyVariant,
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

function getPageDisplayLabel(page: AnyNode): string | null {
    const pageName = typeof page.name === "string" ? page.name.trim() : ""
    const pageId = typeof page.id === "string" ? page.id.trim() : ""
    const looksLikeNodeId = /^(?:\d+[:\-]\d+|[0-9a-f]{8,}(?:-[0-9a-f]{4,}){3,})$/i
    if (pageName.length > 0 && pageName !== pageId && !looksLikeNodeId.test(pageName)) return pageName

    const pageRecord = page as Record<string, unknown>
    const pagePath = typeof pageRecord.path === "string"
        ? pageRecord.path.trim()
        : ""
    if (pagePath.length === 0) return null
    if (pagePath === "/") return "Home"

    const lastSegment = pagePath.split("/").filter(Boolean).pop() ?? pagePath
    const words = lastSegment.replace(/[-_]+/g, " ").trim()
    if (words.length === 0) return "Untitled page"
    return words.replace(/\b\w/g, (character: string) => character.toUpperCase())
}

function getFramePageLabel(nodes: AllNodes, nodeId: string): string | null {
    const pageNameById = new Map<string, string>()
    const pageIds = new Set<string>()

    for (const page of nodes.pages) {
        pageIds.add(page.id)
        const pageLabel = getPageDisplayLabel(page as AnyNode)
        if (pageLabel) pageNameById.set(page.id, pageLabel)
    }

    const visited = new Set<string>()
    let currentId: string | undefined = nodeId

    while (currentId !== undefined) {
        if (visited.has(currentId)) break
        visited.add(currentId)

        const parentId = nodes.frameParentIdMap.get(currentId)
        if (!parentId) break
        if (pageIds.has(parentId)) {
            return pageNameById.get(parentId) ?? null
        }
        currentId = parentId
    }

    return null
}

function withFramePageLabel(nodes: AllNodes, item: CheckItem, nodeId: string): CheckItem {
    const pageLabel = getFramePageLabel(nodes, nodeId)
    if (!pageLabel) return item
    return { ...item, pageLabel }
}

type PublishedPageTagAudit = {
    readonly page: AnyNode
    readonly pageName: string
    readonly pageUrl: string
    readonly frameNodeId: string
    readonly tagInfo: PublishedTagInfo | null
    readonly error: string | null
}

async function getPublishedTagAuditsByPage(nodes: AllNodes): Promise<ReadonlyArray<PublishedPageTagAudit>> {
    if (nodes.pages.length === 0) return []

    let publishInfo: PublishInfo | null = null
    try {
        publishInfo = await framer.getPublishInfo()
    } catch {
        publishInfo = null
    }

    const basePublishedUrl = getPublishedUrlFromInfo(publishInfo)

    const tagInfoByUrl = new Map<string, PublishedTagInfo>()
    const errorByUrl = new Map<string, string>()
    const audits: Array<PublishedPageTagAudit> = []

    for (const page of nodes.pages as ReadonlyArray<AnyNode>) {
        const pageName = getPageDisplayLabel(page) ?? "Untitled page"
        const frameNodeId = nodes.breakpointFramesByPageId.get(page.id)?.[0] ?? null
        if (frameNodeId === null) continue

        const pageUrl = basePublishedUrl ? (buildPublishedPageUrl(basePublishedUrl, page) ?? "") : ""
        let tagInfo: PublishedTagInfo | null = null
        let error: string | null = null

        const canvasHtml = await getCanvasHtmlForFrame(frameNodeId)
        if (canvasHtml && canvasHtml.trim().length > 0) {
            tagInfo = extractPublishedTagInfo(canvasHtml)
        }

        if (tagInfo === null && pageUrl.length > 0) {
            if (!tagInfoByUrl.has(pageUrl) && !errorByUrl.has(pageUrl)) {
                try {
                    const resolved = await fetchPublishedTagInfo(pageUrl)
                    tagInfoByUrl.set(pageUrl, resolved)
                } catch (fetchError) {
                    const message = fetchError instanceof Error ? fetchError.message : String(fetchError)
                    errorByUrl.set(pageUrl, message)
                }
            }
            tagInfo = tagInfoByUrl.get(pageUrl) ?? null
            error = errorByUrl.get(pageUrl) ?? null
        }

        audits.push({
            page,
            pageName,
            pageUrl,
            frameNodeId,
            tagInfo,
            error,
        })
    }

    return audits
}

async function getCmsItemNodeIds(nodes: AllNodes): Promise<ReadonlySet<string>> {
    const ids = new Set<string>()

    for (const collection of nodes.collections) {
        let items: ReadonlyArray<CollectionItem> = []
        try {
            items = await collection.getItems()
        } catch {
            continue
        }

        for (const item of items) {
            if (typeof item.nodeId === "string" && item.nodeId.trim().length > 0) {
                ids.add(item.nodeId)
            }
        }
    }

    return ids
}

function isPrimaryScopedNode(nodes: AllNodes, nodeId: string): boolean {
    return !nodes.nodesInNonFirstBreakpoints.has(nodeId)
        && !nodes.nodesInNonPrimaryVariants.has(nodeId)
}
// ---------------------------------------------------------------------------
// ASSETS CHECKS (11)
// ---------------------------------------------------------------------------
async function checkAltText(nodes: AllNodes): Promise<CheckResult> {
    const id = "alt-text"
    const label = "Image Alt Text"
    const missing: Array<CheckItem> = []
    let imageCount = 0
    const seenNodeIds = new Set<string>()
    const cmsNodeIds = await getCmsItemNodeIds(nodes)

    const imageValueSources: unknown[] = [
        ...nodes.frameNodes.filter((frame) => !nodes.nodesInAnyVariant.has(frame.id)),
        ...nodes.componentNodes.filter((component) => !nodes.nodesInAnyVariant.has(component.id)),
    ]

    try {
        const framerAny = framer as unknown as {
            getVariables?: () => Promise<ReadonlyArray<unknown>>
        }
        if (typeof framerAny.getVariables === "function") {
            const globalVariables = await framerAny.getVariables().catch(() => [])
            imageValueSources.push(...globalVariables)
        }
    } catch {
        // Optional variables API unavailable; continue with node-based sources.
    }

    const imageAltByAssetId = collectImageAltTextByAssetIdFromValues(imageValueSources)

    for (const frame of nodes.frameNodes) {
        // Only check frames in the primary breakpoint and primary variant
        if (nodes.nodesInNonFirstBreakpoints.has(frame.id)) continue
        if (nodes.nodesInNonPrimaryVariants.has(frame.id)) continue
        if (nodes.nodesInAnyVariant.has(frame.id)) continue
        if (cmsNodeIds.has(frame.id)) continue
        const asset = getFrameBackgroundImage(frame)
        if (!asset) continue
        if (seenNodeIds.has(frame.id)) continue
        seenNodeIds.add(frame.id)

        imageCount++

        const directAlt = normalizeNonEmptyText(asset.altText)
        const mappedAlt = (() => {
            const assetId = extractImageAssetId(asset)
            return assetId ? imageAltByAssetId.get(assetId) ?? null : null
        })()
        const altText = directAlt ?? mappedAlt
        if (!altText || altText.trim().length === 0) {
            missing.push(withFramePageLabel(nodes, { label: getNodeName(frame as AnyNode), nodeId: frame.id, previewUrl: asset.thumbnailUrl ?? null }, frame.id))
        }
    }

    for (const componentNode of nodes.componentNodes) {
        const componentNodeId = componentNode.id
        if (nodes.nodesInNonFirstBreakpoints.has(componentNodeId)) continue
        if (nodes.nodesInNonPrimaryVariants.has(componentNodeId)) continue
        if (nodes.nodesInAnyVariant.has(componentNodeId)) continue
        if (cmsNodeIds.has(componentNodeId)) continue

        const componentImageCandidates = collectImageCandidatesFromValue(componentNode)
        const seenComponentImageKeys = new Set<string>()

        for (const candidate of componentImageCandidates) {
            const candidateKey = candidate.assetId ?? candidate.key
            if (seenComponentImageKeys.has(candidateKey)) continue
            seenComponentImageKeys.add(candidateKey)

            imageCount++

            const mappedAlt = candidate.assetId
                ? (imageAltByAssetId.get(candidate.assetId) ?? null)
                : null
            const altText = candidate.altText ?? mappedAlt

            if (!altText || altText.trim().length === 0) {
                missing.push(withFramePageLabel(
                    nodes,
                    {
                        label: getNodeName(componentNode),
                        nodeId: componentNodeId,
                        previewUrl: candidate.previewUrl,
                    },
                    componentNodeId,
                ))
            }
        }
    }

    // Some Framer projects may expose explicit ImageNode entries.
    // Include them so the alt-text check truly scans every image node in the project.
    try {
        const framerAny = framer as unknown as {
            getNodesWithType?: (type: string) => Promise<ReadonlyArray<Record<string, unknown>>>
        }
        const imageNodesRaw = typeof framerAny.getNodesWithType === "function"
            ? await framerAny.getNodesWithType("ImageNode").catch(() => [])
            : []

        for (const imageNode of imageNodesRaw) {
            const nodeId = typeof imageNode.id === "string" ? imageNode.id : null
            if (!nodeId || seenNodeIds.has(nodeId)) continue
            // Only check images in the primary breakpoint and primary variant
            if (nodes.nodesInNonFirstBreakpoints.has(nodeId)) continue
            if (nodes.nodesInNonPrimaryVariants.has(nodeId)) continue
            if (nodes.nodesInAnyVariant.has(nodeId)) continue
            if (cmsNodeIds.has(nodeId)) continue
            seenNodeIds.add(nodeId)

            imageCount++

            const directAlt = normalizeNonEmptyText(imageNode.altText)
            const imageObj = (imageNode.image ?? null) as Record<string, unknown> | null
            const nestedAlt = normalizeNonEmptyText(imageObj?.altText)
            const imageAssetId = extractImageAssetId(imageObj ?? imageNode)
            const mappedAlt = imageAssetId ? imageAltByAssetId.get(imageAssetId) ?? null : null
            const altText = directAlt ?? nestedAlt ?? mappedAlt

            if (!altText || altText.trim().length === 0) {
                const previewUrl = typeof imageNode.thumbnailUrl === "string"
                    ? imageNode.thumbnailUrl
                    : (typeof imageObj?.thumbnailUrl === "string" ? imageObj.thumbnailUrl : null)
                missing.push({ label: getNodeName(imageNode as unknown as AnyNode), nodeId, previewUrl })
            }
        }
    } catch {
        // Ignore optional ImageNode API failures and keep frame-based coverage.
    }

    if (imageCount === 0) {
        return makeCheck(id, label, "pass", "No images found", [], true)
    }
    if (missing.length === 0) {
        return makeCheck(id, label, "pass", `All ${imageCount} images have alt text`, [], true)
    }
    return makeCheck(id, label, "warning", `${missing.length} of ${imageCount} images missing alt text`, missing, true)
}

async function checkLargeUncompressedAssets(nodes: AllNodes): Promise<CheckResult> {
    const id = "large-uncompressed-assets"
    const label = "Large Uncompressed Assets"

    const IMAGE_SIZE_LIMIT_BYTES = 1024 * 1024
    const VIDEO_SIZE_LIMIT_BYTES = 5 * 1024 * 1024
    const IMAGE_DIMENSION_LIMIT = 4096

    const flagged: Array<CheckItem> = []
    const seenKeys = new Set<string>()

    const addFlagged = (key: string, item: CheckItem): void => {
        if (seenKeys.has(key)) return
        seenKeys.add(key)
        flagged.push(item)
    }

    for (const frame of nodes.frameNodes) {
        const asset = getFrameBackgroundImage(frame)
        if (!asset) continue
        if (!isPrimaryScopedNode(nodes, frame.id)) continue

        const data = await asset.getData().catch(() => null)
        const mimeType = getMimeTypeFromUnknown(data?.mimeType ?? asset)
        const bytes = data?.bytes instanceof Uint8Array ? data.bytes.byteLength : null
        const isImage = mimeType !== null && mimeType.startsWith("image/")
        const isVideo = mimeType !== null && mimeType.startsWith("video/")
        const imageDimensions = asset.url ? await getImageDimensionsFromUrl(asset.url) : { width: null, height: null }

        if (isImage && bytes !== null && bytes > IMAGE_SIZE_LIMIT_BYTES) {
            addFlagged(
                `frame-image-size:${frame.id}`,
                {
                    label: `${getNodeName(frame as AnyNode)}: image > 1MB`,
                    nodeId: frame.id,
                    previewUrl: asset.thumbnailUrl ?? asset.url,
                },
            )
        }

        if (isVideo && bytes !== null && bytes > VIDEO_SIZE_LIMIT_BYTES) {
            addFlagged(
                `frame-video-size:${frame.id}`,
                {
                    label: `${getNodeName(frame as AnyNode)}: video > 5MB`,
                    nodeId: frame.id,
                    previewUrl: asset.thumbnailUrl ?? asset.url,
                },
            )
        }

        if (isImage) {
            const width = imageDimensions.width
            const height = imageDimensions.height
            if ((width !== null && width > IMAGE_DIMENSION_LIMIT) || (height !== null && height > IMAGE_DIMENSION_LIMIT)) {
                addFlagged(
                    `frame-image-dim:${frame.id}`,
                    {
                        label: `${getNodeName(frame as AnyNode)}: image > 4896px`,
                        nodeId: frame.id,
                        previewUrl: asset.thumbnailUrl ?? asset.url,
                    },
                )
            }
        }
    }

    for (const componentNode of nodes.componentNodes) {
        if (!isPrimaryScopedNode(nodes, componentNode.id)) continue
        const imageCandidates = collectImageCandidatesFromValue(componentNode)
        const seenCandidateKeys = new Set<string>()

        for (const candidate of imageCandidates) {
            if (seenCandidateKeys.has(candidate.key)) continue
            seenCandidateKeys.add(candidate.key)

            const bytes = await getAssetBytesFromUnknown(candidate.source)
            const mimeType = getMimeTypeFromUnknown(candidate.source)
            const assetUrl = candidate.previewUrl
            let dimensions = extractImageDimensionFromAssetRecord(candidate.source as Record<string, unknown>)
            if ((dimensions.width === null || dimensions.height === null) && assetUrl) {
                dimensions = await getImageDimensionsFromUrl(assetUrl)
            }

            if (mimeType !== null && mimeType.startsWith("image/") && bytes !== null && bytes > IMAGE_SIZE_LIMIT_BYTES) {
                addFlagged(
                    `component-image-size:${componentNode.id}:${candidate.key}`,
                    {
                        label: `${getNodeName(componentNode)}: image > 1MB`,
                        nodeId: componentNode.id,
                        previewUrl: assetUrl,
                    },
                )
            }

            if (mimeType !== null && mimeType.startsWith("video/") && bytes !== null && bytes > VIDEO_SIZE_LIMIT_BYTES) {
                addFlagged(
                    `component-video-size:${componentNode.id}:${candidate.key}`,
                    {
                        label: `${getNodeName(componentNode)}: video > 5MB`,
                        nodeId: componentNode.id,
                        previewUrl: assetUrl,
                    },
                )
            }

            if (mimeType !== null && mimeType.startsWith("image/")) {
                const width = dimensions.width
                const height = dimensions.height
                if ((width !== null && width > IMAGE_DIMENSION_LIMIT) || (height !== null && height > IMAGE_DIMENSION_LIMIT)) {
                    addFlagged(
                        `component-image-dim:${componentNode.id}:${candidate.key}`,
                        {
                            label: `${getNodeName(componentNode)}: image > 4896px`,
                            nodeId: componentNode.id,
                            previewUrl: assetUrl,
                        },
                    )
                }
            }
        }
    }

    try {
        const framerAny = framer as unknown as {
            getNodesWithType?: (type: string) => Promise<ReadonlyArray<Record<string, unknown>>>
        }
        const imageNodesRaw = typeof framerAny.getNodesWithType === "function"
            ? await framerAny.getNodesWithType("ImageNode").catch(() => [])
            : []

        for (const imageNode of imageNodesRaw) {
            const nodeId = typeof imageNode.id === "string" ? imageNode.id : null
            if (!nodeId) continue
            if (!isPrimaryScopedNode(nodes, nodeId)) continue

            const imageSource = (imageNode.image ?? imageNode) as Record<string, unknown>
            const bytes = await getAssetBytesFromUnknown(imageSource)
            const mimeType = getMimeTypeFromUnknown(imageSource)
            const assetUrl = typeof imageNode.thumbnailUrl === "string"
                ? imageNode.thumbnailUrl
                : (typeof imageSource.url === "string" ? imageSource.url : null)
            let dimensions = extractImageDimensionFromAssetRecord(imageSource)
            if ((dimensions.width === null || dimensions.height === null) && assetUrl) {
                dimensions = await getImageDimensionsFromUrl(assetUrl)
            }

            if (mimeType !== null && mimeType.startsWith("image/") && bytes !== null && bytes > IMAGE_SIZE_LIMIT_BYTES) {
                addFlagged(
                    `image-node-size:${nodeId}`,
                    {
                        label: `${getNodeName(imageNode as unknown as AnyNode)}: image > 1MB`,
                        nodeId,
                        previewUrl: assetUrl,
                    },
                )
            }

            if (mimeType !== null && mimeType.startsWith("video/") && bytes !== null && bytes > VIDEO_SIZE_LIMIT_BYTES) {
                addFlagged(
                    `image-node-video-size:${nodeId}`,
                    {
                        label: `${getNodeName(imageNode as unknown as AnyNode)}: video > 5MB`,
                        nodeId,
                        previewUrl: assetUrl,
                    },
                )
            }

            if (mimeType !== null && mimeType.startsWith("image/")) {
                const width = dimensions.width
                const height = dimensions.height
                if ((width !== null && width > IMAGE_DIMENSION_LIMIT) || (height !== null && height > IMAGE_DIMENSION_LIMIT)) {
                    addFlagged(
                        `image-node-dim:${nodeId}`,
                        {
                            label: `${getNodeName(imageNode as unknown as AnyNode)}: image > 4896px`,
                            nodeId,
                            previewUrl: assetUrl,
                        },
                    )
                }
            }
        }
    } catch {
        // Ignore optional ImageNode API failures and keep primary node coverage.
    }

    if (flagged.length === 0) {
        return makeCheck(id, label, "pass", "No oversized image/video assets found", [], true)
    }
    return makeCheck(id, label, "warning", `${flagged.length} oversized asset(s) found`, flagged, true)
}

async function checkRepetitiveText(nodes: AllNodes): Promise<CheckResult> {
    const id = "placeholder-text"
    const label = "Repetitive Text"

    // Collect all pages: WebPageNodes + non-"Design" DesignPageNodes
    const allPages: AnyNode[] = [...(nodes.pages as unknown as AnyNode[])]
    try {
        const designPagesRaw = await framer.getNodesWithType("DesignPageNode")
        for (const designPage of designPagesRaw as unknown as AnyNode[]) {
            const isDesignFile = typeof (designPage as any).name === "string" && (designPage as any).name.trim().toLowerCase() === "design"
            if (!isDesignFile) allPages.push(designPage)
        }
    } catch {
        // skip
    }

    const found: Array<CheckItem> = []

    // Check each page independently — repetition only counts within the same page
    for (const page of allPages) {
        let pageTextNodes: AnyNode[] = []
        try {
            const textNodes = await (page as any).getNodesWithType("TextNode")
            if (Array.isArray(textNodes)) pageTextNodes = textNodes as AnyNode[]
        } catch {
            continue
        }

        const textSourceMap = new Map<string, Map<string, { nodeId: string }>>()
        const seenNodeIds = new Set<string>()

        for (const node of pageTextNodes) {
            const nodeId = (node as any).id as string
            if (seenNodeIds.has(nodeId)) continue
            if (nodes.nodesInNonFirstBreakpoints.has(nodeId)) continue

            seenNodeIds.add(nodeId)
            const sourceKey = nodes.textNodeSourceKeyMap.get(nodeId) ?? `free:${nodeId}`

            const text = (await getNodeText(node)).trim()
            if (text.length === 0) continue

            const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length
            if (wordCount < 2 && text.length < 14) continue

            const normalized = text.toLowerCase()
            const sourceMap = textSourceMap.get(normalized) ?? new Map<string, { nodeId: string }>()
            if (!sourceMap.has(sourceKey)) {
                sourceMap.set(sourceKey, { nodeId })
            }
            textSourceMap.set(normalized, sourceMap)
        }

        for (const [text, sourcesMap] of textSourceMap) {
            if (sourcesMap.size > 1) {
                const preview = text.length > 35 ? text.slice(0, 35) + "…" : text
                for (const { nodeId } of sourcesMap.values()) {
                    found.push({ label: preview, nodeId })
                }
            }
        }
    }

    if (found.length === 0) {
        return makeCheck(id, label, "pass", "No repetitive text found", [], true)
    }
    return makeCheck(id, label, "warning", `${found.length} layers contain repetitive text — may be placeholder content`, found, true)
}

async function checkLoremIpsum(nodes: AllNodes): Promise<CheckResult> {
    const id = "lorem-ipsum"
    const label = "Lorem Ipsum Check"

    const loremPhrasePatterns = [
        /\blorem\s+ipsum\b/i,
        /\bdolor\s+sit\s+amet\b/i,
        /\bconsectetur\s+adipiscing\b/i,
        /\bsed\s+do\s+eiusmod\b/i,
        /\but\s+labore\s+et\s+dolore\b/i,
        /\bmagna\s+aliqua\b/i,
    ]

    const loremWordSet = new Set([
        "lorem", "ipsum", "dolor", "amet", "consectetur", "adipiscing", "elit", "eiusmod", "tempor",
        "incididunt", "labore", "dolore", "magna", "aliqua", "enim", "veniam", "quis", "nostrud",
        "exercitation", "ullamco", "laboris", "nisi", "aliquip", "commodo", "consequat", "duis",
        "aute", "irure", "reprehenderit", "voluptate", "velit", "esse", "cillum", "fugiat", "nulla",
        "pariatur", "excepteur", "sint", "occaecat", "cupidatat", "proident", "sunt", "culpa", "qui",
        "officia", "deserunt", "mollit", "anim", "laborum", "phasellus", "fermentum", "vehicula",
        "placerat", "curabitur", "fringilla", "vulputate", "bibendum", "tincidunt", "hendrerit",
        "pellentesque", "habitant", "tristique", "senectus", "netus", "malesuada", "egestas", "integer",
        "sagittis", "facilisi", "nibh", "mattis", "rhoncus", "porttitor", "ultricies", "convallis",
        "primis", "faucibus", "ornare", "elementum", "laoreet", "suspendisse", "pulvinar", "sollicitudin",
        "iaculis", "lobortis", "orci", "massa", "justo", "lectus", "viverra", "vitae", "accumsan",
        "erat", "dictum", "morbi", "maecenas", "tellus", "vulputat",
    ])

    const flagged: Array<CheckItem> = []
    const seenNodeIds = new Set<string>()

    const tokenize = (text: string): ReadonlyArray<string> => {
        return text
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .map((token) => token.trim())
            .filter((token) => token.length > 0)
    }

    for (const node of nodes.textNodes) {
        const nodeId = node.id
        if (!isPrimaryScopedNode(nodes, nodeId)) continue
        if (seenNodeIds.has(nodeId)) continue
        seenNodeIds.add(nodeId)

        const nodeText = (await getNodeText(node)).trim()
        if (nodeText.length === 0) continue

        const lowerCombined = nodeText.toLowerCase()
        const phraseMatch = loremPhrasePatterns.find((pattern) => pattern.test(lowerCombined))
        const tokenMatch = tokenize(nodeText).find((token) => loremWordSet.has(token))

        if (!phraseMatch && !tokenMatch) continue

        const preview = nodeText.length > 80 ? `${nodeText.slice(0, 80)}...` : nodeText
        flagged.push({ label: preview, nodeId })
    }

    if (flagged.length === 0) {
        return makeCheck(id, label, "pass", "No lorem ipsum placeholder content found", [], true)
    }

    return makeCheck(id, label, "fail", `${flagged.length} text layer(s) contain lorem placeholder content`, flagged, true)
}

async function checkComponentFileStructure(_nodes: AllNodes): Promise<CheckResult> {
    const id = "component-file-structure"
    const label = "Component File Structure"
    return skipCheck(
        id,
        label,
        "Framer Plugin API does not expose reliable Assets folder hierarchy for components. Verify component folder organization manually in the Assets panel.",
    )
}

// ---------------------------------------------------------------------------
// ACCESSIBILITY CHECKS (9)
// ---------------------------------------------------------------------------

async function checkConsistentTextStyles(nodes: AllNodes): Promise<CheckResult> {
    const id = "consistent-text-styles"
    const label = "Consistent Text Styles"
    const sizeItems = new Map<number, CheckItem>()

    for (const node of nodes.textNodes) {
        const html = await getNodeHTML(node)
        const fontSize = extractFontSizeFromHTML(html)
        if (fontSize !== null) {
            if (!sizeItems.has(fontSize)) {
                sizeItems.set(fontSize, { label: `${getNodeName(node)}: ${fontSize}px`, nodeId: node.id })
            }
        } else {
            // Try the font property as fallback
            const font = node.font as Record<string, unknown> | undefined
            if (font && typeof font.size === "number") {
                const size = font.size
                if (!sizeItems.has(size)) {
                    sizeItems.set(size, { label: `${getNodeName(node)}: ${size}px`, nodeId: node.id })
                }
            }
        }
    }

    const sizeList = Array.from(sizeItems.values())
    if (sizeItems.size === 0) {
        return makeCheck(id, label, "pass", "No text layers with detectable font sizes", [], true)
    }
    if (sizeItems.size === 1) {
        return makeCheck(id, label, "pass", `${sizeItems.size} unique font size — consistent`, sizeList, true)
    }
    if (sizeItems.size <= 8) {
        return makeCheck(id, label, "warning", `${sizeItems.size} unique font sizes — consider consolidating`, sizeList, true)
    }
    return makeCheck(id, label, "fail", `${sizeItems.size} unique font sizes — inconsistent text styles`, sizeList, true)
}

async function checkTextStyles(nodes: AllNodes): Promise<CheckResult> {
    const id = "text-styles"
    const label = "Text Styles"
    const missing: Array<CheckItem> = []
    const cmsNodeIds = await getCmsItemNodeIds(nodes)

    for (const node of nodes.textNodes) {
        if (cmsNodeIds.has(node.id)) continue
        const inlineTextStyle = (node as AnyNode).inlineTextStyle
        if (inlineTextStyle === null || inlineTextStyle === undefined) {
            missing.push({ label: getNodeName(node), nodeId: node.id, locked: isLockedNode(node as AnyNode) })
        }
    }

    if (missing.length === 0) {
        return makeCheck(id, label, "pass", "All text layers use text styles", [], true)
    }
    return makeCheck(id, label, "warning", `${missing.length} text layers not using a text style`, missing, true)
}

// Resolve backgroundColor which can be ColorStyle | string | null.
// ColorStyle has a .light RGBA string (and optional .dark).
// Returns a CSS color string or null.
function resolveBackgroundColor(bg: unknown): string | null {
    if (!bg) return null
    if (typeof bg === "string") {
        if (bg === "rgba(0,0,0,0)" || bg === "transparent" || bg.length === 0) return null
        return bg
    }
    if (typeof bg === "object") {
        // ColorStyle: { light: string, dark: string | null, ... }
        const light = (bg as Record<string, unknown>).light
        if (typeof light === "string" && light !== "rgba(0,0,0,0)" && light !== "transparent" && light.length > 0) {
            return light
        }
    }
    return null
}

// Walk up parent chain to find the first non-null, non-transparent solid background color.
// Stops immediately if a gradient or image background is encountered — contrast can't be
// determined against those, and looking past them would use the wrong ancestor color.
// Returns a CSS color string or null if none found (or ambiguous background hit).
async function getEffectiveBackground(node: AnyNode, maxDepth: number): Promise<string | null> {
    let current: AnyNode | null = node
    for (let i = 0; i < maxDepth; i++) {
        try {
            current = (await current.getParent().catch(() => null)) as unknown as AnyNode | null
            if (!current) break

            const p = current as Record<string, unknown>

            // Gradient or image — contrast can't be computed, stop traversal
            if (p.backgroundGradient != null) return null
            if (p.backgroundImage != null) return null

            const resolved = resolveBackgroundColor(p.backgroundColor)
            if (resolved) return resolved
        } catch {
            break
        }
    }
    return null
}


async function checkColorContrast(nodes: AllNodes): Promise<CheckResult> {
    const id = "color-contrast"
    const label = "Color Contrast (WCAG)"
    const failing: Array<CheckItem> = []

    for (const node of nodes.textNodes) {
        // Only check primary breakpoint and primary component variant — same filter every other check uses
        if (nodes.nodesInNonFirstBreakpoints.has(node.id)) continue
        if (nodes.nodesInNonPrimaryVariants.has(node.id)) continue
        // Skip SVG icon labels — text nodes whose direct parent is an SVGNode
        if (nodes.textNodesInSvg.has(node.id)) continue

        try {
            const nodeAny = node as AnyNode

            // --- Text color ---
            // inlineTextStyle is the global Framer text style applied to the node.
            // It is null when the user styled the text manually without creating a text style.
            // In that case, fall back to $framerInternal.getHTMLForNode which returns
            // the rendered HTML with inline CSS styles (including color).
            const inlineStyle = (nodeAny as Record<string, unknown>).inlineTextStyle as Record<string, unknown> | null | undefined
            let textColorStr = resolveBackgroundColor(inlineStyle?.color)

            if (!textColorStr) {
                const html = await getCanvasHtmlForFrame(node.id)
                if (html) textColorStr = extractColorFromHTML(html)
            }

            if (!textColorStr) continue

            const textParsed = parseColor(textColorStr)
            if (!textParsed) continue

            // --- Font size & weight ---
            const inlineFontSize = inlineStyle?.fontSize
            const inlineFontWeight = inlineStyle?.fontWeight
            const fontAny = (nodeAny as Record<string, unknown>).font as Record<string, unknown> | null | undefined
            const fontSize: number | null =
                typeof inlineFontSize === "number" ? inlineFontSize
                : typeof fontAny?.size === "number" ? fontAny.size
                : null
            const fontWeight: number | null =
                typeof inlineFontWeight === "number" ? inlineFontWeight
                : typeof fontAny?.weight === "number" ? fontAny.weight
                : null

            // Walk up parent chain to find effective background.
            // If no explicit solid-color background is found, skip this node.
            // We do NOT fall back to white — an unfound background is ambiguous
            // (could be image, gradient, sibling fill, etc.) and causes false positives.
            const bgStr = await getEffectiveBackground(nodeAny, 16)
            if (!bgStr) continue
            const bgParsed = parseColor(bgStr)
            if (!bgParsed) continue

            // Composite text color against background when semi-transparent.
            // A text with alpha=0.05 on white is effectively near-white — must reflect true visible color.
            const a = textParsed.a
            const effectiveR = Math.round(textParsed.r * a + bgParsed.r * (1 - a))
            const effectiveG = Math.round(textParsed.g * a + bgParsed.g * (1 - a))
            const effectiveB = Math.round(textParsed.b * a + bgParsed.b * (1 - a))

            // WCAG 2.1 §1.4.3 Contrast (Minimum) - Level AA
            const textLum = relativeLuminance(effectiveR, effectiveG, effectiveB)
            const bgLum = relativeLuminance(bgParsed.r, bgParsed.g, bgParsed.b)
            const ratio = contrastRatio(textLum, bgLum)

            // Large text: ≥18pt (24px) at any weight, or ≥14pt (≈18.67px) bold (≥700)
            const isBold = fontWeight !== null && fontWeight >= 700
            const isLargeText = fontSize !== null && (fontSize >= 24 || (isBold && fontSize >= 18.67))
            const requiredRatio = isLargeText ? 3.0 : 4.5

            if (ratio < requiredRatio) {
                failing.push({ label: `${getNodeName(node)}: ${ratio.toFixed(2)}:1 (needs ${requiredRatio}:1)`, nodeId: node.id })
            }
        } catch {
            // skip if can't compute
        }
    }

    if (failing.length === 0) {
        return makeCheck(id, label, "pass", "All text meets WCAG AA contrast requirements", [], true)
    }
    return makeCheck(id, label, "warning", `${failing.length} text ${failing.length === 1 ? "layer" : "layers"} fail WCAG AA contrast`, failing, true)
}

async function checkTextLegibility(nodes: AllNodes): Promise<CheckResult> {
    const id = "text-legibility"
    const label = "Text Legibility"
    const tooSmall: Array<CheckItem> = []

    for (const node of nodes.contentTextNodes) {
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
        return makeCheck(id, label, "skip", "No CMS collections found — skipped", [], true)
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
        return makeCheck(id, label, "skip", "No CMS collections found — skipped", [], true)
    }

    const issues: Array<CheckItem> = []
    let totalFields = 0

    for (const collection of nodes.collections) {
        try {
            const fields = await collection.getFields()
            totalFields += fields.length
            for (const field of fields) {
                const name = field.name
                const trimmed = name.trim()
                if (trimmed.length === 0) {
                    issues.push({ label: `${collection.name}: field has empty name`, nodeId: null })
                } else if (name !== trimmed) {
                    issues.push({ label: `${collection.name}.'${name}' — leading/trailing spaces`, nodeId: null })
                } else if (trimmed.length === 1) {
                    issues.push({ label: `${collection.name}.'${name}' — name too short (single character)`, nodeId: null })
                } else if (/^\d+$/.test(trimmed)) {
                    issues.push({ label: `${collection.name}.'${name}' — name is numeric only`, nodeId: null })
                } else if (/[!@#$%^&*()[\]{}<>?,;=+|\\/"'`~]/.test(trimmed)) {
                    issues.push({ label: `${collection.name}.'${name}' — name contains special characters`, nodeId: null })
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

function formatCmsHeading(value: unknown): string | null {
    const normalizeText = (input: string): string => {
        return input
            .replace(/<[^>]*>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/&#160;/gi, " ")
            .replace(/\u00A0/g, " ")
            .replace(/[\u200B-\u200D\uFEFF]/g, "")
            .replace(/\s+/g, " ")
            .trim()
    }

    if (typeof value === "string") {
        const trimmed = normalizeText(value)
        return trimmed.length > 0 ? trimmed : null
    }

    if (typeof value === "number" || typeof value === "boolean") {
        return String(value)
    }

    if (Array.isArray(value)) {
        for (const entry of value) {
            const heading = formatCmsHeading(entry)
            if (heading !== null) return heading
        }
        return null
    }

    if (value !== null && typeof value === "object") {
        const record = value as Record<string, unknown>
        for (const key of ["heading", "title", "text", "value", "plainText", "content", "name", "slug"]) {
            const heading = formatCmsHeading(record[key])
            if (heading !== null) return heading
        }
    }

    return null
}

function getCmsItemHeading(item: CollectionItem, fields: ReadonlyArray<CollectionField>): string {
    const preferredFieldNames = ["heading", "title", "name"]
    const normalizedFields = fields.map((field) => ({ field, normalizedName: field.name.trim().toLowerCase() }))

    for (const preferredName of preferredFieldNames) {
        const matchedField = normalizedFields.find(({ normalizedName }) => normalizedName === preferredName)?.field
        if (!matchedField) continue
        const heading = formatCmsHeading(item.fieldData[matchedField.id])
        if (heading !== null) return heading
    }

    for (const field of fields) {
        const heading = formatCmsHeading(item.fieldData[field.id])
        if (heading !== null) return heading
    }

    return item.slug.trim().length > 0 ? item.slug : item.nodeId
}

function getCollectionTitleFieldIds(fields: ReadonlyArray<CollectionField>): ReadonlySet<string> {
    const titleFieldIds = new Set<string>()
    for (const field of fields) {
        const normalizedName = field.name.trim().toLowerCase()
        if (normalizedName === "heading" || normalizedName === "title" || normalizedName === "name") {
            titleFieldIds.add(field.id)
        }
    }
    return titleFieldIds
}

function normalizeCmsFieldValue(value: unknown): unknown {
    if (value === null || value === undefined) return null
    if (typeof value === "string") return value.trim()
    if (typeof value === "number" || typeof value === "boolean") return value
    if (Array.isArray(value)) return value.map((entry) => normalizeCmsFieldValue(entry))
    if (typeof value === "object") {
        const record = value as Record<string, unknown>

        // Framer CMS field values are often wrapped as { type, value }.
        // For duplicate-content checks we only care about the semantic payload.
        if ("value" in record) {
            return normalizeCmsFieldValue(record.value)
        }

        const normalized: Record<string, unknown> = {}
        for (const key of Object.keys(record).sort((a, b) => a.localeCompare(b))) {
            if (key === "type") continue
            normalized[key] = normalizeCmsFieldValue(record[key])
        }
        return normalized
    }
    return value
}

function hasMeaningfulCmsValue(value: unknown): boolean {
    const normalizeText = (input: string): string => {
        return input
            .replace(/<[^>]*>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/&#160;/gi, " ")
            .replace(/\u00A0/g, " ")
            .replace(/[\u200B-\u200D\uFEFF]/g, "")
            .replace(/\s+/g, " ")
            .trim()
    }

    if (value === null || value === undefined) return false
    if (typeof value === "string") return normalizeText(value).length > 0
    if (typeof value === "number" || typeof value === "boolean") return true
    if (Array.isArray(value)) return value.some((entry) => hasMeaningfulCmsValue(entry))
    if (typeof value === "object") {
        const record = value as Record<string, unknown>

        for (const textKey of ["html", "text", "plainText", "markdown", "content"]) {
            if (!(textKey in record)) continue
            const textCandidate = record[textKey]
            if (typeof textCandidate === "string") {
                if (normalizeText(textCandidate).length > 0) return true
                continue
            }
            if (hasMeaningfulCmsValue(textCandidate)) return true
        }

        if ("value" in record) {
            return hasMeaningfulCmsValue(record.value)
        }

        for (const [key, entry] of Object.entries(record)) {
            if (key === "type") continue
            if (hasMeaningfulCmsValue(entry)) return true
        }
        return false
    }
    return false
}

function buildCmsContentFingerprint(item: CollectionItem, titleFieldIds: ReadonlySet<string>): string | null {
    const relevantFieldIds = Object.keys(item.fieldData)
        .filter((fieldId) => !titleFieldIds.has(fieldId) && fieldId !== "slug")
        .sort((a, b) => a.localeCompare(b))

    if (relevantFieldIds.length === 0) return null

    const payload: Record<string, unknown> = {}
    let hasMeaningfulValue = false
    for (const fieldId of relevantFieldIds) {
        const normalizedValue = normalizeCmsFieldValue(item.fieldData[fieldId])
        payload[fieldId] = normalizedValue
        if (hasMeaningfulCmsValue(normalizedValue)) {
            hasMeaningfulValue = true
        }
    }

    if (!hasMeaningfulValue) return null

    return JSON.stringify(payload)
}

function buildCmsDuplicateBadge(reasons: ReadonlySet<"title" | "content">): string {
    const parts: string[] = []
    if (reasons.has("title")) parts.push("title")
    if (reasons.has("content")) parts.push("content")
    return parts.join(" + ")
}

async function checkDuplicateCmsContent(nodes: AllNodes): Promise<CheckResult> {
    const id = "duplicate-cms-content"
    const label = "Duplicate CMS Content"

    const collectionsToScan = nodes.collections

    if (collectionsToScan.length === 0) {
        return makeCheck(id, label, "skip", "No CMS collections found — skipped", [], true)
    }

    const itemsByCollection = new Map<string, CheckItem[]>()
    const unreadableCollections: Array<string> = []
    let totalDuplicateItems = 0

    for (const collection of collectionsToScan) {
        let collectionItems: ReadonlyArray<CollectionItem>
        try {
            collectionItems = await collection.getItems()
        } catch {
            unreadableCollections.push(collection.name)
            continue
        }

        let fields: ReadonlyArray<CollectionField> = []
        try {
            fields = await collection.getFields()
        } catch {
            // Field lookup is optional for heading extraction.
        }

        const titleFieldIds = getCollectionTitleFieldIds(fields)
        const itemsByTitle = new Map<string, Array<{ item: CollectionItem; heading: string }>>()
        const itemsByContent = new Map<string, Array<{ item: CollectionItem; heading: string }>>()
        const itemMetaByNodeId = new Map<string, { heading: string; reasons: Set<"title" | "content"> }>()

        for (const item of collectionItems) {
            const heading = getCmsItemHeading(item, fields)
            const titleEntry = itemsByTitle.get(heading)
            const titleGroup = { item, heading }
            if (titleEntry) {
                titleEntry.push(titleGroup)
            } else {
                itemsByTitle.set(heading, [titleGroup])
            }

            const contentFingerprint = buildCmsContentFingerprint(item, titleFieldIds)
            if (contentFingerprint !== null) {
                const contentEntry = itemsByContent.get(contentFingerprint)
                if (contentEntry) {
                    contentEntry.push(titleGroup)
                } else {
                    itemsByContent.set(contentFingerprint, [titleGroup])
                }
            }
        }

        for (const group of itemsByTitle.values()) {
            if (group.length < 2) continue
            for (const entry of group) {
                const nodeKey = entry.item.nodeId
                const existing = itemMetaByNodeId.get(nodeKey)
                if (existing) {
                    existing.reasons.add("title")
                } else {
                    itemMetaByNodeId.set(nodeKey, { heading: entry.heading, reasons: new Set(["title"]) })
                }
            }
        }

        for (const group of itemsByContent.values()) {
            if (group.length < 2) continue
            for (const entry of group) {
                const nodeKey = entry.item.nodeId
                const existing = itemMetaByNodeId.get(nodeKey)
                if (existing) {
                    existing.reasons.add("content")
                } else {
                    itemMetaByNodeId.set(nodeKey, { heading: entry.heading, reasons: new Set(["content"]) })
                }
            }
        }

        const duplicateEntries = Array.from(itemMetaByNodeId.entries()).map(([nodeId, meta]) => ({
            label: meta.heading,
            nodeId,
            badge: buildCmsDuplicateBadge(meta.reasons),
            groupLabel: collection.name,
        }))

        if (duplicateEntries.length === 0) continue

        totalDuplicateItems += duplicateEntries.length
        const existingCollectionItems = itemsByCollection.get(collection.name)
        if (existingCollectionItems) {
            existingCollectionItems.push(...duplicateEntries)
        } else {
            itemsByCollection.set(collection.name, duplicateEntries)
        }
    }

    const cmsItems = Array.from(itemsByCollection.values()).flatMap((group) => group)

    if (cmsItems.length === 0) {
        if (unreadableCollections.length > 0) {
            return makeCheck(
                id,
                label,
                "fail",
                `No CMS pages could be read, but ${unreadableCollections.length} collections could not be read`,
                unreadableCollections.map((name) => ({ label: `${name}: unable to read items`, nodeId: null })),
                true,
            )
        }

        return makeCheck(id, label, "pass", "No duplicate CMS pages found", [], true)
    }

    return makeCheck(
        id,
        label,
        "fail",
        unreadableCollections.length > 0
            ? `${totalDuplicateItems} duplicate CMS pages found; ${unreadableCollections.length} collections could not be read`
            : `${totalDuplicateItems} duplicate CMS pages found`,
        cmsItems,
        true,
    )
}

async function checkEmptyCmsFields(nodes: AllNodes): Promise<CheckResult> {
    const id = "empty-cms-fields"
    const label = "Empty CMS Fields"

    if (nodes.collections.length === 0) {
        return makeCheck(id, label, "skip", "No CMS collections found — skipped", [], true)
    }

    const flagged: Array<CheckItem> = []

    const normalizeKey = (value: string): string => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")

    const makeFieldAliasKeys = (field: CollectionField): ReadonlyArray<string> => {
        const aliases = new Set<string>()
        const rawName = field.name.trim()
        const rawId = field.id.trim()
        if (rawId.length > 0) aliases.add(rawId)
        if (rawName.length > 0) aliases.add(rawName)
        if (rawName.length > 0) aliases.add(rawName.replace(/\s+/g, "_"))
        if (rawName.length > 0) aliases.add(rawName.replace(/\s+/g, "-"))
        const normalizedName = normalizeKey(rawName)
        const normalizedId = normalizeKey(rawId)
        if (normalizedName.length > 0) aliases.add(normalizedName)
        if (normalizedId.length > 0) aliases.add(normalizedId)
        return Array.from(aliases)
    }

    const getFieldValue = (
        item: CollectionItem,
        field: CollectionField,
        normalizedFieldDataKeyMap: ReadonlyMap<string, string>,
    ): { exists: boolean; value: unknown } => {
        if (Object.prototype.hasOwnProperty.call(item.fieldData, field.id)) {
            return { exists: true, value: item.fieldData[field.id] }
        }

        for (const alias of makeFieldAliasKeys(field)) {
            if (Object.prototype.hasOwnProperty.call(item.fieldData, alias)) {
                return { exists: true, value: item.fieldData[alias] }
            }
            const normalizedAlias = normalizeKey(alias)
            if (normalizedAlias.length === 0) continue
            const matchedKey = normalizedFieldDataKeyMap.get(normalizedAlias)
            if (matchedKey && Object.prototype.hasOwnProperty.call(item.fieldData, matchedKey)) {
                return { exists: true, value: item.fieldData[matchedKey] }
            }
        }

        return { exists: false, value: null }
    }

    const pushedFlagKeys = new Set<string>()
    const cleanTagText = (value: string): string => {
        const cleaned = value
            .replace(/<[^>]*>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/&#160;/gi, " ")
            .replace(/\u00A0/g, " ")
            .replace(/[\u200B-\u200D\uFEFF]/g, "")
            .replace(/\s+/g, " ")
            .trim()
        return cleaned.length > 0 ? cleaned : "Untitled CMS Item"
    }

    const categorizeField = (fieldName: string): string => {
        const normalized = fieldName.trim().toLowerCase()
        if (/(^|\b)(title|name|heading)(\b|$)/.test(normalized)) return "Title"
        if (/(^|\b)slug(\b|$)/.test(normalized)) return "Slug"
        if (/(^|\b)(date|time|published|publish|created|updated)(\b|$)/.test(normalized)) return "Date"
        if (/(^|\b)(image|images|img|thumbnail|thumb|hero|cover|photo|media|gallery|icon|banner)(\b|$)/.test(normalized)) return "Image"
        if (/(^|\b)(categor|tag|taxonomy|topic)(\b|$)/.test(normalized)) return "Categories"
        if (/(^|\b)(content|body|rich\s*text|description|summary|excerpt)(\b|$)/.test(normalized)) return "Content"
        return "Field"
    }

    const issueLabelForField = (fieldName: string): string => {
        const category = categorizeField(fieldName)
        if (category === "Field") {
            const fallback = fieldName.trim().toLowerCase()
            return fallback.length > 0 ? fallback : "field"
        }
        return category.toLowerCase()
    }

    const pushFlag = (collectionName: string, heading: string, fieldName: string, reason: "missing" | "empty", nodeId: string): void => {
        const issueCategory = categorizeField(fieldName)
        const cleanHeading = cleanTagText(heading)
        const key = `${collectionName}|${cleanHeading}|${fieldName}|${issueCategory}|${reason}|${nodeId}`
        if (pushedFlagKeys.has(key)) return
        pushedFlagKeys.add(key)
        flagged.push({
            label: issueLabelForField(fieldName),
            nodeId,
            groupLabel: collectionName,
            pageLabel: collectionName,
        })
    }

    for (const collection of nodes.collections) {
        let items: ReadonlyArray<CollectionItem> = []
        let fields: ReadonlyArray<CollectionField> = []

        try {
            items = await collection.getItems()
        } catch {
            flagged.push({ label: `${collection.name}: unable to read items`, nodeId: null })
            continue
        }

        try {
            fields = await collection.getFields()
        } catch {
            flagged.push({ label: `${collection.name}: unable to read fields`, nodeId: null })
            continue
        }

        for (const item of items) {
            const heading = getCmsItemHeading(item, fields)
            const normalizedFieldDataKeyMap = new Map<string, string>()
            for (const key of Object.keys(item.fieldData)) {
                const normalized = normalizeKey(key)
                if (normalized.length > 0 && !normalizedFieldDataKeyMap.has(normalized)) {
                    normalizedFieldDataKeyMap.set(normalized, key)
                }
            }

            const checkedDataKeys = new Set<string>()

            for (const field of fields) {
                const resolved = getFieldValue(item, field, normalizedFieldDataKeyMap)
                if (!resolved.exists) {
                    pushFlag(collection.name, heading, field.name, "missing", item.nodeId)
                    continue
                }

                for (const alias of makeFieldAliasKeys(field)) {
                    if (Object.prototype.hasOwnProperty.call(item.fieldData, alias)) checkedDataKeys.add(alias)
                    const normalizedAlias = normalizeKey(alias)
                    const mappedKey = normalizedFieldDataKeyMap.get(normalizedAlias)
                    if (mappedKey) checkedDataKeys.add(mappedKey)
                }

                const fieldValue = resolved.value
                if (!hasMeaningfulCmsValue(fieldValue)) {
                    pushFlag(collection.name, heading, field.name, "empty", item.nodeId)
                }
            }

            const slugFieldName = typeof collection.slugFieldName === "string" ? collection.slugFieldName.trim() : ""
            const slugFieldNormalized = normalizeKey(slugFieldName)
            const slugFieldFromData = slugFieldNormalized.length > 0 ? normalizedFieldDataKeyMap.get(slugFieldNormalized) : null
            checkedDataKeys.add("slug")
            if (slugFieldFromData) checkedDataKeys.add(slugFieldFromData)
            if (slugFieldName.length > 0) checkedDataKeys.add(slugFieldName)

            const slugFieldMissing = item.slug.trim().length === 0
                && (!slugFieldFromData || !hasMeaningfulCmsValue(item.fieldData[slugFieldFromData]))

            if (slugFieldMissing) {
                pushFlag(collection.name, heading, slugFieldName.length > 0 ? slugFieldName : "slug", "empty", item.nodeId)
            }

            // Catch any additional item field-data columns that exist on the item but are not
            // represented in getFields() (or use alternate key names). If those values are empty,
            // they should still be flagged.
            for (const [dataKey, dataValue] of Object.entries(item.fieldData)) {
                if (checkedDataKeys.has(dataKey)) continue
                if (!hasMeaningfulCmsValue(dataValue)) {
                    pushFlag(collection.name, heading, dataKey, "empty", item.nodeId)
                }
            }
        }
    }

    if (flagged.length === 0) {
        return makeCheck(id, label, "pass", "No empty CMS fields found", [], true)
    }

    return makeCheck(id, label, "warning", `${flagged.length} empty CMS field(s) found`, flagged, true)
}

// ---------------------------------------------------------------------------
// LINKS CHECKS (5)
// ---------------------------------------------------------------------------

function normalizeDiscoveredLink(value: unknown): string | null {
    if (typeof value !== "string") return null
    const normalized = value.trim()
    return normalized.length > 0 ? normalized : null
}

function extractLinkValuesFromUnknown(input: unknown, maxDepth: number): ReadonlyArray<string> {
    const links = new Set<string>()
    const seenObjects = new WeakSet<object>()
    const linkKeyPattern = /(link|href|url|destination|action|webpage|pageid)/i

    const visit = (value: unknown, depth: number, keyHint: string): void => {
        if (depth > maxDepth || value === null || value === undefined) return

        const direct = normalizeDiscoveredLink(value)
        if (direct !== null && linkKeyPattern.test(keyHint)) {
            links.add(direct)
            return
        }

        if (typeof value !== "object") return
        const obj = value as object
        if (seenObjects.has(obj)) return
        seenObjects.add(obj)

        if (Array.isArray(value)) {
            for (const entry of value) visit(entry, depth + 1, keyHint)
            return
        }

        const record = value as Record<string, unknown>
        const objectType = typeof record.type === "string" ? record.type.toLowerCase() : ""
        if (objectType === "link" || objectType === "url" || objectType === "webpage") {
            for (const candidate of [record.url, record.href, record.path, record.value]) {
                const normalized = normalizeDiscoveredLink(candidate)
                if (normalized !== null) links.add(normalized)
            }
            if (typeof record.webPageId === "string" && record.webPageId.trim().length > 0) {
                links.add(record.webPageId.trim())
            }
            if (typeof record.pageId === "string" && record.pageId.trim().length > 0) {
                links.add(record.pageId.trim())
            }
        }

        for (const [key, nested] of Object.entries(record)) {
            if (linkKeyPattern.test(key)) {
                const normalized = normalizeDiscoveredLink(nested)
                if (normalized !== null) links.add(normalized)
            }
            visit(nested, depth + 1, key)
        }
    }

    visit(input, 0, "link")
    return Array.from(links)
}

function collectNodeLinkValues(node: AnyNode): ReadonlyArray<string> {
    const links = new Set<string>()
    for (const value of [
        node.link,
        node.typedControls,
        node.controls,
        node.props,
        node.properties,
        node.componentProperties,
        node,
    ]) {
        for (const link of extractLinkValuesFromUnknown(value, 6)) {
            links.add(link)
        }
    }
    return Array.from(links)
}

async function collectAllLinks(nodes: AllNodes): Promise<ReadonlyArray<{ name: string; link: string }>> {
    const results: Array<{ name: string; link: string }> = []
    const allNodes: ReadonlyArray<AnyNode> = [
        ...(nodes.frameNodes as ReadonlyArray<AnyNode>),
        ...nodes.textNodes,
        ...nodes.componentNodes,
    ]
    for (const node of allNodes) {
        const links = collectNodeLinkValues(node)
        for (const link of links) {
            results.push({ name: getNodeName(node), link })
        }
    }
    return results
}

async function checkMailtoTelLinks(nodes: AllNodes): Promise<CheckResult> {
    const id = "mailto-tel-links"
    const label = "Mailto/Tel Links"

    // Email regex: basic email pattern
    const emailRegex = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g
    // Phone regex: various formats like 123-456-7890, (123) 456-7890, +1 234 567 8900, etc.
    const phoneRegex = /\b(\+?[\d\s()-]{10,}|(?:\d{3}[-.]?)?\d{3}[-.]?\d{4})\b/g

    // Collect all email addresses and phone numbers from text nodes
    const foundEmails = new Map<string, Set<string>>() // email (lowercase) -> set of node names
    const foundPhones = new Map<string, Set<string>>() // phone (normalized) -> set of node names

    for (const textNode of nodes.textNodes) {
        const text = (await getNodeText(textNode)).trim()
        if (!text) continue

        const nodeName = getNodeName(textNode)

        // Find emails
        const emailMatches = text.match(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g)
        if (emailMatches) {
            for (const email of emailMatches) {
                const key = email.toLowerCase()
                if (!foundEmails.has(key)) foundEmails.set(key, new Set())
                foundEmails.get(key)!.add(nodeName)
            }
        }

        // Find phones (normalize for comparison)
        const phoneMatches = text.match(/\b(\+?[\d\s()-]{10,}|(?:\d{3}[-.]?)?\d{3}[-.]?\d{4})\b/g)
        if (phoneMatches) {
            for (const phone of phoneMatches) {
                const normalized = phone.replace(/[\s()-]/g, "")
                if (!foundPhones.has(normalized)) foundPhones.set(normalized, new Set())
                foundPhones.get(normalized)!.add(nodeName)
            }
        }
    }

    if (foundEmails.size === 0 && foundPhones.size === 0) {
        return makeCheck(id, label, "skip", "No email addresses or phone numbers found on the page", [], true)
    }

    // Collect all mailto and tel links
    const allLinks = await collectAllLinks(nodes)
    const mailtoEmails = new Set<string>()
    const telPhones = new Set<string>()

    for (const { link } of allLinks) {
        const normalized = link.toLowerCase()
        if (normalized.startsWith("mailto:")) {
            const email = normalized.substring(7) // Remove "mailto:"
            mailtoEmails.add(email)
        } else if (normalized.startsWith("tel:")) {
            const phone = normalized.substring(4).replace(/[\s()-]/g, "") // Remove "tel:" and normalize
            telPhones.add(phone)
        }
    }

    // Check for missing links and validate formats
    const issues: Array<CheckItem> = []

    // Check emails have links
    for (const [email, nodeNames] of foundEmails) {
        if (!mailtoEmails.has(email)) {
            const nodes = Array.from(nodeNames).join(", ")
            issues.push({ label: `'${email}' found in ${nodes} but has no mailto: link`, nodeId: null })
        }
    }

    // Check phones have links
    for (const [phone, nodeNames] of foundPhones) {
        if (!telPhones.has(phone)) {
            const nodes = Array.from(nodeNames).join(", ")
            issues.push({ label: `'${phone.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3")}' found in ${nodes} but has no tel: link`, nodeId: null })
        }
    }

    // Validate format of all mailto/tel links
    for (const { name, link } of allLinks) {
        const normalized = link.toLowerCase()
        if (normalized.startsWith("mailto:")) {
            if (!/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+/.test(link)) {
                issues.push({ label: `${name}: invalid mailto format '${link}'`, nodeId: null })
            }
        } else if (normalized.startsWith("tel:")) {
            if (!/^tel:\+?[\d\s()-]+$/.test(link)) {
                issues.push({ label: `${name}: invalid tel format '${link}'`, nodeId: null })
            }
        }
    }

    if (issues.length === 0) {
        const emailCount = foundEmails.size
        const phoneCount = foundPhones.size
        return makeCheck(id, label, "pass", `All ${emailCount} email(s) and ${phoneCount} phone number(s) have valid links`, [], true)
    }

    return makeCheck(id, label, "warning", `${issues.length} issue(s) with email/phone links`, issues, true)
}

async function checkHoverStateLinks(nodes: AllNodes): Promise<CheckResult> {
    const id = "hover-state-links"
    const label = "Hover State Links"

    // Identify components that have hover or pressed state variants
    const hoverCapableIdentifiers = new Set<string>()

    for (const frame of nodes.frameNodes) {
        const componentIdentifier = nodes.variantFrameComponentIdMap.get(frame.id)
        if (!componentIdentifier) continue

        // Check if this frame is a gesture variant (hover or pressed state)
        if (isComponentGestureVariant(frame)) {
            const gesture = (frame as any).gesture
            if (gesture === "hover" || gesture === "pressed") {
                hoverCapableIdentifiers.add(componentIdentifier)
            }
        }
    }

    if (hoverCapableIdentifiers.size === 0) {
        return makeCheck(id, label, "skip", "No components with hover or pressed state variants found", [], true)
    }

    function isEmptyLinkValue(value: unknown): boolean {
        if (value === undefined || value === null) return true
        if (typeof value === "string") return value.trim().length === 0

        if (typeof value !== "object") return false
        const record = value as Record<string, unknown>

        const type = record.type

        if (type === "url") {
            const url = record.url
            return typeof url !== "string" || url.trim().length === 0
        }

        if (type === "webPage") {
            const webPageId = record.webPageId
            return typeof webPageId !== "string" || webPageId.trim().length === 0
        }

        if (type === "link") {
            if ("value" in record) return isEmptyLinkValue(record.value)
            return isEmptyLinkValue({
                url: record.url,
                href: record.href,
                path: record.path,
                pageId: record.pageId,
                webPageId: record.webPageId,
            })
        }

        if ("url" in record) return typeof record.url !== "string" || record.url.trim().length === 0
        if ("href" in record) return typeof record.href !== "string" || record.href.trim().length === 0
        if ("path" in record) return typeof record.path !== "string" || record.path.trim().length === 0
        if ("webPageId" in record) return typeof record.webPageId !== "string" || record.webPageId.trim().length === 0
        if ("pageId" in record) return typeof record.pageId !== "string" || record.pageId.trim().length === 0
        if ("value" in record) return isEmptyLinkValue(record.value)

        return false
    }

    function collectExplicitLinkCandidates(node: AnyNode): ReadonlyArray<unknown> {
        const explicitLinkCandidates: unknown[] = []

        if (node.link !== undefined) {
            explicitLinkCandidates.push(node.link)
        }

        const typedControls = (node.typedControls ?? {}) as Record<string, unknown>
        for (const control of Object.values(typedControls)) {
            if (typeof control !== "object" || control === null) continue
            const record = control as Record<string, unknown>
            const typeValue = typeof record.type === "string" ? record.type.toLowerCase() : ""
            if (typeValue === "link" || typeValue === "url" || typeValue === "webpage") {
                explicitLinkCandidates.push("value" in record ? record.value : record)
            }
        }

        const controls = (node.controls ?? {}) as Record<string, unknown>
        for (const control of Object.values(controls)) {
            if (typeof control !== "object" || control === null) continue
            const record = control as Record<string, unknown>
            const typeValue = typeof record.type === "string" ? record.type.toLowerCase() : ""
            if (typeValue === "link" || typeValue === "url" || typeValue === "webpage") {
                explicitLinkCandidates.push("value" in record ? record.value : record)
            }
        }

        const collectStructuredLinks = (input: unknown, depth: number, seen: WeakSet<object>): void => {
            if (depth > 6 || input === null || input === undefined) return
            if (typeof input !== "object") return

            const obj = input as object
            if (seen.has(obj)) return
            seen.add(obj)

            if (Array.isArray(input)) {
                for (const entry of input) collectStructuredLinks(entry, depth + 1, seen)
                return
            }

            const record = input as Record<string, unknown>
            const typeValue = typeof record.type === "string" ? record.type.toLowerCase() : ""
            const isLinkType = typeValue === "link" || typeValue === "url" || typeValue === "webpage"
            const hasExplicitLinkFields = "url" in record || "href" in record || "path" in record || "webPageId" in record || "pageId" in record
            if (isLinkType || hasExplicitLinkFields) {
                explicitLinkCandidates.push("value" in record ? record.value : record)
            }

            for (const nested of Object.values(record)) {
                collectStructuredLinks(nested, depth + 1, seen)
            }
        }

        const seen = new WeakSet<object>()
        collectStructuredLinks(node.props, 0, seen)
        collectStructuredLinks(node.properties, 0, seen)
        collectStructuredLinks(node.componentProperties, 0, seen)

        return explicitLinkCandidates
    }

    const pageIds = new Set(nodes.pages.map((page) => page.id))
    const flagged: Array<CheckItem> = []
    const flaggedNodeIds = new Set<string>()
    let hoverInstancesOnPages = 0

    for (const node of nodes.componentNodes) {
        const nodeId = node.id
        if (!isPrimaryScopedNode(nodes, nodeId)) continue

        const componentIdentifier = typeof node.componentIdentifier === "string"
            ? node.componentIdentifier
            : null
        if (!componentIdentifier || !hoverCapableIdentifiers.has(componentIdentifier)) continue

        if (!(await isOnPage(node, pageIds, nodes.designFilePageIds))) continue
        hoverInstancesOnPages++

        const candidates = collectExplicitLinkCandidates(node)
        const hasConfiguredLink = candidates.some((candidate) => !isEmptyLinkValue(candidate))
        if (!hasConfiguredLink && !flaggedNodeIds.has(nodeId)) {
            flagged.push({ label: getNodeName(node), nodeId })
            flaggedNodeIds.add(nodeId)
        }
    }

    if (hoverInstancesOnPages === 0) {
        return makeCheck(id, label, "skip", "No hover-state component instances found on pages", [], true)
    }
    if (flagged.length === 0) {
        return makeCheck(id, label, "pass", `All ${hoverInstancesOnPages} hover-state component instance(s) have links`, [], true)
    }

    return makeCheck(
        id,
        label,
        "warning",
        `${flagged.length} of ${hoverInstancesOnPages} hover-state component instance(s) are missing links`,
        flagged,
        true,
    )
}

// ---------------------------------------------------------------------------
// Walks a node's parent chain and returns true if a WebPageNode ancestor is
// found before hitting a DesignPageNode, null (detached), or the depth limit.
// Used to filter VectorSetItemNodes to only those placed on published pages.
async function isOnPage(node: AnyNode, pageIds: ReadonlySet<string>, designPageIds: ReadonlySet<string>): Promise<boolean> {
    let current: AnyNode | null = node
    const MAX_DEPTH = 40
    for (let i = 0; i < MAX_DEPTH; i++) {
        current = (await current.getParent().catch(() => null)) as AnyNode | null
        if (current === null) return false
        if (pageIds.has(current.id)) return true
        if (designPageIds.has(current.id)) return false
    }
    return false
}

// Fetches all VectorSetItemNodes that are:
//   • Placed on a WebPage (not floating, not on a DesignPage)
//   • In the primary breakpoint (not tablet / mobile breakpoints)
//   • In the primary component variant (not alternate variants)
// The two color properties Framer stores on a VectorSetItemNode are:
//   • fill  — the fill/body color of the vector
//   • color — the selection / outline color shown in the design panel
async function fetchVectorSetItemNodesOnPages(nodes: AllNodes): Promise<ReadonlyArray<AnyNode>> {
    const framerAny = framer as unknown as Record<string, unknown>
    let rawNodes: ReadonlyArray<AnyNode> = []
    try {
        rawNodes = await (framerAny.getNodesWithType as (t: string) => Promise<ReadonlyArray<AnyNode>>)("VectorSetItemNode").catch(() => [])
    } catch {
        return []
    }

    const pageIds = new Set(nodes.pages.map((p) => p.id))
    const result: Array<AnyNode> = []

    for (const node of rawNodes) {
        // Exclude non-first breakpoints and non-primary variants
        if (nodes.nodesInNonFirstBreakpoints.has(node.id)) continue
        if (nodes.nodesInNonPrimaryVariants.has(node.id)) continue
        // Exclude nodes not reachable from a WebPage
        if (!(await isOnPage(node, pageIds, nodes.designFilePageIds))) continue
        result.push(node)
    }

    return result
}

function isRawColorString(value: string): boolean {
    return (value.startsWith("#") || value.startsWith("rgb") || value.startsWith("hsl")) &&
        value !== "rgba(0,0,0,0)" && value !== "transparent"
}

async function checkColorStyles(nodes: AllNodes): Promise<CheckResult> {
    const id = "color-styles"
    const label = "Color Styles"
    const flagged: Array<CheckItem> = []

    for (const node of nodes.textNodes) {
        if (nodes.nodesInNonFirstBreakpoints.has(node.id)) continue
        if (nodes.nodesInNonPrimaryVariants.has(node.id)) continue
        const color = (node as AnyNode).color
        if (typeof color === "string" && isRawColorString(color)) {
            // Distinguish nodes that have a text style applied but override its color
            const inlineTextStyle = (node as AnyNode).inlineTextStyle
            const hasTextStyle = inlineTextStyle !== null && inlineTextStyle !== undefined
            const itemLabel = hasTextStyle
                ? `${getNodeName(node as AnyNode)}: Color override on text style`
                : `${getNodeName(node as AnyNode)}: Raw Color`
            flagged.push({ label: itemLabel, nodeId: node.id as string, locked: isLockedNode(node as AnyNode) })
        }
    }

    // Check SVG (icon) nodes for raw color
    for (const node of nodes.svgNodes) {
        if (nodes.nodesInNonFirstBreakpoints.has(node.id)) continue
        if (nodes.nodesInNonPrimaryVariants.has(node.id)) continue
        const color = (node as AnyNode).color
        if (typeof color === "string" && isRawColorString(color)) {
            flagged.push({ label: `${getNodeName(node as AnyNode)}: Raw Color (Icon)`, nodeId: node.id as string, locked: isLockedNode(node as AnyNode) })
        }
    }

    // Check VectorSetItem nodes — fetch with page / breakpoint / variant filtering
    const vectorSetItemNodes = await fetchVectorSetItemNodesOnPages(nodes)
    for (const node of vectorSetItemNodes) {
        const raw = node as Record<string, unknown>
        const fill = raw.fill
        const selectionColor = raw.color
        const hasFillRaw = typeof fill === "string" && isRawColorString(fill)
        const hasColorRaw = typeof selectionColor === "string" && isRawColorString(selectionColor)
        if (hasFillRaw || hasColorRaw) {
            flagged.push({ label: `${getNodeName(node)}: Raw Color (Vector)`, nodeId: node.id, locked: isLockedNode(node) })
        }
    }

    for (const frame of nodes.contentFrameNodes) {
        if (nodes.nodesInNonPrimaryVariants.has(frame.id)) continue
        const bg = (frame as AnyNode).backgroundColor
        if (typeof bg === "string" && isRawColorString(bg)) {
            flagged.push(withFramePageLabel(nodes, { label: `${getNodeName(frame as AnyNode)}: Raw Background`, nodeId: frame.id as string, locked: isLockedNode(frame as AnyNode) }, frame.id))
        }
    }

    // Check text styles for raw color values (not referencing a Color Style)
    try {
        const textStyles = await framer.getTextStyles()
        for (const style of textStyles) {
            const raw = style as unknown as Record<string, unknown>
            const name = typeof raw.name === "string" ? raw.name : ""
            if (name.trim() === "") continue
            const color = raw.color
            if (typeof color === "string" && isRawColorString(color)) {
                flagged.push({ label: `Text style "${name}": Raw Color`, nodeId: null })
            }
        }
    } catch {
        // getTextStyles not available — skip
    }

    if (flagged.length === 0) {
        return makeCheck(id, label, "pass", "All colors use registered Color Styles", [], true)
    }
    return makeCheck(id, label, "warning", `${flagged.length} element(s) using raw colors instead of styles`, flagged, true)
}

async function checkContactFormSendTo(nodes: AllNodes): Promise<CheckResult> {
    const id = "contact-form"
    const label = "Form Send-To"
    return makeCheck(id, label, "skip", "Skipped", [], true)
    // eslint-disable-next-line no-unreachable
    const flagged: Array<CheckItem> = []

    const seen = new Set<string>()

    function toRecord(value: unknown): Record<string, unknown> {
        return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
    }

    function getNodeTag(node: AnyNode): string {
        const anyNode = node as Record<string, unknown>
        const rawTag = anyNode.__htmlTag ?? anyNode.tag ?? anyNode.htmlTag
        return typeof rawTag === "string" ? rawTag.toLowerCase() : ""
    }

    function getNodeBags(node: AnyNode): Array<Record<string, unknown>> {
        const nodeAny = node as Record<string, unknown>
        return [
            nodeAny,
            toRecord(nodeAny.props ?? nodeAny.properties),
            toRecord(nodeAny.controls),
            toRecord(nodeAny.typedControls),
        ]
    }

    function hasKey(bags: Array<Record<string, unknown>>, key: string): boolean {
        return bags.some((bag) => bag[key] !== undefined)
    }


    async function hasFormStructure(node: AnyNode): Promise<boolean> {
        const tag = getNodeTag(node)
        if (tag === "form") return true
        if (tag === "button") return false

        const bags = getNodeBags(node)
        if (hasKey(bags, "onSubmit") || hasKey(bags, "method") || hasKey(bags, "formAction")) return true
        if (hasKey(bags, "sendTo") || hasKey(bags, "action") || hasKey(bags, "webhook") || hasKey(bags, "destination")) return true

        const fieldTags = new Set(["input", "textarea", "select"])
        let fieldLikeCount = 0
        let submitLikeCount = 0
        const visited = new Set<string>()
        const queue: Array<{ node: AnyNode; depth: number }> = [{ node, depth: 0 }]

        while (queue.length > 0) {
            const current = queue.shift()!
            if (visited.has(current.node.id)) continue
            visited.add(current.node.id)
            if (current.depth > 4) continue

            const currentTag = getNodeTag(current.node)
            const currentBags = getNodeBags(current.node)
            if (fieldTags.has(currentTag)) fieldLikeCount++

            const inputType = currentBags
                .map((bag) => bag.type)
                .find((v) => typeof v === "string") as string | undefined
            if (currentTag === "button" || (currentTag === "input" && inputType?.toLowerCase() === "submit")) {
                submitLikeCount++
            }
            if (hasKey(currentBags, "required") || hasKey(currentBags, "placeholder")) {
                fieldLikeCount++
            }

            if (fieldLikeCount >= 2 && submitLikeCount >= 1) return true

            try {
                const children = await (current.node as unknown as { getChildren?: () => Promise<AnyNode[]> }).getChildren?.()
                if (Array.isArray(children)) {
                    for (const child of children) {
                        queue.push({ node: child as AnyNode, depth: current.depth + 1 })
                    }
                }
            } catch {
                // Ignore nodes that do not expose children.
            }
        }

        return false
    }

    const detectedFormRoots = new Map<string, AnyNode>()

    // 1) Resolve forms from published HTML back to Framer nodes.
    let publishedUrl: string | null = null
    let publishedFormMatches: ReadonlyArray<PublishedToFramerMatch> = []
    try {
        publishedUrl = await getPublishedSiteUrl()
        const currentPublishedUrl = publishedUrl ?? ""
        if (currentPublishedUrl.length > 0) {
            const publishedHtml = await fetchPublishedHtml(currentPublishedUrl)
            const publishedForms = extractPublishedFormTargets(publishedHtml)
            const framerFormCandidates = await buildFramerFormCandidates(nodes)
            publishedFormMatches = resolvePublishedFormsToFramerNodes(publishedForms, framerFormCandidates)

            for (const match of publishedFormMatches) {
                if (match.node !== null) {
                    detectedFormRoots.set(match.node!.id, match.node!)
                }
            }
        }
    } catch {
        // If published fetch/mapping fails (e.g., CORS), continue with fallback local detection.
    }

    // 2) Fallback local detection to avoid empty results when publish mapping is unavailable.
    if (detectedFormRoots.size === 0) {
        const allNodesToCheck = [
            ...(nodes.frameNodes as ReadonlyArray<AnyNode>),
            ...(nodes.componentNodes as ReadonlyArray<AnyNode>),
        ]

        for (const node of allNodesToCheck) {
            if (seen.has(node.id)) continue
            seen.add(node.id)

            if (nodes.nodesInNonPrimaryVariants.has(node.id)) continue
            if (nodes.nodesInNonFirstBreakpoints.has(node.id)) continue

            const isForm = await hasFormStructure(node)
            if (!isForm) continue

            // Detection found this node. If it's a button, use its parent as the form root.
            const nodeAny = node as Record<string, unknown>
            const compName = String(nodeAny.componentName ?? "").toLowerCase()
            const htmlTagLocal = String(nodeAny.__htmlTag ?? "").toLowerCase()
            const isButton = htmlTagLocal === "button" || compName.includes("button")

            if (isButton) {
                try {
                    const parent = await framer.getParent(node.id)
                    if (parent === null) {
                        continue
                    }
                    const parentNode = parent as AnyNode
                    if (!detectedFormRoots.has(parentNode.id)) {
                        detectedFormRoots.set(parentNode.id, parentNode)
                    }
                } catch {
                    // ignore
                }
            } else {
                detectedFormRoots.set(node.id, node)
            }
        }
    }

    // Build a map from Framer node ID → hasConfiguredDestination using the published HTML signals.
    // This is the primary source of truth since the Framer Plugin API does not expose sendTo values.
    const publishedDestinationByNodeId = new Map<string, boolean>()
    for (const match of publishedFormMatches) {
        if (match.node !== null) {
            publishedDestinationByNodeId.set(match.node!.id, match.target.hasConfiguredDestination)
        }
    }

    const detectedForms = Array.from(detectedFormRoots.values())
    for (const formNode of detectedForms) {
        const publishedResult = publishedDestinationByNodeId.get(formNode.id)
        // Only flag when we positively confirmed no destination in the published HTML.
        // If the form wasn't mapped (undefined), we can't tell — skip it.
        if (publishedResult === false) {
            flagged.push({ label: `${getNodeName(formNode)}: Missing send-to destination`, nodeId: formNode.id as string })
        }
    }

    if (detectedForms.length === 0) {
        if (publishedUrl) {
            return makeCheck(id, label, "warning", "No form roots mapped from published HTML to Framer nodes. Ensure forms are published and reachable from the current URL.", [], true)
        }
        return makeCheck(id, label, "warning", "No forms detected. Publish your site to enable published->Framer mapping, or expose form metadata (__htmlTag='form', sendTo/onSubmit controls).", [], true)
    }

    if (flagged.length === 0) {
        const mappedCount = publishedFormMatches.filter((m) => m.node !== null).length
        const publishedCount = publishedFormMatches.length
        if (publishedCount > 0) {
            return makeCheck(id, label, "pass", `All ${detectedForms.length} mapped form(s) have a send-to destination configured (${mappedCount}/${publishedCount} published forms mapped)`, [], true)
        }
        return makeCheck(id, label, "pass", `All ${detectedForms.length} detected form(s) have a send-to destination configured`, [], true)
    }
    const unresolvedPublishedForms = publishedFormMatches.filter((m) => m.node === null).length
    const unresolvedSuffix = unresolvedPublishedForms > 0
        ? `; ${unresolvedPublishedForms} published form(s) could not be mapped to Framer nodes`
        : ""
    return makeCheck(id, label, "warning", `${flagged.length} of ${detectedForms.length} detected form(s) are missing send-to destination${unresolvedSuffix}`, flagged, true)
}

async function checkNavFooterTags(nodes: AllNodes): Promise<CheckResult> {
    const id = "nav-footer-tags"
    const label = "Nav & Footer Tags"
    const flagged: Array<CheckItem> = []

    if (nodes.pages.length === 0) {
        return skipCheck(id, label, "No pages found")
    }

    const pageAudits = await getPublishedTagAuditsByPage(nodes)
    const successfulAudits = pageAudits.filter((audit) => audit.tagInfo !== null)

    for (const audit of successfulAudits) {
        const tagInfo = audit.tagInfo as PublishedTagInfo
        const missingParts: string[] = []
        if (!tagInfo.hasNav) missingParts.push("Nav")
        if (!tagInfo.hasFooter) missingParts.push("Footer")
        if (missingParts.length > 0) {
            flagged.push({ label: `'${audit.pageName}': Missing ${missingParts.join(" and ")} tag`, nodeId: audit.frameNodeId })
        }
    }

    if (successfulAudits.length === 0) {
        const firstError = pageAudits.find((audit) => audit.error !== null)?.error
        const detail = firstError
            ? `Could not fetch published page HTML tags. ${firstError}`
            : "Could not fetch published page HTML tags for any page."
        return makeCheck(id, label, "warning", detail, [], true)
    }
    if (flagged.length === 0) {
        return makeCheck(id, label, "pass", `All ${successfulAudits.length} page(s) have <nav> and <footer> tags`, [], true)
    }
    return makeCheck(id, label, "warning", `${flagged.length} page(s) missing nav or footer tag`, flagged, true)
}


async function checkTagChecker(nodes: AllNodes): Promise<CheckResult> {
    const id = "tag-checker"
    const label = "Tag Checker"
    const flagged: Array<CheckItem> = []

    const pageAudits = await getPublishedTagAuditsByPage(nodes)
    const successfulAudits = pageAudits.filter((audit) => audit.tagInfo !== null)

    for (const audit of successfulAudits) {
        const tagInfo = audit.tagInfo as PublishedTagInfo
        const bodyStructure = tagInfo.bodyStructure
        if (bodyStructure.length === 0) continue

        const frameNode = await framer.getNode(audit.frameNodeId).catch(() => null)
        const orderedImmediateChildren = frameNode
            ? (await (frameNode as AnyNode).getChildren().catch(() => []) as ReadonlyArray<AnyNode>)
            : []

        const filteredImmediateChildren = orderedImmediateChildren.filter((node) => {
            if (nodes.nodesInNonFirstBreakpoints.has(node.id)) return false
            if (nodes.nodesInNonPrimaryVariants.has(node.id)) return false
            return true
        })

        for (let index = 0; index < bodyStructure.length; index++) {
            const tag = bodyStructure[index]
            if (tag !== "div") continue

            const matchedNode = filteredImmediateChildren[index] ?? null
            flagged.push({
                label: `'${audit.pageName}': Immediate body child #${index + 1} is <div>; set a semantic tag`,
                nodeId: matchedNode?.id ?? audit.frameNodeId,
            })
        }
    }

    if (successfulAudits.length === 0) {
        const firstError = pageAudits.find((audit) => audit.error !== null)?.error
        const detail = firstError
            ? `Could not fetch published page HTML tags. ${firstError}`
            : "Could not fetch published page HTML tags for any page."
        return makeCheck(id, label, "warning", detail, [], true)
    }
    if (flagged.length === 0) {
        return makeCheck(id, label, "pass", `All ${successfulAudits.length} page(s) use semantic tags for immediate body children`, [], true)
    }
    return makeCheck(id, label, "warning", `${flagged.length} immediate body child tag issue(s) found`, flagged, true)
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
    const label = "Empty Link Variables"

    function isEmptyLinkValue(value: unknown): boolean {
        if (value === undefined || value === null) return true
        if (typeof value === "string") return value.trim().length === 0

        if (typeof value !== "object") return false
        const record = value as Record<string, unknown>

        // Check proper Link structure: {type: "url", url: string} or {type: "webPage", webPageId: string}
        const type = record.type

        if (type === "url") {
            const url = record.url
            return typeof url !== "string" || url.trim().length === 0
        }

        if (type === "webPage") {
            const webPageId = record.webPageId
            return typeof webPageId !== "string" || webPageId.trim().length === 0
        }

        if (type === "link") {
            if ("value" in record) return isEmptyLinkValue(record.value)
            return isEmptyLinkValue({
                url: record.url,
                href: record.href,
                path: record.path,
                pageId: record.pageId,
                webPageId: record.webPageId,
            })
        }

        if ("url" in record) {
            return typeof record.url !== "string" || record.url.trim().length === 0
        }
        if ("href" in record) {
            return typeof record.href !== "string" || record.href.trim().length === 0
        }
        if ("path" in record) {
            return typeof record.path !== "string" || record.path.trim().length === 0
        }
        if ("webPageId" in record) {
            return typeof record.webPageId !== "string" || record.webPageId.trim().length === 0
        }
        if ("pageId" in record) {
            return typeof record.pageId !== "string" || record.pageId.trim().length === 0
        }
        if ("value" in record) {
            return isEmptyLinkValue(record.value)
        }

        // Non-link objects should not be treated as empty links.
        return false
    }

    // Scan component instances only from the first breakpoint frame
    const flagged: Array<CheckItem> = []
    const flaggedComponentIds = new Set<string>()

    for (const node of nodes.componentNodes) {
        const nodeId = (node as AnyNode).id as string
        // Skip nodes in non-first breakpoint frames
        if (nodes.nodesInNonFirstBreakpoints.has(nodeId)) continue
        // Skip nodes inside component definitions (the components folder)
        if (nodes.nodesInAnyVariant.has(nodeId)) continue

        const explicitLinkCandidates: unknown[] = []

        if ((node as AnyNode).link !== undefined) {
            explicitLinkCandidates.push((node as AnyNode).link)
        }

        const typedControls = ((node as AnyNode).typedControls ?? {}) as Record<string, unknown>
        for (const control of Object.values(typedControls)) {
            if (typeof control !== "object" || control === null) continue
            const record = control as Record<string, unknown>
            const typeValue = typeof record.type === "string" ? record.type.toLowerCase() : ""
            if (typeValue === "link" || typeValue === "url" || typeValue === "webpage") {
                explicitLinkCandidates.push("value" in record ? record.value : record)
            }
        }

        const controls = ((node as AnyNode).controls ?? {}) as Record<string, unknown>
        for (const control of Object.values(controls)) {
            if (typeof control !== "object" || control === null) continue
            const record = control as Record<string, unknown>
            const typeValue = typeof record.type === "string" ? record.type.toLowerCase() : ""
            if (typeValue === "link" || typeValue === "url" || typeValue === "webpage") {
                explicitLinkCandidates.push("value" in record ? record.value : record)
            }
        }

        const collectStructuredLinks = (input: unknown, depth: number, seen: WeakSet<object>): void => {
            if (depth > 6 || input === null || input === undefined) return
            if (typeof input !== "object") return

            const obj = input as object
            if (seen.has(obj)) return
            seen.add(obj)

            if (Array.isArray(input)) {
                for (const entry of input) collectStructuredLinks(entry, depth + 1, seen)
                return
            }

            const record = input as Record<string, unknown>
            const typeValue = typeof record.type === "string" ? record.type.toLowerCase() : ""
            const isLinkType = typeValue === "link" || typeValue === "url" || typeValue === "webpage"
            const hasExplicitLinkFields = "url" in record || "href" in record || "path" in record || "webPageId" in record || "pageId" in record
            if (isLinkType || hasExplicitLinkFields) {
                explicitLinkCandidates.push("value" in record ? record.value : record)
            }

            for (const nested of Object.values(record)) {
                collectStructuredLinks(nested, depth + 1, seen)
            }
        }

        const seen = new WeakSet<object>()
        collectStructuredLinks((node as AnyNode).props, 0, seen)
        collectStructuredLinks((node as AnyNode).properties, 0, seen)
        collectStructuredLinks((node as AnyNode).componentProperties, 0, seen)

        const hasEmptyLink = explicitLinkCandidates.some((candidate) => isEmptyLinkValue(candidate))

        if (hasEmptyLink && !flaggedComponentIds.has(nodeId)) {
            flagged.push({ label: getNodeName(node as AnyNode), nodeId })
            flaggedComponentIds.add(nodeId)
        }
    }

    if (flagged.length === 0) {
        return makeCheck(id, label, "pass", "No components with empty link variables", [], true)
    }
    return makeCheck(id, label, "warning", `${flagged.length} component(s) have an empty link variable`, flagged, true)
}

async function checkLinksTo404Page(nodes: AllNodes): Promise<CheckResult> {
    const id = "links-to-404"
    const label = "Links to 404 Page"

    const page404 = nodes.pages.find((page) => {
        const path = typeof page.path === "string" ? page.path : ""
        const name = typeof page.name === "string" ? page.name : ""
        return /404/i.test(path) || /404/i.test(name)
    })

    const page404Id = page404 ? (page404.id as string) : null
    const page404Path = page404
        ? (typeof page404.path === "string" ? page404.path : "").toLowerCase().replace(/^\//, "")
        : null

    function linksTo404(value: unknown): boolean {
        if (typeof value === "string") {
            if (page404Path === null) return false
            const normalized = value.toLowerCase().replace(/^\//, "")
            return normalized === page404Path
        }
        if (typeof value !== "object" || value === null) return false
        const record = value as Record<string, unknown>
        // Internal page link: { pageId: "..." }
        if (page404Id && record.pageId === page404Id) return true
        // Component link control: { type: "webPage", webPageId: "..." }
        if (page404Id && record.type === "webPage" && record.webPageId === page404Id) return true
        return false
    }

    const flagged: Array<CheckItem> = []
    const flaggedIds = new Set<string>()

    const allNodes = [
        ...(nodes.frameNodes as ReadonlyArray<AnyNode>),
        ...nodes.textNodes,
        ...nodes.componentNodes,
    ]

    for (const node of allNodes) {
        const nodeId = node.id as string
        if (flaggedIds.has(nodeId)) continue
        if (nodes.nodesInNonFirstBreakpoints.has(nodeId)) continue
        if (nodes.nodesInAnyVariant.has(nodeId)) continue
        const links = collectNodeLinkValues(node)
        for (const linkValue of links) {
            if (!linksTo404(linkValue)) continue
            flagged.push({ label: getNodeName(node), nodeId })
            flaggedIds.add(nodeId)
            break
        }
    }

    if (flagged.length === 0) {
        return makeCheck(id, label, "pass", "No elements link to the 404 page", [], true)
    }
    return makeCheck(id, label, "fail", `${flagged.length} element(s) link to the 404 page`, flagged, true)
}

// ---------------------------------------------------------------------------
// LAYOUT CHECKS (2)
// ---------------------------------------------------------------------------

async function checkResponsiveLayout(nodes: AllNodes): Promise<CheckResult> {
    const id = "responsive-layout"
    const label = "Fixed Widths"
    const fixed: Array<CheckItem> = []
    const seenNames = new Set<string>()

    function isFlexibleWidthValue(value: unknown): boolean {
        if (typeof value !== "string") return false
        const normalized = value.trim().toLowerCase()
        if (normalized.length === 0) return false
        if (normalized === "auto" || normalized === "fit-content" || normalized === "fill" || normalized === "fill-container") return true
        if (/^-?\d+(?:\.\d+)?fr$/.test(normalized)) return true
        if (normalized.includes("fr")) return true
        if (normalized.includes("%")) return true
        return false
    }

    function hasFlexibleWidthSizingHint(frameAny: AnyNode): boolean {
        if (isFlexibleWidthValue(frameAny.width)) return true

        const sizingHints: unknown[] = [
            frameAny.widthType,
            frameAny.widthSizing,
            frameAny.horizontalSizing,
            (frameAny.sizing as Record<string, unknown> | undefined)?.horizontal,
            (frameAny.layout as Record<string, unknown> | undefined)?.horizontalSizing,
            (frameAny.constraints as Record<string, unknown> | undefined)?.horizontal,
        ]

        return sizingHints.some((hint) => {
            if (typeof hint !== "string") return false
            const normalized = hint.trim().toLowerCase()
            return normalized.includes("auto") || normalized.includes("hug") || normalized.includes("fill") || normalized.includes("fr")
        })
    }
    
    // Build a set of frameNode IDs to check if parents are frames
    const frameNodeIds = new Set<string>()
    for (const frame of nodes.frameNodes) {
        frameNodeIds.add(frame.id)
    }

    for (const frame of nodes.contentFrameNodes) {
        const frameAny = frame as AnyNode
        // Skip breakpoint frames themselves (desktop/tablet/mobile containers)
        if (nodes.breakpointFrameIds.has(frame.id)) continue
        // Skip non-primary variant frames (additional variants of a component)
        if (nodes.nodesInNonPrimaryVariants.has(frame.id)) continue
        // Skip elements whose parent is not a frame (e.g., root variant frames = direct children of components)
        const parentId = nodes.frameParentIdMap.get(frame.id)
        if (!parentId || !frameNodeIds.has(parentId)) continue

        // Skip elements with max/min width constraints — those are intentional, not "fixed"
        if (frameAny.maxWidth != null || frameAny.minWidth != null) continue
        if (hasFlexibleWidthSizingHint(frameAny)) continue

        const width = frameAny.width
        if (typeof width !== "string") continue
        const pxMatch = width.match(/^(\d+(?:\.\d+)?)px$/)
        if (!pxMatch) continue
        const pxValue = parseFloat(pxMatch[1])
        if (pxValue <= 100) continue

        // Deduplicate by frame name — only report each frame name once
        const frameName = getNodeName(frameAny)
        if (seenNames.has(frameName)) continue
        seenNames.add(frameName)

        fixed.push(withFramePageLabel(nodes, { label: frameName, nodeId: frame.id }, frame.id))
    }

    if (fixed.length === 0) {
        return makeCheck(id, label, "pass", "All elements use responsive layout", [], true)
    }
    return makeCheck(id, label, "warning", `${fixed.length} elements have fixed pixel widths`, fixed, true)
}

async function checkAutoHeight(nodes: AllNodes): Promise<CheckResult> {
    const id = "auto-height"
    const label = "Fixed Heights"
    const fixed: Array<CheckItem> = []
    const seenNames = new Set<string>()
    
    // Build a set of frameNode IDs to check if parents are frames
    const frameNodeIds = new Set<string>()
    for (const frame of nodes.frameNodes) {
        frameNodeIds.add(frame.id)
    }

    for (const frame of nodes.contentFrameNodes) {
        const frameAny = frame as AnyNode
        // Skip breakpoint frames themselves
        if (nodes.breakpointFrameIds.has(frame.id)) continue
        // Skip non-primary variant frames (additional variants of a component)
        if (nodes.nodesInNonPrimaryVariants.has(frame.id)) continue
        // Skip elements whose parent is not a frame (e.g., root variant frames = direct children of components)
        const parentId = nodes.frameParentIdMap.get(frame.id)
        if (!parentId || !frameNodeIds.has(parentId)) continue

        const height = frameAny.height
        if (typeof height !== "string") continue
        // "fit-content" = auto/hug; pixel strings = fixed
        if (height === "fit-content") continue
        if (!/^\d+(?:\.\d+)?px$/.test(height)) continue

        // Deduplicate by frame name — only report each frame name once
        const frameName = getNodeName(frameAny)
        if (seenNames.has(frameName)) continue
        seenNames.add(frameName)

        fixed.push(withFramePageLabel(nodes, { label: frameName, nodeId: frame.id, locked: isLockedNode(frameAny) }, frame.id))
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
    const styleSuffixes = new Set([
        "thin", "extralight", "ultralight", "light", "regular", "book", "normal", "medium",
        "semibold", "demibold", "bold", "extrabold", "ultrabold", "black", "heavy",
        "italic", "oblique", "variable", "roman",
    ])

    function normalizeFontFamilyName(fontName: string): string {
        return fontName
            .normalize("NFKC")
            .trim()
            .toLowerCase()
            .replace(/[-_]+/g, " ")
            .replace(/\s+/g, " ")
    }

    function canonicalFontFamilyName(fontName: string): string {
        const normalized = normalizeFontFamilyName(fontName)
        if (!normalized) return normalized
        const parts = normalized.split(" ")
        while (parts.length > 1 && styleSuffixes.has(parts[parts.length - 1])) {
            parts.pop()
        }
        return parts.join(" ")
    }

    const nativeFamilies = new Set<string>()
    const nativeFamiliesCompact = new Set<string>()
    for (const f of FRAMER_NATIVE_FONTS) {
        const canonical = canonicalFontFamilyName(f)
        nativeFamilies.add(canonical)
        nativeFamiliesCompact.add(canonical.replace(/\s+/g, ""))
    }

    for (const node of nodes.textNodes) {
        const html = await getNodeHTML(node)
        const family = extractFontFamilyFromHTML(html)
        let externalFamily: string | null = null

        function isFramerDefaultFamily(fontName: string): boolean {
            const normalized = normalizeFontFamilyName(fontName)
            const canonical = canonicalFontFamilyName(fontName)
            const compact = canonical.replace(/\s+/g, "")
            if (canonical === "inter") return true
            if (nativeFamilies.has(canonical)) return true
            if (nativeFamiliesCompact.has(compact)) return true
            if (normalized.startsWith("__framer")) return true
            if (normalized.startsWith("framer")) return true
            if (normalized.startsWith("var(--")) return true
            return false
        }

        if (family) {
            const families = family.split(",").map((f) => normalizeFontFamilyName(f.replace(/['"]/g, "")))
            for (const f of families) {
                if (f.length > 0 && !isFramerDefaultFamily(f)) {
                    externalFamily = f
                    break
                }
            }
        } else {
            const font = node.font as Record<string, unknown> | undefined
            if (font && typeof font.family === "string") {
                const f = normalizeFontFamilyName(font.family)
                if (f.length > 0 && !isFramerDefaultFamily(f)) {
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
    return makeCheck(id, label, "warning", `${detectedFontNames.size} non-default font(s) in ${items.length} layers — use Framer default fonts only: ${Array.from(detectedFontNames).join(", ")}`, items, true)
}

// ---------------------------------------------------------------------------
// PERFORMANCE (2)
// ---------------------------------------------------------------------------

async function checkPageSettings(_nodes: AllNodes): Promise<CheckResult> {
    const id = "page-settings"
    const label = "Publish Metadata"
    const missingMetadataItems: Array<CheckItem> = []

    let publishInfo: PublishInfo | null = null
    try {
        publishInfo = await framer.getPublishInfo()
    } catch {
        return skipCheck(id, label, "Cannot access published site info via the plugin API. Publish the site and rerun the URL metadata check.")
    }

    const environments = getPublishedEnvironmentUrls(publishInfo)
    if (environments.length === 0) {
        return makeCheck(
            id,
            label,
            "fail",
            "Site has not been published yet. Publish the site to verify favicon, social preview, site title, and site description.",
            [
                { label: "Favicon not set", nodeId: null, badge: "unpublished" },
                { label: "Social preview not set", nodeId: null, badge: "unpublished" },
                { label: "Site title not set", nodeId: null, badge: "unpublished" },
                { label: "Site description not set", nodeId: null, badge: "unpublished" },
            ],
            true,
        )
    }

    const targetEnvironment = environments.find((entry) => entry.environment === "production") ?? environments[0]

    let metadata: PublishedMetadataInfo
    try {
        metadata = await fetchPublishedMetadataInfo(targetEnvironment.url)
    } catch (error: unknown) {
        const message = error instanceof Error && error.message.trim().length > 0
            ? error.message.trim()
            : "URL metadata provider request failed"
        return makeCheck(
            id,
            label,
            "warning",
            `Could not inspect published metadata in ${targetEnvironment.environment}. This usually means cross-origin fetch is blocked (CORS) or the environment requires access/authentication.`,
            [{ label: `Could not inspect URL metadata: ${message}`, nodeId: null, badge: targetEnvironment.environment }],
            true,
        )
    }

    if (!metadata.hasFavicon) {
        missingMetadataItems.push({ label: "Favicon not set", nodeId: null, badge: targetEnvironment.environment })
    }
    if (!metadata.hasSocialPreview) {
        missingMetadataItems.push({ label: "Social preview not set", nodeId: null, badge: targetEnvironment.environment })
    }
    if (metadata.hasDefaultTitle) {
        missingMetadataItems.push({ label: "Site title is still default (Home)", nodeId: null, badge: targetEnvironment.environment })
    } else if (!metadata.hasTitle) {
        missingMetadataItems.push({ label: "Site title not set", nodeId: null, badge: targetEnvironment.environment })
    }
    if (!metadata.hasDescription) {
        missingMetadataItems.push({ label: "Site description not set", nodeId: null, badge: targetEnvironment.environment })
    }

    if (missingMetadataItems.length === 0) {
        return makeCheck(id, label, "pass", `Favicon, social preview, site title, and site description are set in ${targetEnvironment.environment}.`, [], true)
    }

    return makeCheck(
        id,
        label,
        "fail",
        `${missingMetadataItems.length} publish metadata issue(s) found in ${targetEnvironment.environment}.`,
        missingMetadataItems,
        true,
    )
}

function parsePageSpeedStrategy(result: any, publishedUrl: string): PageSpeedStrategyData | null {
    const lighthouse = result?.lighthouseResult
    if (!lighthouse) return null

    const audits = lighthouse.audits || {}
    const cats = lighthouse.categories || {}

    const metricDefs = [
        { key: "first-contentful-paint", label: "First Paint" },
        { key: "largest-contentful-paint", label: "Largest Paint" },
        { key: "total-blocking-time", label: "Total Blocking Time" },
        { key: "cumulative-layout-shift", label: "Layout Shift" },
    ]
    const metrics: PageSpeedMetric[] = metricDefs.map(m => {
        const audit = audits[m.key]
        return {
            label: m.label,
            value: audit?.displayValue ?? "N/A",
            score: typeof audit?.score === "number" ? audit.score : null,
        }
    })

    return {
        performance: typeof cats.performance?.score === "number" ? cats.performance.score : null,
        accessibility: typeof cats.accessibility?.score === "number" ? cats.accessibility.score : null,
        bestPractices: typeof cats["best-practices"]?.score === "number" ? cats["best-practices"].score : null,
        seo: typeof cats.seo?.score === "number" ? cats.seo.score : null,
        metrics,
        publishedUrl,
    }
}

async function fetchPageSpeedStrategy(url: string, strategy: "desktop" | "mobile", apiKey: string): Promise<any> {
    const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&key=${apiKey}`
    const response = await fetch(apiUrl)
    if (!response.ok) {
        let apiError: any = null
        try { apiError = await response.json() } catch {}
        if (response.status === 429) throw new Error("Google PageSpeed API rate limit reached. Please try again later or use pagespeed.web.dev manually.")
        if (apiError?.error?.message) throw new Error(`PageSpeed API error: ${apiError.error.message}`)
        throw new Error(`Could not fetch PageSpeed results for ${url}. HTTP ${response.status}`)
    }
    return response.json()
}

async function checkGooglePageSpeed(_nodes: AllNodes): Promise<CheckResult> {
    const id = "google-pagespeed"
    const label = "Google PageSpeed"
    const framerAny = (framer as unknown) as Record<string, unknown>

    if (typeof framerAny.getPublishInfo !== "function") {
        return skipCheck(id, label, "Cannot access published site info via the plugin API. Run PageSpeed manually at pagespeed.web.dev.")
    }

    let publishInfo: any = null
    try {
        publishInfo = await (framerAny.getPublishInfo as () => Promise<any>)()
    } catch {
        return skipCheck(id, label, "Could not retrieve published site info. Run PageSpeed manually at pagespeed.web.dev.")
    }

    let publishedUrl: string | undefined = undefined
    if (publishInfo) {
        if (typeof publishInfo === "string") {
            publishedUrl = publishInfo.trim()
        } else if (typeof publishInfo === "object") {
            if (publishInfo.production) {
                if (typeof publishInfo.production.url === "string" && publishInfo.production.url.trim().length > 0) {
                    publishedUrl = publishInfo.production.url.trim()
                } else if (typeof publishInfo.production.currentPageUrl === "string" && publishInfo.production.currentPageUrl.trim().length > 0) {
                    publishedUrl = publishInfo.production.currentPageUrl.trim()
                }
            }
            if (!publishedUrl && publishInfo.staging) {
                if (typeof publishInfo.staging.url === "string" && publishInfo.staging.url.trim().length > 0) {
                    publishedUrl = publishInfo.staging.url.trim()
                } else if (typeof publishInfo.staging.currentPageUrl === "string" && publishInfo.staging.currentPageUrl.trim().length > 0) {
                    publishedUrl = publishInfo.staging.currentPageUrl.trim()
                }
            }
        }
    }

    if (!publishedUrl || !/^https?:\/\//.test(publishedUrl)) {
        return makeCheck(id, label, "warning", "Site is not published or no valid published URL found. Publish your site to run Google PageSpeed.", [], true)
    }

    const cacheKey = `pagespeed2:${publishedUrl}`
    if (!(window as any)._pageSpeedCache) (window as any)._pageSpeedCache = {}
    const cache = (window as any)._pageSpeedCache
    if (cache[cacheKey]) {
        const cached = cache[cacheKey]
        if (cached.error) return makeCheck(id, label, "warning", cached.error, [], true)
        const perfScore = cached.pageSpeedData?.desktop?.performance ?? cached.pageSpeedData?.mobile?.performance ?? null
        const status: CheckStatus = perfScore === null ? "warning" : perfScore >= 0.9 ? "pass" : perfScore >= 0.5 ? "warning" : "fail"
        return { id, label, status, detail: `PageSpeed scores for ${publishedUrl}`, items: [], isProgrammatic: true, pageSpeedData: cached.pageSpeedData }
    }

    const PAGE_SPEED_API_KEY = "AIzaSyDZViYdQWJ_QQdTfaLqekSrtmAFc70Xoys"

    let desktopResult: any = null
    let mobileResult: any = null
    try {
        const [d, m] = await Promise.all([
            fetchPageSpeedStrategy(publishedUrl, "desktop", PAGE_SPEED_API_KEY),
            fetchPageSpeedStrategy(publishedUrl, "mobile", PAGE_SPEED_API_KEY),
        ])
        desktopResult = d
        mobileResult = m
    } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : `Could not fetch PageSpeed results for ${publishedUrl}.`
        cache[cacheKey] = { error: errorMsg }
        return makeCheck(id, label, "warning", errorMsg, [], true)
    }

    const pageSpeedData: PageSpeedData = {
        desktop: parsePageSpeedStrategy(desktopResult, publishedUrl),
        mobile: parsePageSpeedStrategy(mobileResult, publishedUrl),
    }
    cache[cacheKey] = { pageSpeedData }

    const perfScore = pageSpeedData.desktop?.performance ?? pageSpeedData.mobile?.performance ?? null
    const status: CheckStatus = perfScore === null ? "warning" : perfScore >= 0.9 ? "pass" : perfScore >= 0.5 ? "warning" : "fail"
    return { id, label, status, detail: `PageSpeed scores for ${publishedUrl}`, items: [], isProgrammatic: true, pageSpeedData }
}

// ---------------------------------------------------------------------------
// NEW CHECKS
// ---------------------------------------------------------------------------

async function checkActiveLinks(nodes: AllNodes): Promise<CheckResult> {
    const id = "active-links"
    const label = "Text Mismatch"

    function normalizeInternalPath(path: string): string {
        const trimmed = path.trim()
        if (trimmed.length === 0) return ""

        let normalized = trimmed
        if (!normalized.startsWith("/")) normalized = `/${normalized}`
        normalized = normalized.split("#")[0].split("?")[0]
        normalized = normalized.replace(/\/+/g, "/")
        if (normalized.length > 1 && normalized.endsWith("/")) {
            normalized = normalized.slice(0, -1)
        }
        return normalized
    }

    function tokenizeSectionWords(value: string): string[] {
        return value
            .trim()
            .toLowerCase()
            .replace(/^[#/]+/, "")
            .split(/[-_\s/]+/)
            .map((word) => word.trim())
            .filter((word) => word.length > 1)
    }

    type InternalLinkData = {
        readonly path: string
        readonly sectionWords: ReadonlyArray<string>
    }

    function getInternalLinkData(node: AnyNode): InternalLinkData | null {
        function fromUnknown(value: unknown): InternalLinkData | null {
            if (typeof value === "string") {
                const trimmed = value.trim()
                if (trimmed.length === 0) return null

                const [pathPart, hashPart] = trimmed.split("#", 2)
                const normalized = normalizeInternalPath(pathPart)
                if (normalized.startsWith("/") && !normalized.startsWith("//")) {
                    return {
                        path: normalized,
                        sectionWords: hashPart ? tokenizeSectionWords(hashPart) : [],
                    }
                }
                return null
            }
            if (typeof value !== "object" || value === null) return null

            const record = value as Record<string, unknown>

            if (typeof record.pageId === "string") {
                const page = nodes.pages.find((p) => p.id === record.pageId)
                if (page && typeof (page as AnyNode).path === "string") {
                    const sectionRaw = [record.section, record.anchor, record.hash, record.fragment, record.targetId]
                        .find((entry) => typeof entry === "string") as string | undefined
                    return {
                        path: normalizeInternalPath((page as AnyNode).path as string),
                        sectionWords: sectionRaw ? tokenizeSectionWords(sectionRaw) : [],
                    }
                }
            }

            for (const candidate of [record.path, record.url, record.href, record.slug, record.value]) {
                if (typeof candidate !== "string") continue
                const [candidatePath, candidateHash] = candidate.split("#", 2)
                const normalized = normalizeInternalPath(candidatePath)
                if (normalized.startsWith("/") && !normalized.startsWith("//")) {
                    return {
                        path: normalized,
                        sectionWords: candidateHash ? tokenizeSectionWords(candidateHash) : [],
                    }
                }
            }

            return null
        }

        const rawLink = node.link
        const direct = fromUnknown(rawLink)
        if (direct) return direct

        const typedControls = (node.typedControls ?? {}) as Record<string, { type?: string; value?: unknown } | undefined>
        for (const [key, control] of Object.entries(typedControls)) {
            if (!control) continue
            if (control.type === "link" || /link/i.test(key)) {
                const parsed = fromUnknown(control.value)
                if (parsed) return parsed
            }
        }

        const controls = (node.controls ?? {}) as Record<string, unknown>
        for (const [key, raw] of Object.entries(controls)) {
            if (/link/i.test(key)) {
                const parsed = fromUnknown(raw)
                if (parsed) return parsed
            }
            if (typeof raw === "object" && raw !== null) {
                const record = raw as Record<string, unknown>
                if (record.type === "link") {
                    const parsed = fromUnknown(record.value)
                    if (parsed) return parsed
                }
            }
        }

        function searchInObject(input: unknown, depth: number): InternalLinkData | null {
            if (depth > 2) return null
            if (typeof input !== "object" || input === null) return null
            const record = input as Record<string, unknown>

            for (const [key, raw] of Object.entries(record)) {
                if (raw === undefined) continue

                if (/link/i.test(key)) {
                    const parsed = fromUnknown(raw)
                    if (parsed) return parsed
                    if (typeof raw === "object" && raw !== null) {
                        const rawRecord = raw as Record<string, unknown>
                        const parsedValue = fromUnknown(rawRecord.value)
                        if (parsedValue) return parsedValue
                    }
                }

                if (typeof raw === "object" && raw !== null) {
                    const nested = raw as Record<string, unknown>
                    if (nested.type === "link") {
                        const parsed = fromUnknown(nested.value)
                        if (parsed) return parsed
                    }
                    const nestedParsed = searchInObject(raw, depth + 1)
                    if (nestedParsed) return nestedParsed
                }
            }

            return null
        }

        for (const container of [node.props, node.properties, node.componentProperties]) {
            const parsed = searchInObject(container, 0)
            if (parsed) return parsed
        }

        return null
    }

    // Build page path → slug words map
    const pageSlugWords = new Map<string, string[]>()
    for (const page of nodes.pages) {
        const path = typeof (page as AnyNode).path === "string" ? (page as AnyNode).path as string : ""
        if (!path) continue
        const normalizedPath = normalizeInternalPath(path)
        const slug = normalizedPath === "/" ? "home" : normalizedPath.replace(/^\//, "").replace(/\//g, "-")
        const words = slug.split(/[-_\s]+/).filter((w) => w.length > 1)
        pageSlugWords.set(normalizedPath, words.length > 0 ? words : ["home"])
    }

    const flagged: Array<CheckItem> = []
    let checkedCount = 0

    async function checkNode(node: AnyNode, useNodeText: boolean): Promise<void> {
        // Only check nodes in the primary breakpoint and primary variant
        if (nodes.nodesInNonFirstBreakpoints.has(node.id)) return
        if (nodes.nodesInNonPrimaryVariants.has(node.id)) return
        const linkData = getInternalLinkData(node)
        if (!linkData) return

        checkedCount++

        const slugWords = pageSlugWords.get(linkData.path) ?? []
        const sectionWords = linkData.sectionWords
        const wordsToMatch = Array.from(new Set([...slugWords, ...sectionWords]))

        // If we can't map to a known page and no section text is provided, we can't evaluate.
        if (wordsToMatch.length === 0) return

        const nodeText = useNodeText
            ? (await getNodeText(node)).toLowerCase().trim()
            : getNodeName(node).toLowerCase().trim()
        if (!nodeText) return

        const hasMatch = wordsToMatch.some((word) => nodeText.includes(word.toLowerCase()))
        if (!hasMatch) {
            const preview = nodeText.length > 30 ? nodeText.slice(0, 30) + "…" : nodeText
            flagged.push({ label: preview, nodeId: node.id as string })
        }
    }

    // Text nodes: use actual text content
    for (const node of nodes.textNodes as ReadonlyArray<AnyNode>) {
        await checkNode(node, true)
    }
    // Frame nodes: use node name as label proxy
    for (const node of nodes.contentFrameNodes as ReadonlyArray<AnyNode>) {
        await checkNode(node, false)
    }
    // Component instances can carry internal links via direct link props.
    for (const node of nodes.componentNodes as ReadonlyArray<AnyNode>) {
        await checkNode(node, false)
    }

    if (checkedCount === 0) {
        return makeCheck(id, label, "warning", "No internal page links found to evaluate", [], true)
    }
    if (flagged.length === 0) {
        return makeCheck(id, label, "pass", `All ${checkedCount} link(s) match their destination`, [], true)
    }
    return makeCheck(id, label, "warning", `${flagged.length} link(s) have text that doesn't match their destination`, flagged, true)
}

function checkNaming(nodes: AllNodes): CheckResult {
    const id = "naming"
    const label = "Naming"
    const DEFAULT_NAMES = new Set(["frame", "stack", "grid"])

    const flagged: Array<CheckItem> = []
    for (const frame of nodes.contentFrameNodes) {
        // Skip non-primary variant frames (additional variants of a component)
        if (nodes.nodesInNonPrimaryVariants.has(frame.id)) continue
        
        const name = (frame.name ?? "").trim()
        if (name.length > 0 && DEFAULT_NAMES.has(name.toLowerCase())) {
            flagged.push(withFramePageLabel(nodes, { label: name, nodeId: frame.id }, frame.id))
        }
    }

    if (flagged.length === 0) {
        return makeCheck(id, label, "pass", "No default Framer names found", [], true)
    }
    return makeCheck(id, label, "warning", `${flagged.length} layer(s) still use default Framer names (Frame / Stack / Grid)`, flagged, true)
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

async function checkH1Tags(nodes: AllNodes): Promise<CheckResult> {
    const id = "h1-tags"
    const label = "H1 Tags"
    const flagged: Array<CheckItem> = []

    if (nodes.pages.length === 0) {
        return skipCheck(id, label, "No pages found")
    }

    const pageAudits = await getPublishedTagAuditsByPage(nodes)
    const successfulAudits = pageAudits.filter((audit) => audit.tagInfo !== null)

    for (const audit of successfulAudits) {
        const tagInfo = audit.tagInfo as PublishedTagInfo
        if (!tagInfo.hasH1) {
            flagged.push({ label: `'${audit.pageName}': missing H1 tag`, nodeId: audit.frameNodeId })
        }
    }

    if (successfulAudits.length === 0) {
        const firstError = pageAudits.find((audit) => audit.error !== null)?.error
        const detail = firstError
            ? `Could not fetch published page HTML tags. ${firstError}`
            : "Could not fetch published page HTML tags for any page."
        return makeCheck(id, label, "warning", detail, [], true)
    }
    if (flagged.length === 0) {
        return makeCheck(id, label, "pass", `All ${successfulAudits.length} page(s) have an H1 tag`, [], true)
    }
    return makeCheck(id, label, "fail", `${flagged.length} page(s) are missing an H1 tag`, flagged, true)
}

async function checkHeadingHierarchy(nodes: AllNodes): Promise<CheckResult> {
    const id = "heading-hierarchy"
    const label = "Heading Hierarchy"
    const flagged: Array<CheckItem> = []

    if (nodes.pages.length === 0) {
        return skipCheck(id, label, "No pages found")
    }

    const pageAudits = await getPublishedTagAuditsByPage(nodes)
    const successfulAudits = pageAudits.filter((audit) => audit.tagInfo !== null)

    for (const audit of successfulAudits) {
        const tagInfo = audit.tagInfo as PublishedTagInfo
        const hierarchy = tagInfo.headingHierarchy
        if (hierarchy.length === 0) continue

        // Check if any H2 appears before the first H1
        const firstH1Index = hierarchy.findIndex((tag) => tag === "h1")
        const firstH2Index = hierarchy.findIndex((tag) => tag === "h2")

        // If H2 appears before H1 (or H1 is missing), it's a violation
        // Missing H1 is OK, but H2 before H1 is not
        if (firstH1Index !== -1 && firstH2Index !== -1 && firstH2Index < firstH1Index) {
            flagged.push({
                label: `'${audit.pageName}': <h2> appears before <h1>`,
                nodeId: audit.frameNodeId,
            })
        }
    }

    if (successfulAudits.length === 0) {
        const firstError = pageAudits.find((audit) => audit.error !== null)?.error
        const detail = firstError
            ? `Could not fetch published page HTML tags. ${firstError}`
            : "Could not fetch published page HTML tags for any page."
        return makeCheck(id, label, "warning", detail, [], true)
    }
    if (flagged.length === 0) {
        return makeCheck(id, label, "pass", "Heading hierarchy is correct on all pages", [], true)
    }
    return makeCheck(id, label, "warning", `${flagged.length} page(s) have heading hierarchy issues`, flagged, true)
}


async function checkOverflow(nodes: AllNodes): Promise<CheckResult> {
    const id = "overflow"
    const label = "Overflow"
    const flagged: Array<CheckItem> = []
    const EPSILON = 1
    const candidatesById = new Map<string, AnyNode>()
    const contentCandidates: ReadonlyArray<AnyNode> = [
        ...(nodes.contentFrameNodes as ReadonlyArray<AnyNode>),
        ...(nodes.contentTextNodes as ReadonlyArray<AnyNode>),
        ...(nodes.componentNodes as ReadonlyArray<AnyNode>),
    ]

    for (const node of contentCandidates) {
        if (nodes.nodesInNonFirstBreakpoints.has(node.id)) continue
        if (nodes.nodesInNonPrimaryVariants.has(node.id)) continue
        candidatesById.set(node.id, node)
    }

    function getSizeFromNodeValue(valueFromNode: unknown): number | null {
        if (typeof valueFromNode === "number" && Number.isFinite(valueFromNode)) return valueFromNode
        if (typeof valueFromNode === "string") {
            const pxMatch = valueFromNode.match(/^(\d+(?:\.\d+)?)px$/)
            if (pxMatch) return parseFloat(pxMatch[1])
        }
        return null
    }

    function isFixedDimensionValue(value: unknown): boolean {
        if (typeof value === "number" && Number.isFinite(value)) return true
        if (typeof value !== "string") return false
        const normalized = value.trim().toLowerCase()
        if (normalized.length === 0) return false
        return /^\d+(?:\.\d+)?px$/.test(normalized)
    }

    async function getCalculatedSize(node: AnyNode): Promise<{ width: number | null; height: number | null }> {
        const rect = await framer.getRect(node.id).catch(() => null)
        const widthFromRect = typeof rect?.width === "number" && Number.isFinite(rect.width) ? rect.width : null
        const heightFromRect = typeof rect?.height === "number" && Number.isFinite(rect.height) ? rect.height : null

        const width = widthFromRect ?? getSizeFromNodeValue(node.width)
        const height = heightFromRect ?? getSizeFromNodeValue(node.height)
        return { width, height }
    }

    for (const node of candidatesById.values()) {
        const parentNode = (await node.getParent().catch(() => null)) as AnyNode | null
        if (!parentNode) continue

        const childSize = await getCalculatedSize(node)
        const parentSize = await getCalculatedSize(parentNode)

        if (childSize.width === null || childSize.height === null || parentSize.width === null || parentSize.height === null) continue

        const canCheckWidth = isFixedDimensionValue(node.width) && isFixedDimensionValue(parentNode.width)
        const canCheckHeight = isFixedDimensionValue(node.height) && isFixedDimensionValue(parentNode.height)

        if (!canCheckWidth && !canCheckHeight) continue

        const exceedsWidth = canCheckWidth && childSize.width > parentSize.width + EPSILON
        const exceedsHeight = canCheckHeight && childSize.height > parentSize.height + EPSILON

        if (!exceedsWidth && !exceedsHeight) continue

        const dimensions: string[] = []
        if (exceedsWidth) dimensions.push("width")
        if (exceedsHeight) dimensions.push("height")

        flagged.push({
            label: `${getNodeName(node)}: exceeds parent ${dimensions.join(" and ")}`,
            nodeId: node.id,
        })
    }

    if (flagged.length === 0) {
        return makeCheck(id, label, "pass", "No nodes overflow their immediate parent bounds", [], true)
    }
    return makeCheck(id, label, "warning", `${flagged.length} node(s) overflow their immediate parent bounds`, flagged, true)
}

function checkBreakpointWidths(nodes: AllNodes): CheckResult {
    const id = "breakpoint-widths"
    const label = "Breakpoint Widths"

    if (nodes.breakpointFramesByPageId.size < 2) {
        return makeCheck(id, label, "skip", "Not enough pages to compare breakpoint widths", [], false)
    }

    const frameById = new Map<string, AnyNode>()
    for (const frame of nodes.frameNodes) {
        frameById.set(frame.id, frame as AnyNode)
    }

    // Group widths by slot index (0 = desktop, 1 = tablet, 2 = mobile, …)
    const slotWidths = new Map<number, number[]>()
    for (const frameIds of nodes.breakpointFramesByPageId.values()) {
        frameIds.forEach((frameId, slotIndex) => {
            const frame = frameById.get(frameId)
            if (!frame) return
            const w = parseFloat(frame.width as string)
            if (isNaN(w)) return
            if (!slotWidths.has(slotIndex)) slotWidths.set(slotIndex, [])
            slotWidths.get(slotIndex)!.push(w)
        })
    }

    const flagged: Array<CheckItem> = []

    for (const [slotIndex, widths] of slotWidths.entries()) {
        if (widths.length < 2) continue
        const counts = new Map<number, number>()
        for (const w of widths) counts.set(w, (counts.get(w) ?? 0) + 1)
        const majorityWidth = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0]
        const slotName = slotIndex === 0 ? "Desktop" : slotIndex === 1 ? "Tablet" : `Breakpoint ${slotIndex + 1}`

        for (const [pageId, frameIds] of nodes.breakpointFramesByPageId.entries()) {
            if (slotIndex >= frameIds.length) continue
            const frame = frameById.get(frameIds[slotIndex])
            if (!frame) continue
            const w = parseFloat(frame.width as string)
            if (!isNaN(w) && w !== majorityWidth) {
                const page = nodes.pages.find((p) => (p as AnyNode).id === pageId) as AnyNode | undefined
                const pageName = page ? (getPageDisplayLabel(page) ?? "Untitled page") : "Untitled page"
                flagged.push({
                    label: `${slotName}: ${w}px (majority: ${majorityWidth}px)`,
                    nodeId: pageId,
                    pageLabel: pageName,
                })
            }
        }
    }

    if (flagged.length === 0) {
        return makeCheck(id, label, "pass", "Breakpoint widths are consistent across pages", [], true)
    }
    return makeCheck(id, label, "warning", `${flagged.length} page(s) have inconsistent breakpoint widths`, flagged, true)
}

async function checkUnusedAssets(nodes: AllNodes): Promise<CheckResult> {
    const id = "unused-assets"
    const label = "Unused Assets"
    const flagged: Array<CheckItem> = []
    const framerAny = framer as unknown as Record<string, unknown>

    const getRegistryItemId = (value: unknown): string | null => {
        if (value === null || typeof value !== "object") return null
        const rawId = (value as Record<string, unknown>).id
        return typeof rawId === "string" && rawId.length > 0 ? rawId : null
    }

    const getRegistryItemName = (value: unknown): string => {
        if (value === null || typeof value !== "object") return "Unnamed"
        const record = value as Record<string, unknown>
        for (const key of ["name", "path", "title"]) {
            const candidate = record[key]
            if (typeof candidate === "string" && candidate.trim().length > 0) return candidate
        }
        const idValue = getRegistryItemId(value)
        return idValue ?? "Unnamed"
    }

    const collectReferencedIds = (
        sources: ReadonlyArray<unknown>,
        candidateIds: ReadonlySet<string>,
        skipRootCandidateMatches: boolean = false,
    ): ReadonlySet<string> => {
        const used = new Set<string>()
        const seenObjects = new WeakSet<object>()

        const visit = (value: unknown, isRoot: boolean): void => {
            if (value === null || value === undefined) return

            if (typeof value === "object") {
                const objectValue = value as object
                if (seenObjects.has(objectValue)) return
                seenObjects.add(objectValue)

                const maybeId = getRegistryItemId(value)
                if (maybeId !== null && candidateIds.has(maybeId) && !(isRoot && skipRootCandidateMatches)) {
                    used.add(maybeId)
                }

                if (Array.isArray(value)) {
                    for (const entry of value) visit(entry, false)
                    return
                }

                for (const nested of Object.values(value as Record<string, unknown>)) {
                    visit(nested, false)
                }
            }
        }

        for (const source of sources) {
            visit(source, true)
        }

        return used
    }

    const collectDescendantNodes = async (roots: ReadonlyArray<AnyNode>): Promise<ReadonlyArray<AnyNode>> => {
        const byId = new Map<string, AnyNode>()
        const queue: AnyNode[] = []

        for (const root of roots) {
            if (typeof root?.id !== "string") continue
            if (!byId.has(root.id)) {
                byId.set(root.id, root)
                queue.push(root)
            }
        }

        while (queue.length > 0) {
            const current = queue.shift()!
            const getChildren = (current as unknown as { getChildren?: () => Promise<ReadonlyArray<CanvasNode>> }).getChildren
            if (typeof getChildren !== "function") continue

            try {
                const children = await getChildren()
                for (const child of children) {
                    const childAny = child as AnyNode
                    if (typeof childAny?.id !== "string") continue
                    if (!byId.has(childAny.id)) {
                        byId.set(childAny.id, childAny)
                        queue.push(childAny)
                    }
                }
            } catch {
                // Continue scanning other branches.
            }
        }

        return Array.from(byId.values())
    }

    const styleSourceValuesForNode = (node: AnyNode): ReadonlyArray<unknown> => {
        const raw = node as Record<string, unknown>
        return [
            raw,
            raw.backgroundColor,
            raw.backgroundGradient,
            raw.border,
            raw.fill,
            raw.fills,
            raw.stroke,
            raw.strokes,
            raw.effects,
            raw.shadow,
            raw.textShadow,
            raw.color,
            raw.font,
            raw.decorationColor,
            raw.caretColor,
            raw.accentColor,
            raw.inlineTextStyle,
            raw.controls,
            raw.typedControls,
            raw.props,
            raw.properties,
            raw.componentProperties,
        ]
    }

    const styleSourceValuesForTextStyle = (style: unknown): ReadonlyArray<unknown> => {
        const raw = style as Record<string, unknown>
        return [
            raw,
            raw.color,
            raw.decorationColor,
            raw.font,
            raw.boldFont,
            raw.italicFont,
            raw.boldItalicFont,
            raw.breakpoints,
        ]
    }

    const styleSourceValuesForColorStyle = (style: unknown): ReadonlyArray<unknown> => {
        const raw = style as Record<string, unknown>
        return [
            raw,
            raw.light,
            raw.dark,
        ]
    }

    const normalizeColorString = (input: string): string => input.trim().toLowerCase().replace(/\s+/g, "")

    const collectColorStrings = (sources: ReadonlyArray<unknown>): ReadonlySet<string> => {
        const values = new Set<string>()
        const seenObjects = new WeakSet<object>()

        const visit = (value: unknown): void => {
            if (value === null || value === undefined) return

            if (typeof value === "string") {
                const normalized = normalizeColorString(value)
                if (normalized.startsWith("#") || normalized.startsWith("rgb(") || normalized.startsWith("rgba(") || normalized.startsWith("hsl(") || normalized.startsWith("hsla(")) {
                    values.add(normalized)
                }
                return
            }

            if (typeof value !== "object") return
            const objectValue = value as object
            if (seenObjects.has(objectValue)) return
            seenObjects.add(objectValue)

            if (Array.isArray(value)) {
                for (const entry of value) visit(entry)
                return
            }

            for (const nested of Object.values(value as Record<string, unknown>)) {
                visit(nested)
            }
        }

        for (const source of sources) visit(source)
        return values
    }

    const expandedStyleNodes = await collectDescendantNodes([
        ...(nodes.pages as ReadonlyArray<AnyNode>),
        ...(nodes.componentDefinitionNodes as ReadonlyArray<AnyNode>),
        ...(nodes.componentNodes as ReadonlyArray<AnyNode>),
        ...(nodes.frameNodes as ReadonlyArray<AnyNode>),
        ...(nodes.textNodes as ReadonlyArray<AnyNode>),
        ...(nodes.svgNodes as ReadonlyArray<AnyNode>),
    ])

    const globalVariables = await (async (): Promise<ReadonlyArray<unknown>> => {
        const maybeGetVariables = framerAny.getVariables
        if (typeof maybeGetVariables !== "function") return []
        try {
            const result = await (maybeGetVariables as () => Promise<unknown>)()
            return Array.isArray(result) ? result : []
        } catch {
            return []
        }
    })()

    const componentVariables: unknown[] = []
    for (const componentDef of nodes.componentDefinitionNodes) {
        const getVariables = (componentDef as { getVariables?: () => Promise<ReadonlyArray<unknown>> }).getVariables
        if (typeof getVariables !== "function") continue

        try {
            const vars = await getVariables()
            componentVariables.push(...vars)
        } catch {
            // Skip component definitions that do not expose variables.
        }
    }

    const extractDeclaredControlsFromCode = (content: string, controlType: "link" | "vectorSetItem"): ReadonlyArray<string> => {
        const declarations = new Set<string>()
        const sourceFile = ts.createSourceFile("code-file.tsx", content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

        const controlSignatures = controlType === "link"
            ? {
                typeValues: new Set(["link"]),
                symbolNames: new Set(["LinkControl", "LinkField", "LinkVariable"]),
            }
            : {
                typeValues: new Set(["vectorSetItem"]),
                symbolNames: new Set(["VectorSetItemControl", "VectorSetItemVariable"]),
            }

        const getPropertyNameText = (name: ts.PropertyName): string | null => {
            if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text
            if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
            if (ts.isComputedPropertyName(name)) {
                const expression = name.expression
                if (ts.isIdentifier(expression) || ts.isStringLiteral(expression) || ts.isNumericLiteral(expression)) {
                    return expression.text
                }
            }
            return null
        }

        const nodeContainsControlMarker = (node: ts.Node): boolean => {
            if (ts.isIdentifier(node) && controlSignatures.symbolNames.has(node.text)) return true
            if (ts.isPropertyAccessExpression(node) && controlSignatures.symbolNames.has(node.name.text)) return true
            if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
                return controlSignatures.typeValues.has(node.text)
            }
            if (ts.isPropertyAssignment(node)) {
                const propertyName = getPropertyNameText(node.name)
                if (propertyName === "type") {
                    const initializer = node.initializer
                    if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) {
                        return controlSignatures.typeValues.has(initializer.text)
                    }
                }
            }

            let matched = false
            node.forEachChild((child) => {
                if (matched) return
                if (nodeContainsControlMarker(child)) matched = true
            })
            return matched
        }

        const visit = (node: ts.Node): void => {
            if (ts.isPropertyAssignment(node)) {
                const propertyName = getPropertyNameText(node.name)
                if (propertyName !== null && nodeContainsControlMarker(node.initializer)) {
                    declarations.add(propertyName)
                }
            }

            node.forEachChild(visit)
        }

        visit(sourceFile)

        if (declarations.size === 0) {
            const fallbackPatterns = controlType === "link"
                ? [
                    /([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*\{[\s\S]{0,4000}?\btype\s*:\s*["']link["']/gms,
                    /([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*\{[\s\S]{0,4000}?\bLinkControl\b/gms,
                    /([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*\{[\s\S]{0,4000}?\bLinkField\b/gms,
                    /([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*\{[\s\S]{0,4000}?\bLinkVariable\b/gms,
                    /([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*LinkControl\b/gms,
                    /([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*LinkField\b/gms,
                    /([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*LinkVariable\b/gms,
                ]
                : [
                    /([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*\{[\s\S]{0,4000}?\btype\s*:\s*["']vectorSetItem["']/gms,
                    /([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*\{[\s\S]{0,4000}?\bVectorSetItemControl\b/gms,
                    /([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*\{[\s\S]{0,4000}?\bVectorSetItemVariable\b/gms,
                    /([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*VectorSetItemControl\b/gms,
                    /([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*VectorSetItemVariable\b/gms,
                ]

            for (const pattern of fallbackPatterns) {
                for (const match of content.matchAll(pattern)) {
                    const key = match[1]
                    if (typeof key === "string" && key.length > 0) declarations.add(key)
                }
            }
        }

        return Array.from(declarations)
    }

    const isEmptyLinkValueGlobal = (value: unknown): boolean => {
        if (value === undefined || value === null) return true
        if (typeof value === "string") return value.trim().length === 0
        if (typeof value !== "object") return false

        const record = value as Record<string, unknown>
        if (record.type === "url") {
            return typeof record.url !== "string" || record.url.trim().length === 0
        }
        if (record.type === "webPage") {
            return typeof record.webPageId !== "string" || record.webPageId.trim().length === 0
        }
        if ("url" in record) {
            return typeof record.url !== "string" || record.url.trim().length === 0
        }
        if ("href" in record) {
            return typeof record.href !== "string" || record.href.trim().length === 0
        }
        if ("path" in record) {
            return typeof record.path !== "string" || record.path.trim().length === 0
        }
        if ("webPageId" in record) {
            return typeof record.webPageId !== "string" || record.webPageId.trim().length === 0
        }
        if ("pageId" in record) {
            return typeof record.pageId !== "string" || record.pageId.trim().length === 0
        }
        if ("value" in record) {
            return isEmptyLinkValueGlobal(record.value)
        }
        if (Object.keys(record).length === 0) return true
        return false
    }

    const extractLinkControlEntriesGlobal = (record: Record<string, unknown>): ReadonlyArray<{ key: string; value: unknown }> => {
        const entries = new Map<string, unknown>()
        const seenObjects = new WeakSet<object>()
        const LINK_KEY_RE = /(link|href|url|destination|action|webpage|pageid)/i
        const ROOT_BAG_KEYS = new Set(["node", "typedControls", "controls", "componentProperties", "props", "properties"])

        const addEntry = (path: string, rawValue: unknown): void => {
            const normalized = path.replace(/\.(value|defaultValue)$/i, "")
            if (ROOT_BAG_KEYS.has(normalized)) return
            if (/\.(typedControls|controls|componentProperties|props|properties)$/i.test(normalized)) return
            if (!entries.has(normalized)) entries.set(normalized, rawValue)
        }

        const isLinkLikeObject = (obj: Record<string, unknown>): boolean => {
            if (obj.type === "link" || obj.type === "url" || obj.type === "webPage") return true
            return (
                "url" in obj ||
                "href" in obj ||
                "path" in obj ||
                "webPageId" in obj ||
                "pageId" in obj ||
                "link" in obj
            )
        }

        const visit = (value: unknown, path: string, depth: number): void => {
            if (depth > 6 || value === null || value === undefined) return

            if (typeof value === "object") {
                const obj = value as object
                if (seenObjects.has(obj)) return
                seenObjects.add(obj)

                if (Array.isArray(value)) {
                    for (let index = 0; index < value.length; index++) {
                        visit(value[index], `${path}[${index}]`, depth + 1)
                    }
                    return
                }

                const recordValue = value as Record<string, unknown>
                if (isLinkLikeObject(recordValue) && !ROOT_BAG_KEYS.has(path)) {
                    const v = "value" in recordValue ? recordValue.value : value
                    addEntry(path, v)
                }

                for (const [key, nested] of Object.entries(recordValue)) {
                    const nextPath = path.length > 0 ? `${path}.${key}` : key
                    if (LINK_KEY_RE.test(key)) addEntry(nextPath, nested)
                    visit(nested, nextPath, depth + 1)
                }
                return
            }

            if (typeof value === "string" && LINK_KEY_RE.test(path)) {
                addEntry(path, value)
            }
        }

        const bags: Array<{ name: string; value: unknown }> = [
            { name: "node", value: record },
            { name: "typedControls", value: record.typedControls },
            { name: "controls", value: record.controls },
            { name: "componentProperties", value: record.componentProperties },
            { name: "props", value: record.props },
            { name: "properties", value: record.properties },
        ]

        for (const bag of bags) {
            visit(bag.value, bag.name, 0)
        }

        return Array.from(entries.entries()).map(([key, value]) => ({ key, value }))
    }

    const extractVectorControlEntriesGlobal = (record: Record<string, unknown>): ReadonlyArray<{ key: string; value: unknown }> => {
        const entries = new Map<string, unknown>()
        const seenObjects = new WeakSet<object>()
        const VECTOR_KEY_RE = /(vector(set)?item|icon|glyph)/i
        const ROOT_BAG_KEYS = new Set(["node", "typedControls", "controls", "componentProperties", "props", "properties"])

        const addEntry = (path: string, rawValue: unknown): void => {
            const normalized = path.replace(/\.(value|defaultValue)$/i, "")
            if (ROOT_BAG_KEYS.has(normalized)) return
            if (/\.(typedControls|controls|componentProperties|props|properties)$/i.test(normalized)) return
            if (!entries.has(normalized)) entries.set(normalized, rawValue)
        }

        const visit = (value: unknown, path: string, depth: number): void => {
            if (depth > 6 || value === null || value === undefined) return

            if (typeof value === "object") {
                const obj = value as object
                if (seenObjects.has(obj)) return
                seenObjects.add(obj)

                if (Array.isArray(value)) {
                    for (let index = 0; index < value.length; index++) {
                        visit(value[index], `${path}[${index}]`, depth + 1)
                    }
                    return
                }

                const recordValue = value as Record<string, unknown>
                const recordType = typeof recordValue.type === "string" ? recordValue.type.toLowerCase() : ""
                if (recordType === "vectorsetitem" || recordType === "vectorset") {
                    const v = "value" in recordValue ? recordValue.value : value
                    addEntry(path, v)
                }

                for (const [key, nested] of Object.entries(recordValue)) {
                    const nextPath = path.length > 0 ? `${path}.${key}` : key
                    if (VECTOR_KEY_RE.test(key)) addEntry(nextPath, nested)
                    visit(nested, nextPath, depth + 1)
                }
                return
            }

            if (typeof value === "string" && VECTOR_KEY_RE.test(path)) {
                addEntry(path, value)
            }
        }

        const bags: Array<{ name: string; value: unknown }> = [
            { name: "node", value: record },
            { name: "typedControls", value: record.typedControls },
            { name: "controls", value: record.controls },
            { name: "componentProperties", value: record.componentProperties },
            { name: "props", value: record.props },
            { name: "properties", value: record.properties },
        ]

        for (const bag of bags) {
            visit(bag.value, bag.name, 0)
        }

        return Array.from(entries.entries()).map(([key, value]) => ({ key, value }))
    }

    const isEmptyVectorValueGlobal = (value: unknown): boolean => {
        if (value === undefined || value === null) return true
        if (typeof value === "string") return value.trim().length === 0
        if (typeof value !== "object") return false

        const record = value as Record<string, unknown>
        if (typeof record.id === "string" && record.id.trim().length > 0) return false
        if (typeof record.value === "string" && record.value.trim().length > 0) return false
        if (typeof record.insertUrl === "string" && record.insertUrl.trim().length > 0) return false
        if (typeof record.insertURL === "string" && record.insertURL.trim().length > 0) return false
        if ("value" in record) return isEmptyVectorValueGlobal(record.value)
        return Object.keys(record).length === 0
    }

    // ── 1. Unused design & package components ───────────────────────────────
    // Two identification systems exist:
    //   • Project folder (design components): matched via componentIdentifier
    //   • Framer folder (package/marketplace components): matched via insertURL,
    //     which is the stable identity Framer uses when creating instances.
    // Variants of the same component share one ComponentNode, never double-counted.
    const instancedIdentifiers = new Set<string>()
    const instancedInsertUrls = new Set<string>()
    for (const instance of nodes.componentNodes) {
        const raw = instance as Record<string, unknown>
        if (typeof raw.componentIdentifier === "string") instancedIdentifiers.add(raw.componentIdentifier)
        if (typeof raw.insertURL === "string") instancedInsertUrls.add(raw.insertURL)
    }

    // Track unused component identifiers for the image cross-check below.
    const unusedComponentIdentifiers = new Set<string>()
    for (const def of nodes.componentDefinitionNodes) {
        const raw = def as Record<string, unknown>
        const ident = raw.componentIdentifier
        const insertUrl = raw.insertURL
        const usedByIdent = typeof ident === "string" && instancedIdentifiers.has(ident)
        const usedByUrl = typeof insertUrl === "string" && instancedInsertUrls.has(insertUrl)
        if (!usedByIdent && !usedByUrl) {
            if (typeof ident === "string") unusedComponentIdentifiers.add(ident)
            flagged.push({ label: `Component '${getNodeName(def as AnyNode)}': no instances on any page`, nodeId: (def as AnyNode).id as string })
        }
    }

    // ── 2. Unused color styles ───────────────────────────────────────────────
    // A color style is "used" if its ID appears anywhere in node/style objects.
    // This covers background, border, text, fills, effects, and control bindings.
    try {
        const colorStyles = await framer.getColorStyles()
        if (colorStyles.length > 0) {
            const textStyles = await framer.getTextStyles()

            const allColorStyleIds = new Set<string>()
            for (const style of colorStyles) {
                const styleId = getRegistryItemId(style)
                if (styleId !== null) allColorStyleIds.add(styleId)
            }

            const usedColorStyleIds = new Set(collectReferencedIds(
                [
                    ...expandedStyleNodes.flatMap(styleSourceValuesForNode),
                    ...textStyles.flatMap(styleSourceValuesForTextStyle),
                    ...globalVariables,
                    ...componentVariables,
                ],
                allColorStyleIds,
            ))

            // Count style-to-style aliases while ignoring the style object itself as usage.
            const colorAliasReferencedIds = collectReferencedIds(
                [...colorStyles.flatMap(styleSourceValuesForColorStyle)],
                allColorStyleIds,
                true,
            )
            for (const styleId of colorAliasReferencedIds) usedColorStyleIds.add(styleId)

            // Fallback: some Framer contexts expose resolved color strings instead of ColorStyle IDs.
            // In that case, infer usage by matching style light/dark values against scanned color strings.
            const scannedColorStrings = collectColorStrings([
                ...expandedStyleNodes.flatMap(styleSourceValuesForNode),
                ...textStyles.flatMap(styleSourceValuesForTextStyle),
                ...colorStyles.flatMap(styleSourceValuesForColorStyle),
                ...globalVariables,
                ...componentVariables,
            ])
            let colorUsedByValue = 0
            for (const style of colorStyles) {
                const styleId = getRegistryItemId(style)
                if (styleId === null || usedColorStyleIds.has(styleId)) continue

                const record = style as unknown as Record<string, unknown>
                const candidates: string[] = []
                if (typeof record.light === "string") candidates.push(record.light)
                if (typeof record.dark === "string") candidates.push(record.dark)

                const matchesByValue = candidates.some((candidate) => scannedColorStrings.has(normalizeColorString(candidate)))
                if (matchesByValue) {
                    usedColorStyleIds.add(styleId)
                    colorUsedByValue++
                }
            }

            for (const style of colorStyles) {
                const styleId = getRegistryItemId(style)
                if (styleId !== null && !usedColorStyleIds.has(styleId)) {
                    flagged.push({ label: `Color style '${getRegistryItemName(style)}': not applied to any element`, nodeId: null })
                }
            }
        }
    } catch {
        // getColorStyles not available — skip
    }

    // ── 3. Unused text styles ────────────────────────────────────────────────
    // A text style is "used" if its ID appears in text nodes, component controls,
    // or any style references stored on nodes.
    try {
        const textStyles = await framer.getTextStyles()
        if (textStyles.length > 0) {
            const allTextStyleIds = new Set<string>()
            for (const style of textStyles) {
                const styleId = getRegistryItemId(style)
                if (styleId !== null) allTextStyleIds.add(styleId)
            }

            const usedTextStyleIds = collectReferencedIds(
                [
                    ...expandedStyleNodes.flatMap(styleSourceValuesForNode),
                    ...textStyles.flatMap(styleSourceValuesForTextStyle),
                ],
                allTextStyleIds,
            )

            for (const style of textStyles) {
                const styleId = getRegistryItemId(style)
                if (styleId !== null && !usedTextStyleIds.has(styleId)) {
                    flagged.push({ label: `Text style '${getRegistryItemName(style)}': not applied to any text node`, nodeId: null })
                }
            }
        }
    } catch {
        // getTextStyles not available — skip
    }

    // ── 4. Unused links ───────────────────────────────────────────────────────
    // Framer links are exposed as component link variables.
    // A link variable is "used" when its ID appears in node/control structures.
    try {
        const linkStyles: unknown[] = [...globalVariables, ...componentVariables].filter((variable) => {
            const record = variable as Record<string, unknown>
            return record.type === "link"
        })

        // Undocumented Framer API fallbacks for link style registries.
        const linkRegistryStyles: unknown[] = []
        const getLinkStyles = framerAny.getLinkStyles
        const getLinks = framerAny.getLinks
        const getNodesWithType = framerAny.getNodesWithType

        if (typeof getLinkStyles === "function") {
            try {
                const styles = await (getLinkStyles as () => Promise<unknown>)()
                if (Array.isArray(styles)) linkRegistryStyles.push(...styles)
            } catch {
                // ignore
            }
        }

        if (typeof getLinks === "function") {
            try {
                const styles = await (getLinks as () => Promise<unknown>)()
                if (Array.isArray(styles)) linkRegistryStyles.push(...styles)
            } catch {
                // ignore
            }
        }

        if (typeof getNodesWithType === "function") {
            for (const candidateType of ["LinkStyleNode", "LinkNode", "LinkTokenNode"]) {
                try {
                    const styles = await (getNodesWithType as (t: string) => Promise<unknown>)(candidateType)
                    if (Array.isArray(styles) && styles.length > 0) {
                        linkRegistryStyles.push(...styles)
                    }
                } catch {
                    // ignore
                }
            }
        }
        const linkCandidates = [...linkStyles, ...linkRegistryStyles]

        if (linkCandidates.length > 0) {
            const allLinkStyleIds = new Set<string>()
            for (const style of linkCandidates) {
                const styleId = getRegistryItemId(style)
                if (styleId !== null) allLinkStyleIds.add(styleId)
            }
            if (allLinkStyleIds.size > 0) {
                const usedLinkStyleIds = collectReferencedIds(
                    [
                        ...expandedStyleNodes.flatMap(styleSourceValuesForNode),
                        ...nodes.collections,
                    ],
                    allLinkStyleIds,
                    true,
                )
                for (const style of linkCandidates) {
                    const styleId = getRegistryItemId(style)
                    if (styleId !== null && !usedLinkStyleIds.has(styleId)) {
                        flagged.push({ label: `Link '${getRegistryItemName(style)}': not applied to any link`, nodeId: null })
                    }
                }
            }
        } else {
            // Fallback: in many Framer files, "links" in the style panel are text styles
            // grouped under Link/*. Detect unused ones explicitly from text styles.
            const textStyles = await framer.getTextStyles().catch(() => [])
            const linkTextStyles = textStyles.filter((style) => {
                const record = style as unknown as Record<string, unknown>
                const name = typeof record.name === "string" ? record.name : ""
                const path = typeof record.path === "string" ? record.path : ""
                return /(^|\/)link(\/|$)|\blink\b/i.test(path) || /\blink\b/i.test(name)
            })

            if (linkTextStyles.length > 0) {
                const linkTextStyleIds = new Set<string>()
                for (const style of linkTextStyles) {
                    const styleId = getRegistryItemId(style)
                    if (styleId !== null) linkTextStyleIds.add(styleId)
                }

                const usedLinkTextStyleIds = collectReferencedIds(
                    [
                        ...expandedStyleNodes.flatMap(styleSourceValuesForNode),
                        ...nodes.collections,
                    ],
                    linkTextStyleIds,
                )
                for (const style of linkTextStyles) {
                    const styleId = getRegistryItemId(style)
                    if (styleId !== null && !usedLinkTextStyleIds.has(styleId)) {
                        flagged.push({ label: `Link style '${getRegistryItemName(style)}': not applied to any link`, nodeId: null })
                    }
                }
            } else {
                // Structural fallback: infer link "assets" from component link controls.
                // This is used when runtime APIs do not expose link registries/variables.
                const linkControlCandidates = new Map<string, { label: string; componentIdentifier: string; controlKey: string }>()
                const componentNameByIdentifier = new Map<string, string>()
                for (const def of nodes.componentDefinitionNodes) {
                    const raw = def as Record<string, unknown>
                    const componentIdentifier = typeof raw.componentIdentifier === "string" ? raw.componentIdentifier : null
                    if (!componentIdentifier) continue

                    componentNameByIdentifier.set(componentIdentifier, getNodeName(def as AnyNode))

                    const entries = extractLinkControlEntriesGlobal(raw)
                    for (const { key: controlKey } of entries) {
                        const candidateId = `${componentIdentifier}:${controlKey}`
                        const componentName = getNodeName(def as AnyNode)
                        linkControlCandidates.set(candidateId, {
                            label: `Link control '${componentName}.${controlKey}'`,
                            componentIdentifier,
                            controlKey,
                        })
                    }
                }

                // If definitions don't expose link-like controls, infer candidates from instances.
                for (const instance of nodes.componentNodes) {
                    const raw = instance as Record<string, unknown>
                    const componentIdentifier = typeof raw.componentIdentifier === "string" ? raw.componentIdentifier : null
                    if (!componentIdentifier) continue

                    const entries = extractLinkControlEntriesGlobal(raw)
                    for (const { key: controlKey } of entries) {
                        const candidateId = `${componentIdentifier}:${controlKey}`
                        if (linkControlCandidates.has(candidateId)) continue

                        const componentName = componentNameByIdentifier.get(componentIdentifier) ?? getNodeName(instance as AnyNode)
                        linkControlCandidates.set(candidateId, {
                            label: `Link control '${componentName}.${controlKey}'`,
                            componentIdentifier,
                            controlKey,
                        })
                    }
                }

                const usedLinkControlCandidateIds = new Set<string>()
                for (const instance of nodes.componentNodes) {
                    const raw = instance as Record<string, unknown>
                    const componentIdentifier = typeof raw.componentIdentifier === "string" ? raw.componentIdentifier : null
                    if (!componentIdentifier) continue

                    const entries = extractLinkControlEntriesGlobal(raw)

                    for (const { key: controlKey, value: control } of entries) {
                        const candidateId = `${componentIdentifier}:${controlKey}`
                        if (!linkControlCandidates.has(candidateId)) continue

                        if (typeof control === "object" && control !== null) {
                            const controlRecord = control as Record<string, unknown>
                            const linkValue = "value" in controlRecord ? controlRecord.value : control
                                if (!isEmptyLinkValueGlobal(linkValue)) {
                                usedLinkControlCandidateIds.add(candidateId)
                            }
                        } else if (!isEmptyLinkValueGlobal(control)) {
                            usedLinkControlCandidateIds.add(candidateId)
                        }
                    }
                }

                for (const [candidateId, candidate] of linkControlCandidates) {
                    if (!usedLinkControlCandidateIds.has(candidateId)) {
                        flagged.push({ label: `${candidate.label}: not used by any instance`, nodeId: null })
                    }
                }
            }
        }
    } catch {
        // Link variables unavailable — skip
    }

    // ── 5. Unused code files (no component exports placed on canvas) ─────────
    // A code file with component exports is "unused" if none of its exported
    // component insertURLs appear in any ComponentInstanceNode on any page.
    for (const codeFile of nodes.codeFiles) {
        const rawCodeFile = codeFile as unknown as Record<string, unknown>
        const codeContent = typeof rawCodeFile.content === "string" ? rawCodeFile.content : ""
        const componentExports = codeFile.exports.filter(e => e.type === "component")
        if (componentExports.length === 0) continue // only overrides — cannot determine usage reliably
        const hasUsedExport = componentExports.some(e => typeof e.insertURL === "string" && instancedInsertUrls.has(e.insertURL))
        if (!hasUsedExport) {
            flagged.push({ label: `Code file '${codeFile.name}': no components placed on any page`, nodeId: null })
        }

        const declaredLinkControls = extractDeclaredControlsFromCode(codeContent, "link")
        const declaredVectorControls = extractDeclaredControlsFromCode(codeContent, "vectorSetItem")

        const exportInsertUrls = new Set(
            componentExports
                .map((entry) => entry.insertURL)
                .filter((value): value is string => typeof value === "string"),
        )

        const matchingInstances = nodes.componentNodes.filter((instance) => {
            const raw = instance as Record<string, unknown>
            return typeof raw.insertURL === "string" && exportInsertUrls.has(raw.insertURL)
        })

        const matchesControlKey = (candidateKey: string, entryKey: string): boolean => {
            if (candidateKey === entryKey) return true
            return entryKey.endsWith(`.${candidateKey}`) || entryKey.endsWith(`[${candidateKey}]`)
        }

        const instanceHasLinkControlValue = (instance: AnyNode, candidateKey: string): boolean => {
            const raw = instance as Record<string, unknown>
            const entries = (extractLinkControlEntriesGlobal(raw) as ReadonlyArray<{ key: string; value: unknown }>)
            for (const entry of entries) {
                if (!matchesControlKey(candidateKey, entry.key)) continue
                if (typeof entry.value === "object" && entry.value !== null) {
                    const record = entry.value as Record<string, unknown>
                    const linkValue = "value" in record ? record.value : entry.value
                    if (!isEmptyLinkValueGlobal(linkValue)) return true
                } else if (!isEmptyLinkValueGlobal(entry.value)) {
                    return true
                }
            }
            return false
        }

        const instanceHasVectorControlValue = (instance: AnyNode, candidateKey: string): boolean => {
            const raw = instance as Record<string, unknown>
            const entries = (extractVectorControlEntriesGlobal(raw) as ReadonlyArray<{ key: string; value: unknown }>)
            for (const entry of entries) {
                if (!matchesControlKey(candidateKey, entry.key)) continue
                if (typeof entry.value === "object" && entry.value !== null) {
                    const record = entry.value as Record<string, unknown>
                    const vectorValue = "value" in record ? record.value : entry.value
                    if (!isEmptyVectorValueGlobal(vectorValue)) return true
                } else if (!isEmptyVectorValueGlobal(entry.value)) {
                    return true
                }
            }
            return false
        }

        const usedLinkControlKeys = new Set<string>()
        for (const controlKey of declaredLinkControls) {
            if (matchingInstances.some((instance) => instanceHasLinkControlValue(instance, controlKey))) {
                usedLinkControlKeys.add(controlKey)
            }
        }

        const usedVectorControlKeys = new Set<string>()
        for (const controlKey of declaredVectorControls) {
            if (matchingInstances.some((instance) => instanceHasVectorControlValue(instance, controlKey))) {
                usedVectorControlKeys.add(controlKey)
            }
        }

        if (declaredLinkControls.length > 0 && hasUsedExport) {
            for (const controlKey of declaredLinkControls) {
                if (!usedLinkControlKeys.has(controlKey)) {
                    flagged.push({ label: `Code file '${codeFile.name}': link control '${controlKey}' is unused`, nodeId: null })
                }
            }
        }
        if (declaredVectorControls.length > 0 && hasUsedExport) {
            for (const controlKey of declaredVectorControls) {
                if (!usedVectorControlKeys.has(controlKey)) {
                    flagged.push({ label: `Code file '${codeFile.name}': vector control '${controlKey}' is unused`, nodeId: null })
                }
            }
        }
    }

    // ── 6. Unused vector sets ────────────────────────────────────────────────
    // A vector set is "unused" if no VectorSetItemNode exists on canvas.
    // We correlate by getting all VectorSetItemNodes and checking their names
    // against the items in each VectorSet.
    try {
        if (typeof framerAny.getVectorSets === "function") {
            const vectorSets = await (framerAny.getVectorSets as () => Promise<ReadonlyArray<Record<string, unknown>>>)()
            if (vectorSets.length > 0) {
                // Collect placed vector set usage from multiple surfaces:
                // - VectorSetItemNode instances on canvas
                // - vectorSetItem controls on nodes/components
                const placedItemInsertUrls = new Set<string>()
                const placedItemIds = new Set<string>()
                const placedItemValues = new Set<string>()
                try {
                    const vsItemNodes = await (framerAny.getNodesWithType as (t: string) => Promise<ReadonlyArray<Record<string, unknown>>>)("VectorSetItemNode").catch(() => [])
                    for (const node of vsItemNodes) {
                        const insertUrl = node.insertUrl ?? node.insertURL
                        if (typeof insertUrl === "string") placedItemInsertUrls.add(insertUrl)
                        if (typeof node.id === "string") placedItemIds.add(node.id)
                    }
                } catch { /* unavailable */ }

                const vectorUsageSources: unknown[] = [
                    ...expandedStyleNodes.flatMap(styleSourceValuesForNode),
                    ...nodes.componentDefinitionNodes,
                    ...nodes.componentNodes,
                ]
                const seenVectorObjects = new WeakSet<object>()
                const collectVectorValues = (value: unknown): void => {
                    if (value === null || value === undefined) return
                    if (typeof value === "string") {
                        const v = value.trim()
                        if (v.length > 0) placedItemValues.add(v)
                        return
                    }
                    if (typeof value !== "object") return

                    const obj = value as object
                    if (seenVectorObjects.has(obj)) return
                    seenVectorObjects.add(obj)

                    if (Array.isArray(value)) {
                        for (const item of value) collectVectorValues(item)
                        return
                    }

                    const record = value as Record<string, unknown>
                    if (record.type === "vectorSetItem") {
                        if (typeof record.value === "string") placedItemValues.add(record.value)
                        if (typeof record.id === "string") placedItemValues.add(record.id)
                        if (typeof record.insertUrl === "string") placedItemInsertUrls.add(record.insertUrl)
                    }

                    for (const [key, nested] of Object.entries(record)) {
                        if (/vector(set)?item|icon/i.test(key)) {
                            collectVectorValues(nested)
                        } else if (typeof nested === "object" && nested !== null) {
                            collectVectorValues(nested)
                        }
                    }
                }
                for (const source of vectorUsageSources) collectVectorValues(source)

                // Optional API: list all vector set items (helps with id/url normalization)
                if (typeof framerAny.getVectorSetItems === "function") {
                    try {
                        const allItems = await (framerAny.getVectorSetItems as () => Promise<ReadonlyArray<Record<string, unknown>>>)()
                        for (const item of allItems) {
                            if (typeof item.id === "string" && placedItemValues.has(item.id)) placedItemIds.add(item.id)
                            const url = item.insertUrl ?? item.insertURL
                            if (typeof url === "string" && placedItemValues.has(url)) placedItemInsertUrls.add(url)
                        }
                    } catch { /* unavailable */ }
                }

                for (const vs of vectorSets) {
                    const vsName = (vs.name ?? "Unnamed") as string
                    let isUsed = false

                    // If we have insertUrl data, match against placed items
                    if (placedItemInsertUrls.size > 0 && typeof vs.getItems === "function") {
                        try {
                            const items = await (vs.getItems as () => Promise<ReadonlyArray<Record<string, unknown>>>)()
                            isUsed = items.some(item => {
                                const url = item.insertUrl as string | undefined
                                if (typeof url === "string" && placedItemInsertUrls.has(url)) return true
                                if (typeof item.id === "string" && (placedItemIds.has(item.id) || placedItemValues.has(item.id))) return true
                                if (typeof item.name === "string" && placedItemValues.has(item.name)) return true
                                return false
                            })
                        } catch { /* skip */ }
                    }

                    if (!isUsed) {
                        flagged.push({ label: `Vector set '${vsName}': no items placed on any page`, nodeId: null })
                    }
                }
            }
        }
    } catch {
        // getVectorSets not available — skip
    }

    // ── 7. Unused image assets ───────────────────────────────────────────────
    // Two passes:
    //   a) Project folder: enumerate via getAssets() and check if URL appears in any frame.
    //   b) Framer folder: images live inside component definition frames. An image is
    //      "indirectly unused" when every frame containing it belongs to a component
    //      that has no instances. We use variantFrameComponentIdMap to determine which
    //      component (if any) owns a frame, then cross-check against unusedComponentIdentifiers.

    // Collect ALL background image URLs from ALL frames, grouped by owning component.
    // urlOwners: imageUrl → Set of componentIdentifiers whose frames use this image.
    //            If the URL also appears in a non-component frame, it is always considered used.
    const urlDirectlyUsed = new Set<string>()   // URL found in a non-component frame (page frame)
    const urlInComponents = new Map<string, Set<string>>() // URL → set of componentIdentifiers

    for (const frame of nodes.frameNodes) {
        const asset = getFrameBackgroundImage(frame)
        if (!asset?.url) continue
        const compIdent = nodes.variantFrameComponentIdMap.get(frame.id)
        if (compIdent === undefined) {
            // Frame is on an actual page — image is definitely used
            urlDirectlyUsed.add(asset.url)
        } else {
            // Frame is inside a component definition
            if (!urlInComponents.has(asset.url)) urlInComponents.set(asset.url, new Set())
            urlInComponents.get(asset.url)!.add(compIdent)
        }
    }

    // Flag images that are ONLY inside unused component definitions (Framer folder images).
    for (const [url, componentIdents] of urlInComponents) {
        if (urlDirectlyUsed.has(url)) continue // used on a page too — skip
        // Check whether ALL components containing this image are unused
        const allOwningComponentsUnused = [...componentIdents].every(ci => unusedComponentIdentifiers.has(ci))
        if (allOwningComponentsUnused) {
            // Extract a display name from the URL (last path segment, no query string)
            const urlName = url.split("/").pop()?.split("?")[0] ?? url
            flagged.push({ label: `Image '${urlName}': only used inside unused component(s)`, nodeId: null })
        }
    }

    // Project folder images: enumerate via getAssets() and check URL usage.
    try {
        if (typeof framerAny.getAssets === "function") {
            const assets = await (framerAny.getAssets as () => Promise<ReadonlyArray<Record<string, unknown>>>)()
            const allUsedUrls = new Set([...urlDirectlyUsed, ...urlInComponents.keys()])
            for (const asset of assets) {
                const url = asset.url as string | undefined
                if (url && !allUsedUrls.has(url)) {
                    const name = (asset.name ?? asset.fileName ?? "Unnamed") as string
                    flagged.push({ label: `Image '${name}': not used in any frame`, nodeId: null })
                }
            }
        }
    } catch {
        // getAssets not available — skip project image check
    }

    if (flagged.length === 0) {
        return makeCheck(id, label, "pass", "No unused assets found", [], true)
    }
    return makeCheck(id, label, "warning", `${flagged.length} unused asset(s) found`, flagged, true)
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function runAudit(onProgress?: (done: number, total: number) => void, enablePageSpeed: boolean = true): Promise<AuditReport> {
    const nodes = await fetchAllNodes()

    const TOTAL = 32
    let completed = 0

    function track<T>(p: Promise<T> | T): Promise<T> {
        return Promise.resolve(p).then((result) => {
            completed++
            onProgress?.(completed, TOTAL)
            return result
        })
    }

    const [
        // Assets
        altText,
        largeUncompressedAssets,
        componentFileStructure,
        unusedAssets,
        // Text
        repetitiveText,
        loremIpsum,
        defaultFonts,
        textLegibility,
        consistentTextStyles,
        textStyles,
        // Design
        custom404,
        naming,
        colorStyles,
        // Accessibility
        colorContrast,
        pageSettings,
        navFooterTags,
        tagChecker,
        h1Tags,
        headingHierarchy,
        // Responsive
        responsiveLayout,
        autoHeight,
        overflow,
        breakpointWidths,
        // Links
        mailtoTel,
        hoverStateLinks,
        brokenInternal,
        linksTo404,
        activeLinks,
        contactFormSendTo,
        // CMS
        duplicateCms,
        emptyCmsFields,
        // Performance
        pageSpeed,
    ] = await Promise.all([
        track(checkAltText(nodes)),
        track(checkLargeUncompressedAssets(nodes)),
        track(checkComponentFileStructure(nodes)),
        track(checkUnusedAssets(nodes)),
        track(checkRepetitiveText(nodes)),
        track(checkLoremIpsum(nodes)),
        track(checkDefaultFonts(nodes)),
        track(checkTextLegibility(nodes)),
        track(checkConsistentTextStyles(nodes)),
        track(checkTextStyles(nodes)),
        track(checkCustom404Page(nodes)),
        track(checkNaming(nodes)),
        track(checkColorStyles(nodes)),
        track(checkColorContrast(nodes)),
        track(checkPageSettings(nodes)),
        track(checkNavFooterTags(nodes)),
        track(checkTagChecker(nodes)),
        track(checkH1Tags(nodes)),
        track(checkHeadingHierarchy(nodes)),
        track(checkResponsiveLayout(nodes)),
        track(checkAutoHeight(nodes)),
        track(checkOverflow(nodes)),
        track(checkBreakpointWidths(nodes)),
        track(checkMailtoTelLinks(nodes)),
        track(checkHoverStateLinks(nodes)),
        track(checkBrokenInternalLinks(nodes)),
        track(checkLinksTo404Page(nodes)),
        track(checkActiveLinks(nodes)),
        track(checkContactFormSendTo(nodes)),
        track(checkDuplicateCmsContent(nodes)),
        track(checkEmptyCmsFields(nodes)),
        enablePageSpeed ? track(checkGooglePageSpeed(nodes)) : track(skipCheck("google-pagespeed", "Google PageSpeed", "Check disabled")),
    ])

    const categories: ReadonlyArray<CheckCategory> = [
        {
            id: "assets",
            label: "Assets",
            checks: [largeUncompressedAssets, componentFileStructure, unusedAssets],
        },
        {
            id: "text",
            label: "Text",
            checks: [repetitiveText, loremIpsum, defaultFonts, textLegibility, consistentTextStyles, textStyles],
        },
        {
            id: "design",
            label: "Design",
            checks: [custom404, naming, colorStyles],
        },
        {
            id: "accessibility",
            label: "Accessibility",
            checks: [colorContrast, pageSettings, altText, navFooterTags, tagChecker, h1Tags, headingHierarchy],
        },
        {
            id: "responsive",
            label: "Responsive",
            checks: [responsiveLayout, autoHeight, overflow, breakpointWidths],
        },
        {
            id: "links",
            label: "Links",
            checks: [mailtoTel, hoverStateLinks, brokenInternal, linksTo404, activeLinks, contactFormSendTo],
        },
        {
            id: "cms",
            label: "CMS",
            checks: [duplicateCms, emptyCmsFields],
        },
        {
            id: "performance",
            label: "Performance",
            checks: [pageSpeed],
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

async function runRequirementCheck(checkId: string, enablePageSpeed: boolean = true): Promise<CheckResult | null> {
    const nodes = await fetchAllNodes()

    switch (checkId) {
        case "alt-text": return checkAltText(nodes)
        case "large-uncompressed-assets": return checkLargeUncompressedAssets(nodes)
        case "component-file-structure": return checkComponentFileStructure(nodes)
        case "unused-assets": return checkUnusedAssets(nodes)
        case "placeholder-text": return checkRepetitiveText(nodes)
        case "lorem-ipsum": return checkLoremIpsum(nodes)
        case "default-fonts": return checkDefaultFonts(nodes)
        case "text-legibility": return checkTextLegibility(nodes)
        case "consistent-text-styles": return checkConsistentTextStyles(nodes)
        case "text-styles": return checkTextStyles(nodes)
        case "custom-404-page": return checkCustom404Page(nodes)
        case "naming": return checkNaming(nodes)
        case "color-styles": return checkColorStyles(nodes)
        case "color-contrast": return checkColorContrast(nodes)
        case "page-settings": return checkPageSettings(nodes)
        case "nav-footer-tags": return checkNavFooterTags(nodes)
        case "tag-checker": return checkTagChecker(nodes)
        case "h1-tags": return checkH1Tags(nodes)
        case "heading-hierarchy": return checkHeadingHierarchy(nodes)
        case "responsive-layout": return checkResponsiveLayout(nodes)
        case "auto-height": return checkAutoHeight(nodes)
        case "overflow": return checkOverflow(nodes)
        case "breakpoint-widths": return checkBreakpointWidths(nodes)
        case "mailto-tel-links": return checkMailtoTelLinks(nodes)
        case "hover-state-links": return checkHoverStateLinks(nodes)
        case "broken-internal-links": return checkBrokenInternalLinks(nodes)
        case "links-to-404": return checkLinksTo404Page(nodes)
        case "active-links": return checkActiveLinks(nodes)
        case "contact-form": return checkContactFormSendTo(nodes)
        case "duplicate-cms-content": return checkDuplicateCmsContent(nodes)
        case "empty-cms-fields": return checkEmptyCmsFields(nodes)
        case "google-pagespeed":
            return enablePageSpeed
                ? checkGooglePageSpeed(nodes)
                : skipCheck("google-pagespeed", "Google PageSpeed", "Check disabled")
        default:
            return null
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
    
    // First, map nodes to their root breakpoint.
    // In Framer, responsive pages are WebPageNodes with FrameNode children denoting breakpoints.
    const parentMap = new Map<string, string>()
    const webPageIds = new Set<string>()
    try {
        const pages = await framer.getNodesWithType("WebPageNode")
        for (const p of pages) webPageIds.add(p.id)
    } catch { /* ignore */ }

    const nodeBreakpointMap = new Map<string, string>() // frame.id -> "L" | "M" | "S"

    // To figure out the hierarchy, we fetch parents.
    await Promise.all(allFrames.map(async frame => {
        try {
            const p = await frame.getParent()
            if (p) parentMap.set(frame.id, p.id)
        } catch { /* ignore */ }
    }))

    // Find root breakpoint frames (direct children of WebPageNode)
    const pageBreakpoints = new Map<string, string[]>() // pageId -> [frameId...]
    for (const frame of allFrames) {
        const parentId = parentMap.get(frame.id)
        if (parentId && webPageIds.has(parentId)) {
            const arr = pageBreakpoints.get(parentId) || []
            arr.push(frame.id)
            pageBreakpoints.set(parentId, arr)
        }
    }

    // Assign "L", "M", "S" relative to their order on the page
    for (const [_pageId, bpFrames] of pageBreakpoints.entries()) {
        // usually the order is Desktop, Tablet, Phone.
        const names = ["L", "M", "S"]
        bpFrames.forEach((bpFrameId, index) => {
            const bpName = names[Math.min(index, names.length - 1)]
            nodeBreakpointMap.set(bpFrameId, bpName)
        })
    }

    // Propagate breakpoints down to all descendant frames
    let changed = true
    while (changed) {
        changed = false
        for (const frame of allFrames) {
            if (!nodeBreakpointMap.has(frame.id)) {
                const parentId = parentMap.get(frame.id)
                const parentBp = parentId ? nodeBreakpointMap.get(parentId) : undefined
                if (parentBp) {
                    nodeBreakpointMap.set(frame.id, parentBp)
                    changed = true
                }
            }
        }
    }

    const sectionOutputs = await Promise.all(
        sections.map(async (section, sectionIndex) => {
            const results: PaddingSectionResult[] = []

            for (const config of section.configs) {
                const items: PaddingCheckItem[] = []

                for (const frameRef of section.frames) {
                    const node = allFrames.find(n => n.id === frameRef.id)
                    if (!node) continue

                    // Only evaluate nodes that belong to this config's breakpoint, or if the node isn't inside any known breakpoint (e.g. canvas elements outside a page), default to "L".
                    const nodeBp = nodeBreakpointMap.get(node.id) || "L"
                    if (nodeBp !== config.breakpointId) continue

                    if (config.gap.enabled && config.gap.value !== "") {
                        const gapStr = node.gap ?? null
                        const actualNum = parsePx(typeof gapStr === "string" ? gapStr.split(" ")[0] : null)
                        if (Number(config.gap.value) !== actualNum) {
                            items.push({
                                nodeId: node.id,
                                nodeName: node.name ?? frameRef.name,
                                property: "gap",
                                expected: config.gap.value,
                                actual: String(actualNum),
                            })
                        }
                    }

                    if (config.padding.enabled) {
                        const sides = parsePaddingSides(node.padding ?? null)
                        const expected =
                            config.padding.mode === "uniform"
                                ? { top: config.padding.uniform, right: config.padding.uniform, bottom: config.padding.uniform, left: config.padding.uniform }
                                : { top: config.padding.top, right: config.padding.right, bottom: config.padding.bottom, left: config.padding.left }

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
                results.push({ sectionIndex, breakpointId: config.breakpointId, items })
            }

            return { section, results }
        })
    )

    return { sections: sectionOutputs }
}

export { runAudit, runRequirementCheck, calculateScore }
