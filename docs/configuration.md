# 自定义你自己的规则

没有生成器，直接编辑 `global_script.js` 顶部与 `main` 函数里的配置即可，改完导入客户端生效。

## 1. 总开关

```javascript
const enable = true            // 脚本总开关（Mihomo Party 保持 true）
const enableUrltest = false    // true=地区分组也用自动选延迟最低节点，false=手动 select
```

## 自动测速策略组（参考 ACL4SSR Full MultiMode）

脚本会自动生成三个从**所有节点**里自动测速选择的顶层策略组，并作为「默认节点」的可选项：

| 策略组 | 类型 | 作用 |
|--------|------|------|
| 自动选择 | `url-test` | 自动切换到延迟最低的节点 |
| 故障转移 | `fallback` | 优先用第一个可用节点，故障时自动切换 |
| 负载均衡 | `load-balance` | 在多节点间分摊流量 |

```javascript
const autoTestOptions = {
    enable: true,            // 自动测速总开关
    url: 'http://www.gstatic.com/generate_204', // 测速地址
    interval: 300,           // 测速间隔（秒）
    timeout: 3000,           // 单节点超时（毫秒）
    tolerance: 50,           // url-test 延迟容差（毫秒）
}
```

## 2. 分流规则开关

在 `ruleOptions` 里把不需要的置为 `false`：

```javascript
const ruleOptions = {
    apple: true,     // 苹果服务
    microsoft: true, // 微软服务
    openai: true,    // 国外 AI / GPT
    youtube: true,   // YouTube
    netflix: false,  // 按需开启
    telegram: false, // 按需开启
    ads: true,       // 广告过滤
    // ...
}
```

## 3. 地区节点分组

`regionOptions.regions` 里的 `regex` 负责按节点名匹配地区，`ratioLimit` 是倍率上限：

```javascript
const regionOptions = {
    excludeHighPercentage: true, // 排除高倍率节点
    autoDetect: true,            // 未匹配节点自动识别建组
    regions: [
        { name: 'HK香港', regex: /港|香港|hk|HK/i, ratioLimit: 5 },
        // ...
    ],
}
```

## 4. 自定义分流规则

在 `defaultCustomRules` 里追加域名 / 关键词 / 进程规则：

### 强制代理规则（无视地区）

「强制代理」集中在 `defaultCustomRules.forceProxy` 里，这些地址**无视地区自动匹配**，始终走代理（默认节点）。优先级最高，放在所有规则最前面。当前为空：

```javascript
const defaultCustomRules = {
    forceProxy: {
        target: '默认节点',
        domainSuffix: ['example.com'],   // 域名后缀
        domainKeyword: ['keyword'],      // 域名关键词
        domain: ['exact.example.com'],   // 精确域名
        processName: ['App.exe'],        // 进程名
        ipCidr: ['1.2.3.0/24'],          // IP 段
        ruleSets: [],                    // 规则集
    },
    defaultProxy: {
        target: '默认节点',
        domainSuffix: ['example.com'],   // 域名后缀
        domainKeyword: ['keyword'],      // 域名关键词
        domain: ['exact.example.com'],   // 精确域名
        processName: ['App.exe'],        // 进程名
        ruleSets: [],                    // 规则集
    },
}
```

### 直连规则（不走代理）

「直连规则」集中在 `defaultCustomRules.direct` 里，想走直连的域名 / 关键词 / 进程直接往对应数组里加即可：

```javascript
const defaultCustomRules = {
    direct: {
        target: 'DIRECT',
        domainSuffix: ['warframe.com', 'example.com'],  // 域名后缀直连
        domainKeyword: ['lipiston', 'keyword'],         // 关键词直连（匹配到即直连）
        domain: ['exact.example.com'],                  // 精确域名直连
        processName: ['SunloginClient', 'AnyDesk'],     // 进程直连
        ipCidr: ['100.64.0.0/10'],                      // IP 段直连（已内置 Tailscale 网段）
        ruleSets: [],                                   // 规则集直连
    },
}
```

已内置的直连项：Tailscale 网段 `100.64.0.0/10`，以及关键词 `lipiston`（方便放行你自己的内网服务 / 域名）。

## 5. DNS 与嗅探

DNS 与嗅探不再由脚本覆盖，直接使用客户端（Mihomo Party）里已配置好的设置。完整配置记录见 [`dns-and-sniffer.md`](dns-and-sniffer.md)。

## Strict Mode（严格模式）

在校园网等受限网络下，可以再挂一个 [`strict-mode.js`](../strict-mode.js) 作为最终安全收口：

- 关闭 LAN 暴露（`allow-lan=false`、`bind-address=127.0.0.1`），端口仅限本机
- 健康检查统一收敛为 HTTPS 测速地址，间隔拉长到 900s，降低明文探测特征与探测流量
- 自动剔除弱链路节点：`skip-cert-verify`、旧 SS 流密码（CFB/RC4/Table）、无 TLS/Reality 的 VMess/VLESS
- DNS 走国内 DoH + 国外 fallback，禁用 IPv6 AAAA 侧信道；TUN 排除局域网/Tailscale 网段

> ⚠️ 与 `global_script.js` 是**两个独立的覆写脚本文件**，各自带一个 `main()`，不要合并进同一个文件（后定义的 `main()` 会覆盖前者）。

## 故障排查

- 脚本不生效：检查 `enable` 是否为 `true`，配置里是否有可用节点。
- 分组不对：调整对应地区的 `regex` 正则，或关闭 `autoDetect`。
- 内核启动失败、日志报 `country code hk not found in geoip.dat`：geodata 地址还是精简版 `geoip-lite.dat`，改成完整版 `geoip.dat`（见 README「必须配置：geodata 地址」）。
- DNS / 嗅探问题：脚本不再接管这两项，检查客户端自己的 DNS / 嗅探设置，见 [`dns-and-sniffer.md`](dns-and-sniffer.md)。
