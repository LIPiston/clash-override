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

const regionGroup = result['proxy-groups'].find((group) => group.name === 'HK香港')
assert.equal(regionGroup.type, 'url-test')
assert.equal(regionGroup.proxies.includes('自动选择'), false)

console.log('Selectable group automatic option checks passed')
