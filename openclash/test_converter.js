#!/usr/bin/env node
'use strict'

/**
 * Regression tests for openclash/convert-global-script.js.
 *
 * The converter executes global_script.js inside a vm sandbox, so the tests mutate
 * the source text and assert that the mutation shows up in the module. A static
 * copy of the generated content would fail every one of these.
 */

const assert = require('node:assert/strict')
const cp = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const converter = path.join(__dirname, 'convert-global-script.js')
const source = fs.readFileSync(path.join(root, 'global_script.js'), 'utf8')
const modulePath = path.join(__dirname, 'lipiston-side-router')

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-converter-'))
const input = path.join(work, 'input.js')
let counter = 0

/**
 * Convert `text` and return the paths of every module the run emitted. A plain run emits
 * both variants; `--ipv6` / `--no-ipv6` narrows it to one.
 */
function convert(text, extra = []) {
    fs.writeFileSync(input, text)
    const output = path.join(work, `module-${++counter}`)
    const result = cp.spawnSync(process.execPath, [converter, input, output, ...extra], {
        encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    return { stdout: result.stdout, v4: output, v4v6: `${output}-v4v6` }
}

/** Convert `text` and return the requested variant of the generated module. */
function run(text, extra = [], variant = 'v4') {
    const paths = convert(text, extra)
    assert.ok(fs.existsSync(paths[variant]), `${variant} was not emitted: ${paths[variant]}`)
    return fs.readFileSync(paths[variant], 'utf8')
}

/**
 * Minimal reader for the generated `proxy-groups!` block, enough to check that
 * every group member actually exists.
 */
/** The emitter single-quotes names it cannot write as a plain YAML scalar. */
function unquote(value) {
    const match = value.match(/^'(.*)'$/)
    return match ? match[1] : value
}

function readGroups(text) {
    const groups = []
    let current = null
    let inGroups = false
    let inProxies = false
    for (const line of text.split('\n')) {
        if (/^proxy-groups!:$/.test(line)) {
            inGroups = true
            continue
        }
        if (/^(rule-providers|\+rules|rules!|\[YAML\]):?$/.test(line)) {
            inGroups = false
            inProxies = false
            continue
        }
        if (!inGroups) continue

        const item = line.match(/^ {2}- name: (.+)$/)
        if (item) {
            current = { name: unquote(item[1]), proxies: [] }
            groups.push(current)
            inProxies = false
            continue
        }
        const exclude = line.match(/^ {4}exclude-filter: '(.*)'$/)
        if (exclude && current) {
            current.excludeFilter = exclude[1]
            inProxies = false
            continue
        }
        if (/^ {4}proxies:$/.test(line)) {
            inProxies = true
            continue
        }
        const member = line.match(/^ {6}- (.+)$/)
        if (inProxies && member && current) {
            current.proxies.push(unquote(member[1]))
            continue
        }
        if (/^ {4}\S/.test(line)) inProxies = false
    }
    return groups
}

function checkReferences(text, label, extra = []) {
    const groups = readGroups(text)
    const defined = new Set(groups.map((group) => group.name))
    for (const name of ['直连', 'DIRECT', 'REJECT', ...extra]) defined.add(name)
    for (const group of groups) {
        for (const member of group.proxies) {
            assert.ok(
                defined.has(member),
                `${label}: group ${group.name} references undefined proxy ${member}`,
            )
        }
        assert.ok(
            !group.proxies.includes(group.name),
            `${label}: group ${group.name} references itself`,
        )
    }

    // A cycle of any length (not just a self-reference) makes mihomo refuse the
    // config with `loop is detected in ProxyGroup, please check following
    // ProxyGroups: [A B]`. Walk the group graph depth-first and report the trail.
    const members = new Map(groups.map((group) => [group.name, group.proxies]))
    const state = new Map()
    const walk = (name, trail) => {
        if (state.get(name) === 2) return
        if (state.get(name) === 1) {
            assert.fail(`${label}: proxy group loop ${[...trail, name].join(' -> ')}`)
        }
        state.set(name, 1)
        for (const member of members.get(name) || []) {
            if (members.has(member)) walk(member, [...trail, name])
        }
        state.set(name, 2)
    }
    for (const group of groups) walk(group.name, [])

    return groups
}

// ---------------------------------------------------------------------------
// 1. One run emits both variants, and both committed modules are current.
// ---------------------------------------------------------------------------
const dualStackPath = path.join(__dirname, 'lipiston-side-router-v4v6')
const plainRun = convert(source)
assert.ok(fs.existsSync(plainRun.v4), 'every run must emit the IPv4-only module')
assert.ok(fs.existsSync(plainRun.v4v6), 'every run must emit the dual-stack module')
for (const [variant, file] of [['v4', plainRun.v4], ['v4v6', plainRun.v4v6]]) {
    assert.ok(plainRun.stdout.includes(file), `the run must report the ${variant} module it wrote`)
}

const committed = fs.readFileSync(modulePath, 'utf8')
assert.equal(
    committed,
    run(source, ['--no-ipv6']),
    'openclash/lipiston-side-router is stale: re-run openclash/convert-global-script.js',
)
assert.equal(
    fs.readFileSync(dualStackPath, 'utf8'),
    run(source, ['--ipv6'], 'v4v6'),
    'openclash/lipiston-side-router-v4v6 is stale: re-run openclash/convert-global-script.js',
)
// The two differ in the IPv6 switches and nothing else, so picking one is a pure transport
// decision -- the rule set, groups and providers stay identical. Covers both spellings: the
// UCI keys (`IPV6_ENABLE`, `ENABLE_V6_UDP_PROXY`, `FAKEIP_RANGE6`) and the YAML ones
// (`ipv6`, `fake-ip-range6`).
const IPV6_SETTING = /ipv6|v6_udp|range6/i
assert.deepEqual(
    run(source, ['--ipv6'], 'v4v6').split('\n').filter((line) => !IPV6_SETTING.test(line)),
    run(source, ['--no-ipv6']).split('\n').filter((line) => !IPV6_SETTING.test(line)),
    'the dual-stack and IPv4-only modules must differ only in their IPv6 settings',
)

// ---------------------------------------------------------------------------
// 2. Desktop-only constructs never reach a router-side core.
// ---------------------------------------------------------------------------
let out = run(source)
assert.match(out, /^\[General\]$/m)
assert.match(out, /^EN_MODE = fake-ip$/m)
assert.match(out, /^\[YAML\]$/m)
assert.match(out, /^proxies\+:$/m)
assert.match(out, /^proxy-groups!:$/m, 'the group tree must be replaced, not appended')
assert.doesNotMatch(out, /^proxy-groups\+:$/m, 'appending would leave a second selector tree behind')
assert.match(out, /^\+rules:$/m)
assert.doesNotMatch(out, /^rules!:$/m, 'taking the rule list over is opt-in')
assert.doesNotMatch(out, /PROCESS-NAME,/, 'process rules cannot work on a router')
assert.doesNotMatch(out, /^ {2}- MATCH,/m, 'the desktop MATCH would preempt OpenClash rules')
assert.doesNotMatch(out, /^tun:$/m, 'the side router must not enable TUN by default')
assert.match(out, /^sniffer:$/m)

// The DNS block is carried over whole, not collapsed to a few lines.
assert.match(out, /^ {2}enhanced-mode: fake-ip$/m)
assert.match(out, /^ {2}fake-ip-filter-mode: blacklist$/m)
assert.match(out, /^ {2}nameserver-policy:$/m)
assert.match(out, /'geosite:geolocation-!cn'/)
assert.match(out, /^ {2}fallback-filter:$/m)
// The side router blocks ads through AWAvenue alone, so the source script's ad DNS policy is
// dropped here. The desktop script keeps it.
assert.doesNotMatch(out, /geosite:category-ads-all/, 'ads DNS policy must not reach the router')

// Runtime keys the desktop script sets.
assert.match(out, /^find-process-mode: strict$/m)
assert.match(out, /^ {2}store-fake-ip: true$/m)
assert.match(out, /^ {2}server: cn\.ntp\.org\.cn$/m)
assert.match(out, /^ {6}ports:$/m, 'the sniffer port map must survive as nested YAML')

// ---------------------------------------------------------------------------
// 3. Rule providers: the personal ruleset is local, the rest stay remote.
// ---------------------------------------------------------------------------
assert.match(out, /^rule-providers:$/m)
assert.match(out, /^ {4}type: file$/m)
assert.match(out, /path: '\.\/rule_provider\/lipiston\.yaml'/)
assert.match(out, /path: '\.\/rule_provider\/ai\.list'/)
assert.match(out, /path: '\.\/rule_provider\/AWAvenue-Ads-Rule-Clash-Classical\.yaml'/)
// The ad ruleset is a YAML classical list, not a binary domain list.
assert.match(out, /^ {2}AWAvenue-Ads-Rule:$/m)
assert.match(out, /^ {4}behavior: classical$/m)
assert.match(out, /^ {4}format: yaml$/m)
assert.match(out, /url: 'https:\/\/github\.boki\.moe\/https:\/\/raw\.githubusercontent\.com\/TG-Twilight\/AWAvenue-Ads-Rule\//)
assert.doesNotMatch(out, /217heidai/, 'the old adblockfilters ruleset must be gone')
assert.match(out, /^ {2}- RULE-SET,applications,下载软件$/m)
assert.match(out, /^ {2}- RULE-SET,AWAvenue-Ads-Rule,广告过滤$/m)
// AWAvenue replaces the source script's own geosite ad rule on the side router.
assert.doesNotMatch(out, /^ {2}- GEOSITE,category-ads-all,/m, 'ads must go through AWAvenue only')
assert.match(source, /GEOSITE,category-ads-all,广告过滤/, 'the desktop script must keep its ad rule')

// ---------------------------------------------------------------------------
// 4. The source is really executed: a new rule must propagate.
// ---------------------------------------------------------------------------
const mutated = source.replace(
    "domainSuffix: ['warframe.com'",
    "domainSuffix: ['converter-new.example', 'warframe.com'",
)
assert.notEqual(mutated, source, 'test fixture no longer matches global_script.js')
out = run(mutated)
assert.match(out, /^ {2}- DOMAIN-SUFFIX,converter-new\.example,DIRECT$/m)
assert.match(out, /^ {2}- DOMAIN-SUFFIX,warframe\.com,DIRECT$/m)

// ---------------------------------------------------------------------------
// 5. Feature switches still gate groups, rules and providers.
// ---------------------------------------------------------------------------
out = run(source.replace('openai: true', 'openai: false'))
assert.doesNotMatch(out, /^ {2}- RULE-SET,ai,国外AI$/m)
assert.doesNotMatch(out, /^ {2}- name: 国外AI$/m)
assert.doesNotMatch(out, /ai\.list/, 'the ai provider must disappear with its switch')
assert.match(out, /^ {2}- RULE-SET,lipiston,DIRECT$/m, 'other features must survive')

// ---------------------------------------------------------------------------
// 6. Group set, order and membership.
// ---------------------------------------------------------------------------
out = run(source)
const groups = checkReferences(out, 'default')
assert.deepEqual(
    groups.map((group) => group.name),
    [
        // The source script's main selector, published under the name the subscription's own
        // rules (and OpenClash's own UI) already point at.
        '节点选择', '国外AI', 'YouTube', 'Spotify', 'Pixiv', '国外社区', '游戏专用',
        '广告过滤', '苹果服务', '谷歌服务', 'Github', '微软服务', '下载软件',
        '其他外网', '国内网站', '自动选择', '故障转移', '负载均衡',
        // All 20 regions the source script knows about, in the source script's own order.
        'HK香港', 'US美国', 'JP日本', 'KR韩国', 'SG新加坡', 'CN中国大陆', 'TW台湾省',
        'GB英国', 'DE德国', 'MY马来西亚', 'TK土耳其', 'CA加拿大', 'FR法国', 'GR希腊',
        'LT立陶宛', 'MK北马其顿', 'NL荷兰', 'PL波兰', 'SE瑞典', 'AR阿根廷',
        '其他节点',
    ],
)
const mainGroup = groups.find((group) => group.name === '节点选择')
assert.ok(mainGroup.proxies.includes('自动选择'))
assert.ok(mainGroup.proxies.includes('直连'))

// Replacing the tree makes a name collision impossible, so the source script's bare auto-test
// names are emitted as they are. Appending them instead (`proxy-groups+`) is what used to make
// mihomo refuse to start: Parse config error: ProxyGroup 自动选择: duplicate group name.
for (const name of ['自动选择', '故障转移', '负载均衡']) {
    assert.match(out, new RegExp(`^ {2}- name: '?${name}'?$`, 'm'), `${name} must be emitted`)
}
assert.doesNotMatch(out, /·模块/, 'the old namespace suffix must be gone')
// Nothing may still call the main selector by the source script's own name: the subscription's
// rules and OpenClash's UI expect `节点选择`, and our rules must be repointed at it.
assert.doesNotMatch(out, /默认节点/, 'the source name must never reach the router config')
assert.match(out, /,节点选择$/m, 'the source rules must be repointed at the published name')

// Region groups select their members at runtime instead of hardcoding node names.
const hongkong = groups.find((group) => group.name === 'HK香港')
assert.deepEqual(hongkong.proxies, [], 'region groups must not list synthetic node names')
// The source regexes carry the /i flag. The router regex must stay case-insensitive or a node
// named "Hong Kong" falls through into the catch-all instead of the HK group.
assert.match(out, /^ {4}filter: '\(\?i\)港\|香港/m)
assert.match(out, /^ {4}filter: '\(\?i\)美\|/m)
// High-ratio nodes stay in their region group. The desktop script's static pass does drop
// them, but its autoDetect pass re-claims them by country code without ever reading the
// ratio, so the desktop config keeps them too. A ratio exclude-filter here would instead
// strand them in no group at all, because the region filter also keeps them out of 其他节点.
const filtered = groups.filter((group) => group.excludeFilter).map((group) => group.name)
assert.deepEqual(filtered, ['其他节点'], 'only the catch-all may carry an exclude-filter')

// Every region the source script knows about is generated by default, so the catch-all exists
// purely for nodes that match no region regex at all.
const otherNode = groups.find((group) => group.name === '其他节点')
assert.ok(otherNode.excludeFilter, '其他节点 must carry an exclude-filter')
assert.match(otherNode.excludeFilter, /^\(\?i\)/, '其他节点 must stay case-insensitive')
for (const token of ['港', '美', '荷', '立陶宛', '阿根廷', '🇦🇷']) {
    assert.ok(
        otherNode.excludeFilter.includes(token),
        `其他节点 must exclude every known region (missing ${token})`,
    )
}

// ---------------------------------------------------------------------------
// 7. Region selection, region collisions and the catch-all group.
// ---------------------------------------------------------------------------
out = run(source, ['--regions=HK,JP'])
checkReferences(out, 'regions=HK,JP')
assert.match(out, /^ {2}- name: HK香港$/m)
assert.match(out, /^ {2}- name: JP日本$/m)
assert.doesNotMatch(out, /US美国/)
assert.match(out, /^ {2}- name: 其他节点$/m)
assert.match(out, /^ {4}include-all: true$/m, 'catch-all must pick up unselected regions')
// The source script's regexes overlap (新加坡 contains 加, so it also lands in the Canada
// group). A region that was not requested must not leak in even though the source created it.
assert.doesNotMatch(out, /CA加拿大/)
assert.doesNotMatch(out, /^ {2}- name: CN中国大陆$/m)
// ... and nodes of that unrequested region must still stay out of the catch-all.
const narrowOther = readGroups(out).find((group) => group.name === '其他节点')
assert.ok(narrowOther.excludeFilter.includes('荷'), 'catch-all excludes ungenerated regions too')

// ---------------------------------------------------------------------------
// 8. Taking the rule list over as well is opt-in, and keeps the source MATCH.
// ---------------------------------------------------------------------------
out = run(source, ['--replace-rules'])
assert.match(out, /^rules!:$/m, 'the takeover must force-replace the rule list')
assert.doesNotMatch(out, /^\+rules:$/m)
assert.match(out, /^ {2}- MATCH,其他外网$/m, 'a takeover needs the source catch-all back')
checkReferences(out, 'replace-rules')
out = run(source)
assert.doesNotMatch(out, /^rules!:$/m)
assert.doesNotMatch(out, /^ {2}- MATCH,/m, 'prepending leaves the catch-all to OpenClash')

// ---------------------------------------------------------------------------
// 9. IPv6 toggles both the UCI section and the YAML DNS block.
// ---------------------------------------------------------------------------
out = run(source, ['--ipv6'], 'v4v6')
assert.match(out, /^IPV6_ENABLE = 1$/m)
assert.match(out, /^IPV6_DNS = 1$/m)
assert.match(out, /^ENABLE_V6_UDP_PROXY = 1$/m)
assert.match(out, /^FAKEIP_RANGE6 = fdfe:dcba:9876::1\/64$/m)
assert.match(out, /^ {2}ipv6: true$/m)
assert.match(out, /^ {2}fake-ip-range6: 'fdfe:dcba:9876::1\/64'$/m)

out = run(source, ['--no-ipv6'])
assert.match(out, /^IPV6_ENABLE = 0$/m)
assert.match(out, /^IPV6_DNS = 0$/m)
assert.match(out, /^ENABLE_V6_UDP_PROXY = 0$/m)
assert.match(out, /^ {2}ipv6: false$/m)
assert.doesNotMatch(out, /fake-ip-range6/)

// ---------------------------------------------------------------------------
// 10. The [General] section is UCI, not YAML.
// ---------------------------------------------------------------------------
assert.equal(run(source).slice(0, 10).split('\n')[0], '[General]')
assert.doesNotMatch(run(source).slice(0, 400), /^[A-Z_]+: /m)

// ---------------------------------------------------------------------------
// 11. Geodata policy: the switch that decides what a side router downloads.
//
// The `[General]` keys below are written by OpenClash into `openclash.@overwrite[0]`,
// and every consumer reads them through `uci_get_config`, which checks that section
// BEFORE `openclash.config` (/usr/share/openclash/uci.sh). So the module really does
// override the LuCI settings page, and these five keys are what keep `GeoIP.dat`
// (~16.5 M) and `ASN.mmdb` (~12.1 M) from being re-downloaded on a flash-bound box.
// ---------------------------------------------------------------------------
out = run(source)
assert.match(out, /^ENABLE_GEOIP_DAT = 0$/m, 'OpenClash must also be told to use mmdb mode')
assert.match(out, /^GEOIP_AUTO_UPDATE = 0$/m, 'GeoIP.dat is unused in mmdb mode')
assert.match(out, /^GEOASN_AUTO_UPDATE = 0$/m, 'no ASN rule is in use')
assert.match(out, /^GEO_AUTO_UPDATE = 1$/m, 'Country.mmdb is the GEOIP source and must stay fresh')
assert.match(out, /^GEOSITE_AUTO_UPDATE = 1$/m, 'GeoSite.dat must stay fresh')

// The same policy on the YAML side, plus the core updater being left off so it does not
// race OpenClash's own weekly cron over the same four files.
assert.match(out, /^geodata-mode: false$/m)
assert.match(out, /^geodata-loader: memconservative$/m)
assert.doesNotMatch(out, /^geo-auto-update:/m, 'the core updater must be off by default')
assert.doesNotMatch(out, /^geox-url:$/m)
assert.doesNotMatch(out, /^geo-update-interval:/m)

const withUpdate = run(source, ['--geo-update'])
assert.match(withUpdate, /^geo-auto-update: true$/m)
assert.match(withUpdate, /^geo-update-interval: 24$/m)
assert.match(withUpdate, /^geox-url:$/m)
// The UCI switches are about which databases a side router needs, not about who updates
// them, so `--geo-update` must not flip GeoIP.dat / ASN.mmdb back on.
assert.match(withUpdate, /^GEOIP_AUTO_UPDATE = 0$/m)
assert.match(withUpdate, /^GEOASN_AUTO_UPDATE = 0$/m)

fs.rmSync(work, { recursive: true, force: true })
console.log('PASS: openclash/convert-global-script.js regression tests')
