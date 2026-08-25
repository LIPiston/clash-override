# 配置说明

`global_script.js` 没有独立生成器，直接编辑脚本顶部的配置项即可。修改后重新导入或刷新脚本。

## 1. 总开关

```javascript
const enable = true
```

保持为 `true` 时脚本会生成完整的分组、规则和运行时配置。设为 `false` 时只保留输入配置，不再生成脚本功能。

## 2. 自动测速

脚本默认生成三个自动策略组，并加入「默认节点」候选项：

| 策略组 | 类型 | 作用 |
|--------|------|------|
| 自动选择 | `url-test` | 选择延迟较低的节点 |
| 故障转移 | `fallback` | 当前节点不可用时切换 |
| 负载均衡 | `load-balance` | 在多个节点间分配连接 |

配置位于 `autoTestOptions`：

```javascript
const autoTestOptions = {
    enable: true,
    url: 'http://www.gstatic.com/generate_204',
    interval: 900,
    timeout: 3000,
    tolerance: 50,
}
```

脚本会将策略组测速间隔至少收敛到 900 秒，并使用 HTTPS 测速地址。代理提供者自身的订阅刷新配置不会被改写。

## 3. 分流开关

在 `ruleOptions` 中关闭不需要的服务或地区规则：

```javascript
const ruleOptions = {
    apple: true,
    microsoft: true,
    openai: true,
    youtube: true,
    games: true,
    ads: true,
    netflix: false,
    telegram: false,
}
```

关闭地区规则后，对应策略组和规则也不会生成。

## 4. 地区节点分组

`regionOptions.regions` 使用节点名称正则识别地区：

```javascript
const regionOptions = {
    excludeHighPercentage: true,
    autoDetect: true,
    regions: [
        { name: 'HK香港', regex: /港|香港|hk|HK/i, ratioLimit: 5 },
    ],
}
```

- `excludeHighPercentage`：排除名称中倍率超过限制的节点；
- `autoDetect`：自动识别未被显式地区规则匹配的节点；
- `ratioLimit`：该地区允许的倍率上限。

## 5. 自定义分流规则

规则集中在 `defaultCustomRules`。支持：

- `domainSuffix`：域名后缀；
- `domainKeyword`：域名关键词；
- `domain`：精确域名；
- `processName`：进程名；
- `ipCidr`：IP/CIDR；
- `ruleSets`：规则集名称。

### 强制代理

```javascript
forceProxy: {
    target: '默认节点',
    domainSuffix: ['example.com'],
    domainKeyword: ['keyword'],
    domain: ['exact.example.com'],
    processName: ['App.exe'],
    ipCidr: ['1.2.3.0/24'],
    ruleSets: [],
}
```

### 直连

```javascript
direct: {
    target: 'DIRECT',
    domainSuffix: ['example.com'],
    domainKeyword: ['keyword'],
    domain: ['exact.example.com'],
    processName: ['App.exe'],
    ipCidr: ['100.64.0.0/10'],
    ruleSets: ['lipiston'],
}
```

当前内置的 Minecraft 规则集为 `lipiston`，文件是 [`ruleset/lipiston.yaml`](../ruleset/lipiston.yaml)。它按域名匹配，不使用固定端口。

## 6. 运行时安全配置

脚本会自动处理：

- `fake-ip` DNS；
- TUN 和 DNS 劫持；
- 保守嗅探；
- 弱节点过滤；
- 健康检查收口；
- 长连接保活和 fake-ip 映射保存。

安全过滤会移除：

- `skip-cert-verify: true` 节点；
- 弱 Shadowsocks cipher 节点；
- 没有 TLS/Reality 的 VMess/VLESS 节点。

## 7. 本地服务暴露

脚本不会强制覆盖本地服务暴露设置。如果不需要局域网设备访问本机代理，建议在核心配置中手动设置：

```yaml
allow-lan: false
bind-address: 127.0.0.1
```

## 8. DNS 与嗅探

DNS、TUN 和嗅探由 `global_script.js` 统一生成。请关闭 Mihomo Party 的 DNS/嗅探接管，详细配置见 [DNS、TUN 与嗅探](dns-and-sniffer.md)。

## 9. 故障排查

- 脚本不生效：确认 `enable` 为 `true`，并且输入配置中存在代理或代理提供者。
- 地区分组异常：检查节点名称、地区正则和 `autoDetect`。
- 内核提示 `country code hk not found in geoip.dat`：改用完整版 `geoip.dat`。
- DNS 或游戏连接异常：确认 TUN 已启用，关闭客户端 DNS/嗅探接管，并重启 Mihomo 清理旧 fake-ip 映射。
- Minecraft 规则未命中：确认连接使用的是列表中的域名，而不是未收录的 IP 地址。
