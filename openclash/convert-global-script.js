#!/usr/bin/env node
/**
 * Convert global_script.js (Clash Verge Rev / Mihomo Party global override script)
 * into an OpenClash overwrite module (openclash/lipiston-side-router).
 *
 * The source script is executed inside a `vm` sandbox with a synthetic proxy list
 * so that the converter sees the *real* output of global_script.js instead of
 * re-implementing its logic with fragile text parsing. No network, no filesystem
 * and no host globals are exposed to the sandbox.
 *
 * The generated module is meant for an OpenClash instance running as a side
 * router:
 *   - DNS / runtime keys come straight from the source script.
 *   - Proxy groups are appended with `proxy-groups+`.
 *   - Rules are prepended with `+rules` so OpenClash's own catch-all still wins.
 *   - Region groups are built dynamically with include-all + filter, because the
 *     router never knows the subscription's node names at conversion time.
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const DEFAULT_INPUT = 'global_script.js'
const DEFAULT_OUTPUT = path.join('openclash', 'lipiston-side-router')
/**
 * Every run emits both modules, so the router can be switched between them without a rebuild.
 * The IPv4-only variant keeps the bare output path on purpose: it is the one actually
 * published on the side router, so an existing OpenClash overwrite registration keeps
 * working; the dual-stack variant sits next to it. (IPv6 side routing also needs upstream
 * IPv6-PD, a default route and a return path -- the module cannot provide those.)
 */
const VARIANTS = [
    { name: 'v4v6', suffix: '-v4v6', ipv6: true },
    { name: 'v4', suffix: '', ipv6: false },
]
/**
 * Region groups emitted for the side router. Mirrors the source script's whole region table,
 * in the source script's own order, so the module ends up as detailed as the desktop config.
 * Narrow it with `--regions=` when the subscription has no nodes for a region: mihomo refuses
 * to start a group that resolves to zero proxies.
 */
const DEFAULT_REGIONS = [
    'HK', 'US', 'JP', 'KR', 'SG', 'CN', 'TW', 'GB', 'DE', 'MY',
    'TK', 'CA', 'FR', 'GR', 'LT', 'MK', 'NL', 'PL', 'SE', 'AR',
]
/** A name that matches no region regex, used to force the `其他节点` group to exist. */
const UNMATCHED_PROBE = '未知节点A'
/** The source script is IPv4-only; this is the range OpenClash uses when IPv6 is on. */
const FAKEIP_RANGE6 = 'fdfe:dcba:9876::1/64'
/** Desktop process names can never be matched by a router-side core. */
const DROPPED_RULE_PREFIXES = ['PROCESS-NAME,']
/** The catch-all must stay in OpenClash's own config, at the very end. */
const DROPPED_RULE_PREFIXES_TAIL = ['MATCH,']
/**
 * The side router blocks ads through AWAvenue alone, so the source script's own geosite ad
 * rule and its ad DNS policy are dropped from the module. The desktop script keeps both.
 */
const DROPPED_ADS_RULE = 'GEOSITE,category-ads-all,'
const DROPPED_ADS_DNS_POLICY = 'geosite:category-ads-all'
/** The source script's region regexes are case-insensitive; Go regexes need the flag inline. */
const REGEX_CASELESS = '(?i)'
/** mihomo adapter types that are groups rather than real proxy nodes. */
const GROUP_TYPES = 'Selector|URLTest|Fallback|LoadBalance|Relay'
/**
 * Appended to the source script's three auto-test group names (自动选择/故障转移/负载均衡).
 * Those bare names are exactly what subscription templates hand out themselves, and
 * `proxy-groups+` is a plain append -- OpenClash's deep merge never dedupes by name, so a
 * collision makes mihomo refuse to start with `Parse config error: ProxyGroup X: duplicate
 * group name`. Namespacing ours is the only fix that leaves the subscription's own groups
 * (and the subscriber's rules pointing at them) untouched.
 */
const AUTO_TEST_SUFFIX = '·模块'

function usage() {
    const lines = [
        'Usage: convert-global-script.js [INPUT_JS] [OUTPUT_MODULE] [options]',
        '',
        'Two modules are written per run:',
        `  <OUTPUT_MODULE>${VARIANTS[1].suffix}          IPv4-only (what the side router publishes)`,
        `  <OUTPUT_MODULE>${VARIANTS[0].suffix}     dual-stack, IPv6 enabled`,
        '',
        'Options:',
        '  --ipv6 | --no-ipv6       emit only the dual-stack / only the IPv4-only module',
        '                           (default: both)',
        '  --regions=HK,JP,SG,US    region groups to generate, or ALL (default: all 20)',
        '  --existing-groups=A,B    group names already defined by OpenClash, never redefined',
        '  --tun | --no-tun         emit the source script tun block (default: no-tun)',
        '  --sniffer | --no-sniffer emit the source script sniffer block (default: sniffer)',
        '  --geo-update | --no-geo-update',
        '                           emit geox-url + geo-auto-update; the module defaults to',
        '                           --no-geo-update because OpenClash already refreshes the',
        '                           same files from its own weekly cron',
        '  --tail-rules | --no-tail-rules',
        '                           emit the source GEOSITE/GEOIP private+cn tail rules',
        '                           (default: tail-rules)',
        '  -h, --help               show this help',
    ]
    process.stderr.write(lines.join('\n') + '\n')
}

function fail(message) {
    process.stderr.write(`convert-global-script: ${message}\n`)
    process.exit(1)
}

function parseArgs(argv) {
    const options = {
        input: DEFAULT_INPUT,
        output: DEFAULT_OUTPUT,
        // Both variants unless `--ipv6` / `--no-ipv6` narrows the run to one.
        variants: VARIANTS.slice(),
        regions: DEFAULT_REGIONS.slice(),
        // Group names the subscription (or OpenClash itself) already defines. The converter
        // reuses those instead of emitting its own, which is the safe way out of a duplicate
        // name: deleting the existing group would break whatever rule points at it.
        existingGroups: [],
        tun: false,
        sniffer: true,
        // Off by default for the router module: mihomo's own updater would duplicate
        // OpenClash's weekly cron on the same four files.
        geoUpdate: false,
        tailRules: true,
    }
    const positional = []
    for (const arg of argv) {
        if (arg === '--ipv6') options.variants = VARIANTS.filter((variant) => variant.ipv6)
        else if (arg === '--no-ipv6') options.variants = VARIANTS.filter((variant) => !variant.ipv6)
        else if (arg === '--tun') options.tun = true
        else if (arg === '--no-tun') options.tun = false
        else if (arg === '--sniffer') options.sniffer = true
        else if (arg === '--no-sniffer') options.sniffer = false
        else if (arg === '--geo-update') options.geoUpdate = true
        else if (arg === '--no-geo-update') options.geoUpdate = false
        else if (arg === '--tail-rules') options.tailRules = true
        else if (arg === '--no-tail-rules') options.tailRules = false
        else if (arg.startsWith('--regions=')) {
            options.regions = splitList(arg.slice('--regions='.length))
        } else if (arg.startsWith('--existing-groups=')) {
            options.existingGroups = splitList(arg.slice('--existing-groups='.length))
        } else if (arg === '-h' || arg === '--help') {
            usage()
            process.exit(0)
        } else if (arg.startsWith('-')) {
            fail(`unknown option: ${arg}`)
        } else {
            positional.push(arg)
        }
    }
    if (positional[0]) options.input = positional[0]
    if (positional[1]) options.output = positional[1]
    if (positional.length > 2) fail(`unexpected argument: ${positional[2]}`)
    return options
}

function splitList(value) {
    return value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '')
}

/**
 * Run the source script against a synthetic proxy list and return both the
 * generated config and the top level constants the converter needs.
 */
function runSourceScript(inputPath, regionNames, log) {
    const source = fs.readFileSync(inputPath, 'utf8')
    const synthetic = regionNames.map((name) => ({
        name,
        type: 'ss',
        server: '127.0.0.1',
        port: 1,
        cipher: 'aes-128-gcm',
        password: 'openclash-converter',
    }))
    synthetic.push({
        name: UNMATCHED_PROBE,
        type: 'ss',
        server: '127.0.0.1',
        port: 1,
        cipher: 'aes-128-gcm',
        password: 'openclash-converter',
    })

    const sandbox = { console: { log: log || (() => {}) } }
    vm.createContext(sandbox)
    sandbox.__openclashInput = { proxies: synthetic, 'proxy-groups': [], rules: [] }
    const epilogue = `
;globalThis.__openclash = {
    config: main(__openclashInput),
    enable: enable,
    regionOptions: regionOptions,
    autoTestGroups: autoTestGroups,
    autoTestOptions: autoTestOptions,
    groupBaseOption: groupBaseOption,
    ruleProviderCommon: ruleProviderCommon,
}
`
    try {
        vm.runInContext(`${source}\n${epilogue}`, sandbox, {
            filename: path.basename(inputPath),
            timeout: 30000,
        })
    } catch (error) {
        fail(`failed to run ${inputPath}: ${error && error.message ? error.message : error}`)
    }
    const result = sandbox.__openclash
    if (!result || !result.config) fail(`${inputPath} did not return a config`)
    if (result.enable === false) fail(`${inputPath} has the group generator disabled (enable = false)`)
    return result
}

/** Resolve the requested region codes/names against the source script's region table. */
function selectRegions(regions, requested) {
    if (!requested || requested.length === 0 || requested.includes('ALL')) {
        return regions.slice()
    }
    const selected = []
    const seen = new Set()
    for (const wanted of requested) {
        const needle = wanted.toLowerCase()
        const region = regions.find(
            (candidate) =>
                candidate.name.toLowerCase() === needle ||
                candidate.name.toLowerCase().startsWith(needle),
        )
        if (!region) {
            fail(`unknown region: ${wanted} (known: ${regions.map((r) => r.name).join(', ')})`)
        }
        if (!seen.has(region.name)) {
            seen.add(region.name)
            selected.push(region)
        }
    }
    // Keep the source script's own ordering so the module mirrors it.
    return regions.filter((region) => seen.has(region.name))
}

function plainSafe(value) {
    const text = String(value)
    if (text === '') return false
    if (/^(true|false|yes|no|on|off|null|~)$/i.test(text)) return false
    return /^[A-Za-z0-9_\u4e00-\u9fff][A-Za-z0-9_./\-\u4e00-\u9fff]*$/.test(text)
}

/** Quote a value for a YAML block mapping value. */
function scalar(value) {
    if (typeof value === 'boolean' || typeof value === 'number') return String(value)
    const text = String(value)
    if (text === '') return "''"
    if (plainSafe(text)) return text
    return `'${text.replace(/'/g, "''")}'`
}

/** Rule lines keep their commas unquoted, but still need escaping when unsafe. */
function ruleScalar(value) {
    const text = String(value)
    if (/^[A-Za-z0-9]/.test(text) && !/:\s/.test(text) && !/\s#/.test(text) && !/[\n'"]/.test(text)) {
        return text
    }
    return `'${text.replace(/'/g, "''")}'`
}

/** True for a `{...}` mapping, as opposed to a list or a scalar. */
function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Emit one arbitrary mihomo value, recursing through lists and nested mappings. */
function emitValue(out, indent, key, value) {
    if (Array.isArray(value)) {
        out.list(indent, key, value)
        return
    }
    if (isPlainObject(value)) {
        out.block(indent, key, (inner) => {
            for (const [childKey, childValue] of Object.entries(value)) {
                emitValue(out, inner, childKey, childValue)
            }
        })
        return
    }
    out.entry(indent, key, value)
}

class Emitter {
    constructor() {
        this.lines = []
    }

    push(line) {
        this.lines.push(line)
    }

    /** `key: value` at the given indentation. */
    entry(indent, key, value) {
        this.push(`${' '.repeat(indent)}${key}: ${scalar(value)}`)
    }

    /** `key = value` — the OpenClash `[General]` section is UCI, not YAML. */
    uci(indent, key, value) {
        this.push(`${' '.repeat(indent)}${key} = ${value}`)
    }

    /** `key:` followed by a nested block built by `build`. */
    block(indent, key, build) {
        this.push(`${' '.repeat(indent)}${key}:`)
        build(indent + 2)
    }

    list(indent, key, values) {
        if (values.length === 0) return
        this.push(`${' '.repeat(indent)}${key}:`)
        for (const value of values) this.push(`${' '.repeat(indent + 2)}- ${scalar(value)}`)
    }

    toString() {
        return `${this.lines.join('\n')}\n`
    }
}

function emitUci(out, options) {
    out.push('[General]')
    out.push('# Generated by openclash/convert-global-script.js.')
    out.push('# Side-router: Fake-IP + Rule; TUN is intentionally not enabled.')
    out.uci(0, 'EN_MODE', 'fake-ip')
    out.uci(0, 'PROXY_MODE', 'rule')
    out.uci(0, 'INTRANET_ALLOWED', 1)
    out.uci(0, 'BYPASS_GATEWAY_COMPATIBLE', 1)
    out.uci(0, 'ROUTER_SELF_PROXY', 1)
    out.uci(0, 'SKIP_PROXY_ADDRESS', 1)
    out.uci(0, 'IPV6_ENABLE', options.ipv6 ? 1 : 0)
    out.uci(0, 'IPV6_DNS', options.ipv6 ? 1 : 0)
    out.uci(0, 'IPV6_MODE', 0)
    out.uci(0, 'ENABLE_V6_UDP_PROXY', options.ipv6 ? 1 : 0)
    if (options.ipv6) out.uci(0, 'FAKEIP_RANGE6', FAKEIP_RANGE6)
    out.uci(0, 'DISABLE_UDP_QUIC', 1)
    out.uci(0, 'STORE_FAKEIP', 1)
    out.uci(0, 'ENABLE_TCP_CONCURRENT', 1)
    out.uci(0, 'ENABLE_UNIFIED_DELAY', 1)
    out.uci(0, 'GEODATA_LOADER', 'memconservative')
    // Geodata policy for a flash-bound side router, mirroring the `geodata-mode: false`
    // pin below. The `[General]` section is not YAML — OpenClash's init script writes
    // each allowed key into `openclash.@overwrite[0].<key-lowercase>`
    // (/etc/init.d/openclash), and every consumer reads it through `uci_get_config`,
    // which is `uci -q get openclash.@overwrite[0].<key> || uci -q get
    // openclash.config.<key>"` (/usr/share/openclash/uci.sh). The per-config overwrite
    // section therefore WINS over `openclash.config`, i.e. the module overrides whatever
    // the LuCI settings page has stored, on every OpenClash start. That makes these five
    // keys the switch that actually decides what the router downloads:
    //   * ENABLE_GEOIP_DAT   — OpenClash's own copy of the mmdb pin (it is passed to
    //                          yml_change.sh, which only ever forces `geodata-mode: true`).
    //   * GEOIP_AUTO_UPDATE  — `GeoIP.dat` (16.5 M) is never read in mmdb mode.
    //   * GEOASN_AUTO_UPDATE — `ASN.mmdb` (12.1 M) is unused: the module has no ASN rule.
    //     Both weekly crons would only re-download files nothing loads, so they stay off
    //     and the flash saving survives a config reset.
    //   * GEO_AUTO_UPDATE / GEOSITE_AUTO_UPDATE — `Country.mmdb` and `GeoSite.dat` ARE
    //     read, and OpenClash's cron is the only updater left (`--no-geo-update` above
    //     keeps mihomo's own updater off the same files), so they must stay on.
    // `SMALL_FLASH_MEMORY` is deliberately NOT emitted: it is a separate decision
    // (tmpfs core + geodata) and neither value belongs in this module.
    out.uci(0, 'ENABLE_GEOIP_DAT', 0)
    out.uci(0, 'GEOIP_AUTO_UPDATE', 0)
    out.uci(0, 'GEOASN_AUTO_UPDATE', 0)
    out.uci(0, 'GEO_AUTO_UPDATE', 1)
    out.uci(0, 'GEOSITE_AUTO_UPDATE', 1)
    out.push('')
}

function emitDns(out, dns, options) {
    const value = { ...dns }
    value.ipv6 = options.ipv6
    // The source script only ever emits an IPv4 fake-ip range.
    if (options.ipv6) value['fake-ip-range6'] = FAKEIP_RANGE6
    else delete value['fake-ip-range6']

    out.block(0, 'dns', (indent) => {
        const scalars = [
            'enable',
            'ipv6',
            'enhanced-mode',
            'fake-ip-range',
            'fake-ip-range6',
            'fake-ip-filter-mode',
            'use-hosts',
            'use-system-hosts',
            'respect-rules',
            'prefer-h3',
        ]
        for (const key of scalars) {
            if (value[key] === undefined) continue
            out.entry(indent, key, value[key])
        }
        out.list(indent, 'fake-ip-filter', value['fake-ip-filter'] || [])
        for (const key of [
            'default-nameserver',
            'nameserver',
            'direct-nameserver',
            'proxy-server-nameserver',
            'fallback',
        ]) {
            out.list(indent, key, value[key] || [])
        }
        if (value['fallback-filter']) {
            out.block(indent, 'fallback-filter', (inner) => {
                const filter = value['fallback-filter']
                out.entry(inner, 'geoip', filter.geoip)
                out.entry(inner, 'geoip-code', filter['geoip-code'])
                out.list(inner, 'ipcidr', filter.ipcidr || [])
                out.list(inner, 'domain', filter.domain || [])
            })
        }
        if (value['nameserver-policy']) {
            out.block(indent, 'nameserver-policy', (inner) => {
                for (const [key, policy] of Object.entries(value['nameserver-policy'])) {
                    // Ads are resolved normally on the side router; AWAvenue handles blocking.
                    if (key === DROPPED_ADS_DNS_POLICY) continue
                    if (Array.isArray(policy)) out.list(inner, scalar(key), policy)
                    else out.entry(inner, scalar(key), policy)
                }
            })
        }
    })
}

function emitRuntime(out, jsConfig, options) {
    out.entry(0, 'mode', jsConfig.mode || 'rule')
    if (jsConfig.profile) {
        out.block(0, 'profile', (indent) => {
            for (const [key, value] of Object.entries(jsConfig.profile)) emitValue(out, indent, key, value)
        })
    }
    const simple = [
        'tcp-concurrent',
        'unified-delay',
        'keep-alive-idle',
        'keep-alive-interval',
        'find-process-mode',
        'geodata-loader',
    ]
    for (const key of simple) {
        if (jsConfig[key] === undefined) continue
        out.entry(0, key, jsConfig[key])
    }
    // Module-only divergence: the desktop script sets `geodata-mode: true` because it has
    // the disk, but that makes mihomo read `GeoIP.dat` (~16.5 M) instead of `Country.mmdb`
    // (~200 K). A side router is flash-bound, and OpenClash maintains the mmdb with its own
    // ipdb cron, so the module pins mmdb mode. The GEOIP rules keep working (the private
    // ranges are also covered by explicit IP-CIDR rules and `Country.mmdb` carries the CN
    // list) and 16.5 M of flash goes back to the router.
    out.entry(0, 'geodata-mode', false)
    // The core's own geo updater is left off: OpenClash already refreshes the same four
    // files from its weekly cron, and running both means two independent downloads of
    // ~28 M (mihomo's is daily). `--geo-update` restores the desktop behaviour.
    if (options.geoUpdate) {
        for (const key of ['geo-auto-update', 'geo-update-interval']) {
            if (jsConfig[key] === undefined) continue
            out.entry(0, key, jsConfig[key])
        }
        if (jsConfig['geox-url']) {
            out.block(0, 'geox-url', (indent) => {
                for (const [key, value] of Object.entries(jsConfig['geox-url'])) emitValue(out, indent, key, value)
            })
        }
    }
    if (jsConfig.ntp) {
        out.block(0, 'ntp', (indent) => {
            for (const [key, value] of Object.entries(jsConfig.ntp)) emitValue(out, indent, key, value)
        })
    }
    if (options.tun && jsConfig.tun) {
        out.block(0, 'tun', (indent) => {
            for (const [key, value] of Object.entries(jsConfig.tun)) emitValue(out, indent, key, value)
        })
    }
    if (options.sniffer && jsConfig.sniffer) {
        out.block(0, 'sniffer', (indent) => {
            for (const [key, value] of Object.entries(jsConfig.sniffer)) emitValue(out, indent, key, value)
        })
    }
}

function emitGroup(out, group, extra) {
    // `- name:` starts a block mapping whose keys must line up under `name` (indent 4).
    out.push(`  - name: ${scalar(group.name)}`)
    out.entry(4, 'type', group.type)
    if (extra.includeAll) {
        out.entry(4, 'include-all', true)
        out.entry(4, 'exclude-type', GROUP_TYPES)
    }
    if (extra.filter) out.entry(4, 'filter', extra.filter)
    if (extra.excludeFilter) out.entry(4, 'exclude-filter', extra.excludeFilter)
    if (group.proxies) out.list(4, 'proxies', group.proxies)
    for (const key of ['url', 'interval', 'timeout', 'tolerance', 'lazy', 'max-failed-times', 'hidden']) {
        if (group[key] === undefined) continue
        out.entry(4, key, group[key])
    }
    if (group.icon) out.entry(4, 'icon', group.icon)
}

function rewriteRuleProviders(providers) {
    const rewritten = {}
    for (const [name, provider] of Object.entries(providers || {})) {
        if (name === 'lipiston') {
            // The personal ruleset ships with this repository; never fetch it remotely.
            rewritten[name] = {
                type: 'file',
                behavior: provider.behavior,
                format: provider.format,
                path: './rule_provider/lipiston.yaml',
            }
            continue
        }
        rewritten[name] = {
            ...provider,
            path: `./rule_provider/${path.posix.basename(provider.path || name)}`,
        }
    }
    return rewritten
}

function filterRules(rules, options) {
    // Ads go through AWAvenue on the side router, so the source script's own geosite ad rule
    // is dropped here; the desktop script keeps it.
    let prefixes = DROPPED_RULE_PREFIXES.concat([DROPPED_ADS_RULE])
    if (!options.tailRules) {
        prefixes = prefixes.concat([
            'GEOSITE,private,',
            'GEOIP,private,',
            'GEOSITE,cn,',
            'GEOIP,cn,',
        ])
    }
    return rules
        .filter((rule) => !prefixes.some((prefix) => rule.startsWith(prefix)))
        .filter((rule) => !DROPPED_RULE_PREFIXES_TAIL.some((prefix) => rule.startsWith(prefix)))
}

function build(source, allRegions, regions, options) {
    const regionNames = regions.map((region) => region.name)
    const { config, autoTestGroups } = runSourceScript(source.path, regionNames)

    // Namespace the source script's auto-test groups and rewrite every reference to them, so
    // they can never clash with a group the subscription already ships (see AUTO_TEST_SUFFIX).
    const renamed = new Map(
        autoTestGroups.map((group) => [group.name, group.name + AUTO_TEST_SUFFIX]),
    )
    config['proxy-groups'] = (config['proxy-groups'] || []).map((group) => ({
        ...group,
        name: renamed.get(group.name) || group.name,
        proxies: Array.isArray(group.proxies)
            ? group.proxies.map((member) => renamed.get(member) || member)
            : group.proxies,
    }))

    const regionByName = new Map(regions.map((region) => [region.name, region]))
    const allRegionNames = new Set(allRegions.map((region) => region.name))
    const autoTestNames = new Set(autoTestGroups.map((group) => renamed.get(group.name)))
    const existing = new Set(options.existingGroups)

    // The source script's region regexes overlap (新加坡 matches 加, so it also lands in
    // the Canada group). Anything it creates for a region we did not ask for is dropped
    // here, and the group-name references to it are pruned afterwards.
    const plan = []
    for (const group of config['proxy-groups'] || []) {
        if (existing.has(group.name)) {
            plan.push({ kind: 'kept', group })
            continue
        }
        if (allRegionNames.has(group.name) && !regionByName.has(group.name)) {
            plan.push({ kind: 'dropped', group })
            continue
        }
        let kind = 'select'
        if (group.name === '其他节点') kind = 'other'
        else if (autoTestNames.has(group.name)) kind = 'auto'
        else if (regionByName.has(group.name)) kind = 'region'
        plan.push({ kind, group })
    }

    const emitted = plan.filter((entry) => entry.kind !== 'kept' && entry.kind !== 'dropped')
    const emittedGroupNames = new Set(emitted.map((entry) => entry.group.name))
    // `其他节点` is the bucket for proxies the source script could not place in any region.
    // Exclude every region the source script knows about, not just the ones we generated, so
    // a node from an ungenerated region (英国/德国/...) never leaks in: it belongs to a known
    // region, we simply did not emit that region's group.
    const knownRegionAlternation =
        REGEX_CASELESS + allRegions.map((region) => `(?:${region.regex.source})`).join('|')

    const referenceable = new Set(
        [...emittedGroupNames, ...existing, '直连', 'DIRECT', 'REJECT'].filter(Boolean),
    )
    const pruneProxies = (group) => {
        if (!Array.isArray(group.proxies)) return undefined
        return group.proxies.filter((name) => name !== group.name && referenceable.has(name))
    }

    const out = new Emitter()
    emitUci(out, options)
    out.push('[YAML]')
    emitDns(out, config.dns || {}, options)
    emitRuntime(out, config, options)

    const groups = []

    out.push('')
    out.push('# The subscription carries the real nodes; inject the source script\'s direct proxy')
    out.push('# so that every generated group can point at it.')
    out.push('proxies+:')
    out.push("  - name: 直连")
    out.push('    type: direct')
    out.push('    udp: true')
    out.push('')
    out.push('# Groups and rules are appended / prepended: OpenClash keeps its own groups, its')
    out.push('# own rule set and its own final MATCH.')
    out.push('proxy-groups+:')

    for (const { kind, group } of plan) {
        if (kind === 'kept') {
            groups.push(`${group.name} (kept from OpenClash)`)
            continue
        }
        if (kind === 'dropped') continue
        if (kind === 'other') {
            emitGroup(out, { ...group, proxies: pruneProxies(group) }, {
                includeAll: true,
                excludeFilter: knownRegionAlternation || undefined,
            })
            groups.push(group.name)
            continue
        }
        if (kind === 'auto') {
            emitGroup(out, { ...group, proxies: undefined }, { includeAll: true })
            groups.push(group.name)
            continue
        }
        if (kind === 'region') {
            const region = regionByName.get(group.name)
            emitGroup(out, { ...group, proxies: undefined }, {
                includeAll: true,
                // The source regexes are written with the /i flag; carry it over so the router
                // groups nodes exactly like the desktop config does.
                filter: REGEX_CASELESS + region.regex.source,
                // Deliberately no ratio exclude-filter. The desktop script's static pass does
                // drop nodes over the multiplier limit, but its later autoDetect pass re-claims
                // them by country code without ever reading the ratio, so the desktop config
                // keeps them in their region groups. Filtering on the ratio here would instead
                // strand those nodes in no group at all, because the region filter also keeps
                // them out of 其他节点.
            })
            groups.push(group.name)
            continue
        }
        emitGroup(out, { ...group, proxies: pruneProxies(group) }, {})
        groups.push(group.name)
    }

    const providers = rewriteRuleProviders(config['rule-providers'])
    out.push('')
    out.push('# Remote lists are kept, but OpenClash stores them in ./rule_provider/.')
    out.block(0, 'rule-providers', (indent) => {
        for (const [name, provider] of Object.entries(providers)) {
            out.block(indent, name, (inner) => {
                for (const key of ['type', 'behavior', 'format', 'interval', 'url', 'path']) {
                    if (provider[key] === undefined) continue
                    out.entry(inner, key, provider[key])
                }
            })
        }
    })

    const rules = filterRules(config.rules || [], options)
    out.push('')
    out.push('# Prepended to OpenClash\'s own rule list.')
    out.push('+rules:')
    for (const rule of rules) out.push(`  - ${ruleScalar(rule)}`)

    return { text: out.toString(), groups, rules, providers }
}

/** Where one variant of the module lands, derived from the requested output path. */
function variantPath(output, variant) {
    if (!variant.suffix) return output
    const parsed = path.parse(output)
    return path.join(parsed.dir, parsed.name + variant.suffix + parsed.ext)
}

function main() {
    const options = parseArgs(process.argv.slice(2))
    if (!fs.existsSync(options.input)) fail(`input file not found: ${options.input}`)

    const allRegions = regionList(options.input)
    const regions = selectRegions(allRegions, options.regions)

    for (const variant of options.variants) {
        const result = build({ path: options.input }, allRegions, regions, {
            ...options,
            ipv6: variant.ipv6,
        })
        const output = variantPath(options.output, variant)
        fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true })
        fs.writeFileSync(output, result.text)
        process.stdout.write(
            `converted ${options.input} -> ${output} ` +
                `(${result.groups.length} groups, ${result.rules.length} rules, ` +
                `${Object.keys(result.providers).length} rule-providers, ${variant.name})\n`,
        )
    }
}

/** Ask the source script itself for its region table. */
function regionList(input) {
    const probe = runSourceScript(input, [], () => {})
    const regions = probe.regionOptions.regions
    if (!Array.isArray(regions) || regions.length === 0) fail('source script exposes no regions')
    return regions
}

if (require.main === module) main()

module.exports = { build, selectRegions, filterRules }
