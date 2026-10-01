const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { convert } = require('./convert-global-script')

const source = fs.readFileSync(path.join(__dirname, '..', 'global_script.js'), 'utf8')
const result = convert(source, { sideRouter: true })

assert.match(result, /^\[General\]/m)
assert.match(result, /^\[YAML\]/m)
assert.match(result, /EN_MODE = fake-ip/)
assert.match(result, /BYPASS_GATEWAY_COMPATIBLE = 1/)
assert.match(result, /path: \.\/rule_provider\/lipiston\.yaml/)
assert.match(result, /RULE-SET,lipiston,DIRECT/)
assert.match(result, /DOMAIN-SUFFIX,warframe\.com,DIRECT/)
assert.match(result, /DOMAIN-KEYWORD,postman,默认节点/)
assert.match(result, /name: 国外AI/)
assert.match(result, /name: Github/)
assert.doesNotMatch(result, /- MATCH,/) // MATCH from the desktop script must not preempt Kitty rules.
assert.doesNotMatch(result, /PROCESS-NAME,/) // Process rules are not valid for router-side clients.

const disabled = convert(source.replace('openai: true', 'openai: false'), { sideRouter: true })
assert.doesNotMatch(disabled, /DOMAIN-SUFFIX,openai\.com,国外AI/)
assert.match(disabled, /DOMAIN-SUFFIX,warframe\.com,DIRECT/)

const out = path.join(os.tmpdir(), `openclash-converter-${process.pid}.conf`)
fs.writeFileSync(out, result)
assert.ok(fs.statSync(out).size > 1000)
fs.unlinkSync(out)

console.log('OpenClash converter tests passed')
