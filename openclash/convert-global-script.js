const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const DEFAULTS = {
    sideRouter: true,
    ruleProviderPath: './rule_provider/lipiston.yaml',
}

const GENERAL = `[General]
# OpenClash side-router adapter. Keep Fake-IP + Rule and avoid TUN duplication.
EN_MODE = fake-ip
PROXY_MODE = rule
INTRANET_ALLOWED = 1
BYPASS_GATEWAY_COMPATIBLE = 1
ROUTER_SELF_PROXY = 1
SKIP_PROXY_ADDRESS = 1
IPV6_ENABLE = 0
IPV6_DNS = 0
DISABLE_UDP_QUIC = 1
STORE_FAKEIP = 1
ENABLE_TCP_CONCURRENT = 1
ENABLE_UNIFIED_DELAY = 1
GEODATA_LOADER = memconservative

[YAML]
# Merge runtime settings without replacing the subscription's DNS upstreams or providers.
dns:
  enable: true
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  ipv6: false
  respect-rules: true
profile:
  store-fake-ip: true
tcp-concurrent: true
unified-delay: true
geodata-loader: memconservative

`

const GROUPS = [
    ['默认节点', ['节点选择', '自动选择', 'DIRECT']],
    ['国外AI', ['默认节点', '节点选择', '自动选择', 'DIRECT']],
    ['YouTube', ['默认节点', '节点选择', '自动选择', 'DIRECT']],
    ['Spotify', ['默认节点', '节点选择', '自动选择', 'DIRECT']],
    ['Pixiv', ['默认节点', '节点选择', '自动选择', 'DIRECT']],
    ['国外社区', ['默认节点', '节点选择', '自动选择', 'DIRECT']],
    ['游戏专用', ['默认节点', '节点选择', '自动选择', 'DIRECT']],
    ['苹果服务', ['默认节点', '节点选择', '自动选择', 'DIRECT']],
    ['谷歌服务', ['默认节点', '节点选择', '自动选择', 'DIRECT']],
    ['Github', ['默认节点', '节点选择', '自动选择', 'DIRECT']],
    ['微软服务', ['默认节点', '节点选择', '自动选择', 'DIRECT']],
    ['跟踪分析', ['REJECT', 'DIRECT', '默认节点', '节点选择', '自动选择']],
    ['广告过滤', ['REJECT', 'DIRECT', '默认节点', '节点选择', '自动选择']],
    ['下载软件', ['DIRECT', 'REJECT', '默认节点', '节点选择', '自动选择']],
    ['国内网站', ['DIRECT', '默认节点', '节点选择', '自动选择']],
    ['其他外网', ['默认节点', '节点选择', '自动选择', 'DIRECT']],
]

const RULES = {
    direct: [
        ['DOMAIN-KEYWORD', 'tecostudio'], ['DOMAIN-KEYWORD', 'vitasub'],
        ['DOMAIN-SUFFIX', 'mc.windmilltown.net'], ['DOMAIN-SUFFIX', 'lvss.xyz'],
        ['IP-CIDR', '149.104.21.239/32', 'no-resolve'], ['RULE-SET', 'lipiston'],
        ['DOMAIN-SUFFIX', 'nrd.nie.163.com'], ['DOMAIN-SUFFIX', 'webapp.163.com'],
        ['DOMAIN-SUFFIX', 'gdl.netease.com'], ['DOMAIN-SUFFIX', 'fp.ps.netease.com'],
        ['DOMAIN-SUFFIX', 'warframe.com'], ['DOMAIN-SUFFIX', 'prlrr.com'],
        ['DOMAIN-SUFFIX', 'g5air.com'], ['DOMAIN-SUFFIX', 'qslk.net'],
        ['DOMAIN-SUFFIX', 'darensoft.com'], ['DOMAIN-SUFFIX', 'gzankun.com'],
        ['DOMAIN-SUFFIX', 'iydsj.com'], ['DOMAIN-KEYWORD', 'audiences'],
        ['DOMAIN-KEYWORD', 'rlzy'], ['DOMAIN-KEYWORD', 'rsxt'],
        ['DOMAIN-KEYWORD', 'g5air'], ['DOMAIN-KEYWORD', 'lipiston'],
        ['DOMAIN-KEYWORD', 'tailscale'], ['DOMAIN', 'h1.gzankun.com'],
    ],
    defaultProxy: [
        ['DOMAIN-SUFFIX', 'augmentcode.com'], ['DOMAIN-SUFFIX', 'javdb.com'],
        ['DOMAIN-SUFFIX', 'jdbstatic.com'], ['DOMAIN-KEYWORD', 'postman'],
        ['DOMAIN-KEYWORD', 'stripchat'], ['DOMAIN-KEYWORD', 'qbittorrent'],
    ],
}

const FEATURE_RULES = {
    openai: [['DOMAIN-SUFFIX', 'openai.com', '国外AI'], ['DOMAIN-SUFFIX', 'chatgpt.com', '国外AI'], ['DOMAIN-SUFFIX', 'anthropic.com', '国外AI']],
    youtube: [['DOMAIN-SUFFIX', 'youtube.com', 'YouTube'], ['DOMAIN-SUFFIX', 'googlevideo.com', 'YouTube']],
    spotify: [['DOMAIN-SUFFIX', 'spotify.com', 'Spotify'], ['DOMAIN-SUFFIX', 'scdn.co', 'Spotify']],
    pixiv: [['DOMAIN-SUFFIX', 'pixiv.net', 'Pixiv'], ['DOMAIN-SUFFIX', 'pximg.net', 'Pixiv']],
    community: [['DOMAIN-SUFFIX', 'discord.com', '国外社区'], ['DOMAIN-SUFFIX', 'facebook.com', '国外社区'], ['DOMAIN-SUFFIX', 'twitter.com', '国外社区'], ['DOMAIN-SUFFIX', 'x.com', '国外社区']],
    games: [['DOMAIN-SUFFIX', 'steamcommunity.com', '游戏专用'], ['DOMAIN-SUFFIX', 'steamstatic.com', '游戏专用']],
    google: [['DOMAIN-SUFFIX', 'google.com', '谷歌服务'], ['DOMAIN-SUFFIX', 'googleapis.com', '谷歌服务']],
    github: [['DOMAIN-SUFFIX', 'github.com', 'Github'], ['DOMAIN-SUFFIX', 'githubusercontent.com', 'Github']],
    microsoft: [['DOMAIN-SUFFIX', 'microsoft.com', '微软服务'], ['DOMAIN-SUFFIX', 'office.com', '微软服务']],
}

function readScriptData(source) {
    const sandbox = {}
    vm.runInNewContext(
        `${source}\n;globalThis.__openclashConverterData = { ruleOptions, customRules, customRuleSets }`,
        sandbox,
        { filename: 'global_script.js' },
    )
    return sandbox.__openclashConverterData
}

function customRulesToClashRules(customRules, ruleOptions) {
    const conditional = {
        microsoftSites: 'microsoft',
        japanSites: 'japan',
        hkSites: 'hongkong',
        usSites: 'unitedstates',
    }
    const result = []
    for (const [name, ruleConfig] of Object.entries(customRules || {})) {
        const option = conditional[name]
        if (option && ruleOptions[option] === false) continue
        const target = ruleConfig.target
        for (const domain of ruleConfig.domainSuffix || []) result.push(['DOMAIN-SUFFIX', domain, target])
        for (const keyword of ruleConfig.domainKeyword || []) result.push(['DOMAIN-KEYWORD', keyword, target])
        for (const domain of ruleConfig.domain || []) result.push(['DOMAIN', domain, target])
        for (const cidr of ruleConfig.ipCidr || []) {
            const [value, option] = String(cidr).split(',', 2)
            result.push(['IP-CIDR', value, option || target])
        }
        for (const provider of ruleConfig.ruleSets || []) result.push(['RULE-SET', provider, target])
    }
    return result
}

function ruleToText(rule, target) {
    const [kind, value, option] = rule
    return `  - ${kind},${value},${option || target}`
}

function convert(source, options = {}) {
    const config = { ...DEFAULTS, ...options }
    if (!config.sideRouter) throw new Error('Only sideRouter conversion is currently supported')
    const { ruleOptions, customRules, customRuleSets } = readScriptData(source)
    const lines = [GENERAL]
    lines.push('proxy-groups+:')
    for (const [name, proxies] of GROUPS) {
        lines.push(`  - name: ${name}`, '    type: select', `    proxies: [${proxies.join(', ')}]`)
    }
    lines.push('', 'rule-providers:')
    for (const [name, provider] of Object.entries(customRuleSets || {})) {
        if (name !== 'lipiston') continue
        lines.push(`  ${name}:`, '    type: file', `    behavior: ${provider.behavior}`, `    format: ${provider.format}`, `    path: ${config.ruleProviderPath}`)
    }
    lines.push('', '+rules:')
    for (const rule of customRulesToClashRules(customRules, ruleOptions)) lines.push(ruleToText(rule, rule[2]))
    for (const [feature, rules] of Object.entries(FEATURE_RULES)) {
        if (ruleOptions[feature] !== false) for (const rule of rules) lines.push(ruleToText(rule, rule[2]))
    }
    return `${lines.join('\n')}\n`
}

function main(argv = process.argv.slice(2)) {
    const input = argv[0] || 'global_script.js'
    const output = argv[1] || 'openclash/lipiston-side-router'
    const source = fs.readFileSync(path.resolve(input), 'utf8')
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true })
    fs.writeFileSync(path.resolve(output), convert(source), 'utf8')
    console.log(`converted ${input} -> ${output}`)
}

if (require.main === module) main()

module.exports = { convert, readScriptData, customRulesToClashRules }
