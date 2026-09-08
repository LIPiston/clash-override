const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const script = fs.readFileSync(path.join(__dirname, 'global_script.js'), 'utf8')
const main = new Function(`${script}\nreturn main`)()
const result = main({
    proxies: [
        { name: 'HK香港 Test', type: 'ss' },
        { name: 'JP日本 Test', type: 'ss' },
        { name: 'US美国 Test', type: 'ss' },
        { name: 'CA Node', type: 'ss' },
        { name: 'Other Test', type: 'ss' },
    ],
})

const automaticGroups = ['自动选择', '故障转移', '负载均衡']
const excludedGroups = new Set(['默认节点', ...automaticGroups])
const selectableGroups = result['proxy-groups'].filter(
    (group) => group.type === 'select' && !excludedGroups.has(group.name),
)

assert.ok(selectableGroups.length > 0, 'select groups should be generated')
for (const group of selectableGroups) {
    for (const automaticGroup of automaticGroups) {
        assert.ok(
            group.proxies.includes(automaticGroup),
            `${group.name} should include ${automaticGroup}`,
        )
    }
}

const automaticGroupTypes = Object.fromEntries(
    result['proxy-groups']
        .filter((group) => automaticGroups.includes(group.name))
        .map((group) => [group.name, group.type]),
)
assert.deepEqual(automaticGroupTypes, {
    自动选择: 'url-test',
    故障转移: 'fallback',
    负载均衡: 'load-balance',
})

const automaticGroupsByName = Object.fromEntries(
    result['proxy-groups']
        .filter((group) => automaticGroups.includes(group.name))
        .map((group) => [group.name, group]),
)

for (const group of Object.values(automaticGroupsByName)) {
    assert.equal(group.interval, 240)
    assert.equal(group.timeout, 3000)
    assert.equal(group.lazy, true)
    assert.equal(group['max-failed-times'], 3)
    assert.equal(group.url, 'https://www.gstatic.com/generate_204')
}
assert.equal(automaticGroupsByName['自动选择'].tolerance, 100)

const regionGroup = result['proxy-groups'].find((group) => group.name === 'HK香港')
assert.equal(regionGroup.type, 'url-test')
assert.equal(regionGroup.proxies.includes('自动选择'), false)
assert.equal(regionGroup.interval, 240)
assert.equal(regionGroup.timeout, 3000)
assert.equal(regionGroup.lazy, false)
assert.equal(regionGroup['max-failed-times'], 3)
assert.equal(regionGroup.tolerance, 100)
assert.equal(regionGroup.url, 'https://www.gstatic.com/generate_204')

const detectedRegionGroup = result['proxy-groups'].find((group) => group.name === 'CA加拿大')
assert.equal(detectedRegionGroup.type, 'url-test')
assert.equal(detectedRegionGroup.interval, 240)
assert.equal(detectedRegionGroup.lazy, false)

const regionSiteGroups = ['日本网站', '香港网站', '美国网站', '俄罗斯网站']
for (const groupName of regionSiteGroups) {
    assert.equal(
        result['proxy-groups'].some((group) => group.name === groupName),
        false,
        `${groupName} should be disabled by default`,
    )
}

const generatedRules = result.rules
const bingComRule = 'DOMAIN-SUFFIX,bing.com,微软服务'
const bingNetRule = 'DOMAIN-SUFFIX,bing.net,微软服务'
const aiRule = 'RULE-SET,ai,国外AI'
assert.ok(generatedRules.includes(bingComRule), 'Bing.com should use 微软服务')
assert.ok(generatedRules.includes(bingNetRule), 'Bing.net should use 微软服务')
assert.ok(
    generatedRules.indexOf(bingComRule) < generatedRules.indexOf(aiRule),
    'Bing.com should be evaluated before the AI rule set',
)
assert.ok(
    generatedRules.indexOf(bingNetRule) < generatedRules.indexOf(aiRule),
    'Bing.net should be evaluated before the AI rule set',
)
assert.ok(
    generatedRules.includes('DOMAIN-KEYWORD,tailscale,DIRECT'),
    'Tailscale domains should bypass the proxy',
)
assert.ok(
    generatedRules.includes('PROCESS-NAME,RustDesk,DIRECT'),
    'RustDesk should bypass the proxy',
)
assert.ok(
    generatedRules.includes('PROCESS-NAME,RustDesk.exe,DIRECT'),
    'RustDesk.exe should bypass the proxy',
)
assert.ok(
    result.dns['fake-ip-filter'].includes('+.tailscale.com'),
    'Tailscale domains should not receive Fake-IP addresses',
)
assert.ok(
    result.sniffer['skip-domain'].includes('+.tailscale.com'),
    'Tailscale domains should bypass sniffing',
)
for (const disabledSiteGroup of regionSiteGroups) {
    assert.equal(
        generatedRules.some((rule) => rule.endsWith(`,${disabledSiteGroup}`)),
        false,
        `disabled ${disabledSiteGroup} should not receive generated rules`,
    )
}

const otherExternalGroup = result['proxy-groups'].find((group) => group.name === '其他外网')
assert.ok(otherExternalGroup, '其他外网 group should be generated')
assert.equal(otherExternalGroup.proxies.includes('国内网站'), false)

const downloadGroup = result['proxy-groups'].find((group) => group.name === '下载软件')
assert.ok(downloadGroup, '下载软件 group should be generated')
assert.equal(downloadGroup.proxies.includes('国内网站'), false)

console.log('Selectable group automatic option checks passed')
