/**
 * Clash Party / Mihomo Strict Mode 覆写
 * 目标：在现有订阅和全局覆写之后做最终安全收口。
 * - 本地端口仅限本机，关闭 LAN 暴露
 * - TUN/DNS/sniffer 使用 Windows 兼容且较安全的保守基线
 * - 所有策略组/代理提供者健康检查改为 HTTPS，降低校园网侧明文特征和劫持风险
 * - 健康检查间隔拉长到 900s，减少重复探测流量
 * - 删除明显弱链路节点：skip-cert-verify、旧 SS cipher、无 TLS/Reality 的 VMess/VLESS
 *
 * 用法：作为第二个覆写脚本，在 global_script.js 之后执行。
 * 两个文件各自有一个 main()，不要合并到同一个文件里，否则后定义的 main() 会覆盖前者。
 */

const SAFE_TEST_URL = 'https://www.gstatic.com/generate_204'
const MIN_INTERVAL = 900

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v)
}

function isSafeProxy(p) {
  if (!isObject(p)) return true
  if (p.type === 'direct') return true
  const type = String(p.type || '').toLowerCase()
  const cipher = String(p.cipher || '').toLowerCase()
  if (p['skip-cert-verify'] === true) return false
  // 旧版非 AEAD 流密码（chacha20-ietf-poly1305 等 AEAD 不在其中）
  if ((type === 'ss' || type === 'shadowsocks') && /(cfb|rc4|table|none|^chacha20(-ietf)?$)/.test(cipher)) return false
  // VMess/VLESS 必须带 TLS 或 Reality，否则链路内容在校园网里可被 DPI 直接识别
  if ((type === 'vmess' || type === 'vless') && !(p.tls || p['reality-opts'])) return false
  return true
}

/**
 * 健康检查收口。注意区分两类对象：
 * - 策略组：顶层 url/interval/lazy 就是健康检查字段，可统一替换；
 * - 代理提供者：顶层 url/interval 是订阅拉取地址和刷新间隔，绝不能动，
 *   只有内嵌的 health-check 才是测速配置。
 */
function sanitizeHealthCheck(obj, isProvider) {
  if (!isObject(obj)) return
  if (isObject(obj['health-check'])) {
    sanitizeHealthCheck(obj['health-check'], false)
  }
  if (isProvider) return
  // 统一收敛到单一 HTTPS 测速地址：消除 http 明文探测特征，且全网内探测指纹一致
  if (typeof obj.url === 'string') obj.url = SAFE_TEST_URL
  if (obj.interval == null || Number(obj.interval) < MIN_INTERVAL) {
    obj.interval = MIN_INTERVAL
  }
  obj.lazy = true
}

function unique(arr) {
  const seen = new Set()
  const out = []
  for (const x of arr || []) {
    if (x == null) continue
    const k = String(x)
    if (!seen.has(k)) {
      seen.add(k)
      out.push(x)
    }
  }
  return out
}

function main(config) {
  if (!isObject(config)) return config

  // 本地暴露收口。
  // external-controller 由客户端（Verge Rev / Mihomo Party）在脚本之后自行注入到
  // 127.0.0.1，这里不覆盖，避免清空后客户端连不上核心。
  config['allow-lan'] = false
  config['bind-address'] = '127.0.0.1'
  config.mode = 'rule'

  // 节点安全过滤：当前 Kitty/VLESS TLS 不会被删；以后误加弱节点会被自动排除。
  // 记录被删节点名，稍后从策略组成员里剔除（代理提供者的节点运行时才加载，不受影响）。
  const removedProxyNames = new Set()
  if (Array.isArray(config.proxies)) {
    config.proxies = config.proxies.filter((p) => {
      const ok = isSafeProxy(p)
      if (!ok && p && p.name) removedProxyNames.add(p.name)
      return ok
    })
  }

  // DNS：国内 DoH + 国外 fallback，fake-ip，尊重规则，禁用 DNS AAAA 查询以减少 IPv6 侧信道。
  config.dns = {
    enable: true,
    ipv6: false,
    'enhanced-mode': 'fake-ip',
    'fake-ip-range': '198.18.0.1/16',
    'fake-ip-filter-mode': 'blacklist',
    'fake-ip-filter': unique([
      '+.lan', '+.local', 'localhost',
      'time.*.com', 'ntp.*.com',
      '+.market.xiaomi.com',
      'localhost.ptlogin2.qq.com',
      '+.qq.com', '+.tencent.com', '+.gtimg.com', '+.gtimg.cn', '+.qpic.cn', '+.myqcloud.com', '+.idqqimg.com', '+.qlogo.cn',
      '+.msftconnecttest.com', '+.msftncsi.com', '+.xboxlive.com'
    ]),
    'use-hosts': true,
    'use-system-hosts': true,
    'respect-rules': true,
    'prefer-h3': false,
    'default-nameserver': ['223.5.5.5', '223.6.6.6', '119.29.29.29'],
    nameserver: ['https://dns.alidns.com/dns-query', 'https://doh.pub/dns-query'],
    'direct-nameserver': ['https://dns.alidns.com/dns-query', 'https://doh.pub/dns-query'],
    'proxy-server-nameserver': ['https://dns.alidns.com/dns-query', 'https://doh.pub/dns-query'],
    fallback: ['https://cloudflare-dns.com/dns-query', 'https://dns.google/dns-query'],
    'fallback-filter': {
      geoip: true,
      'geoip-code': 'CN',
      ipcidr: ['240.0.0.0/4', '0.0.0.0/32'],
      domain: ['+.google.com', '+.facebook.com', '+.youtube.com', '+.github.com', '+.githubusercontent.com', '+.twitter.com', '+.x.com', '+.telegram.org', '+.openai.com', '+.chatgpt.com', '+.anthropic.com']
    },
    'nameserver-policy': {
      'geosite:category-ads-all': 'rcode://success',
      'geosite:cn,geolocation-cn,private': ['https://dns.alidns.com/dns-query', 'https://doh.pub/dns-query'],
      'geosite:geolocation-!cn': ['https://cloudflare-dns.com/dns-query', 'https://dns.google/dns-query']
    }
  }

  // Windows/Tailscale/LAN 兼容优先的 TUN。fc00::/7 比 fd00::/8 更完整。
  config.tun = {
    enable: true,
    stack: 'system',
    'auto-route': true,
    'auto-redirect': false,
    'auto-detect-interface': true,
    'dns-hijack': ['any:53'],
    'route-exclude-address': [
      '10.0.0.0/8',
      '100.64.0.0/10',
      '172.16.0.0/12',
      '192.168.0.0/16',
      'fc00::/7',
      'fe80::/10'
    ],
    mtu: 1492,
    device: 'Mihomo',
    'strict-route': false
  }

  // 保守嗅探：保留域名恢复能力，但不强制改目的地址。
  config.sniffer = {
    enable: true,
    'parse-pure-ip': true,
    'force-dns-mapping': true,
    'override-destination': false,
    sniff: {
      HTTP: { ports: [80], 'override-destination': false },
      TLS: { ports: [443] },
      QUIC: { ports: [443] }
    },
    'force-domain': [
      '+.google.com', '+.googleapis.com', '+.gstatic.com', '+.youtube.com', '+.googlevideo.com',
      '+.github.com', '+.githubusercontent.com', '+.telegram.org', '+.openai.com', '+.chatgpt.com', '+.anthropic.com'
    ],
    'skip-domain': [
      '+.push.apple.com', '+.apple.com', '+.icloud.com', '+.mzstatic.com',
      '+.msftconnecttest.com', '+.msftncsi.com', '+.xboxlive.com',
      '+.lan', '+.local', 'localhost'
    ],
    'skip-src-address': ['127.0.0.0/8', '::1/128'],
    'skip-dst-address': [
      '10.0.0.0/8', '100.64.0.0/10', '172.16.0.0/12', '192.168.0.0/16',
      '224.0.0.0/4', '240.0.0.0/4', 'fc00::/7', 'fe80::/10'
    ]
  }

  // 健康检查收口。
  if (Array.isArray(config['proxy-groups'])) {
    for (const g of config['proxy-groups']) {
      sanitizeHealthCheck(g, false)
      if (Array.isArray(g.proxies)) {
        // 只剔除被过滤掉的弱节点；其余引用（含代理提供者节点、组名）保留
        g.proxies = g.proxies.filter((name) => !removedProxyNames.has(name))
        if (g.proxies.length === 0) g.proxies = ['直连']
      }
    }
  }
  if (isObject(config['proxy-providers'])) {
    for (const provider of Object.values(config['proxy-providers'])) {
      sanitizeHealthCheck(provider, true)
    }
  }

  // 长连接稳定性：不能让 TCP keepalive 间隔大于 idle；原先 1800s/600s 会让
  // HTTPS/WebSocket 空闲连接在首次探测前就被中间 NAT/代理清理。
  config['keep-alive-idle'] = 30
  config['keep-alive-interval'] = 30

  config['profile'] = { 'store-selected': true, 'store-fake-ip': true }

  return config
}
