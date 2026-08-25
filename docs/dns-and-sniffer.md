# DNS、TUN 与嗅探

当前 DNS、TUN 和嗅探由 `global_script.js` 统一生成。为了避免 Mihomo Party 的界面配置覆盖脚本配置，建议关闭客户端接管：

```yaml
controlDns: false
controlSniff: false
```

## DNS 配置

脚本生成的 DNS 核心配置如下：

```yaml
dns:
  enable: true
  ipv6: false
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  fake-ip-filter-mode: blacklist
  use-hosts: true
  use-system-hosts: true
  respect-rules: true
  prefer-h3: false
  default-nameserver:
    - 223.5.5.5
    - 223.6.6.6
    - 119.29.29.29
  nameserver:
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
  direct-nameserver:
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
  proxy-server-nameserver:
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
  fallback:
    - https://cloudflare-dns.com/dns-query
    - https://dns.google/dns-query
```

### 设计取舍

- `fake-ip` 适合 TUN，便于应用流量命中域名规则；
- `ipv6: false` 优先稳定性，并减少 IPv6 侧信道；
- `respect-rules: true` 让 DNS 解析路径遵守分流规则；
- 国内 DoH 用于默认、直连和代理节点域名解析；
- Cloudflare/Google 作为国外解析 fallback；
- `default-nameserver` 只用于启动和解析 DoH 服务域名，不是普通业务 DNS；
- `nameserver-policy` 会将广告域名返回 `rcode://success`，国内/私有域名使用国内 DoH，国外域名使用国外 DoH。

fake-ip 黑名单包含局域网、localhost、NTP、QQ/腾讯、微软连通性检测和 Xbox 等常见兼容项。遇到特定应用异常时，再将该域名加入黑名单，不建议一开始把整个 fake-ip 改成 `redir-host`。

## TUN 配置

脚本生成：

```yaml
tun:
  enable: true
  stack: system
  auto-route: true
  auto-redirect: false
  auto-detect-interface: true
  dns-hijack:
    - any:53
  mtu: 1492
  strict-route: false
```

脚本排除局域网、Tailscale、IPv6 私有网段和链路本地地址，避免内网流量被错误代理。

## 嗅探配置

嗅探用于恢复域名信息，但不强制修改连接目标：

```yaml
sniffer:
  enable: true
  parse-pure-ip: true
  force-dns-mapping: true
  override-destination: false
  sniff:
    HTTP:
      ports: [80]
      override-destination: false
    TLS:
      ports: [443]
    QUIC:
      ports: [443]
```

这种保守模式对 Minecraft、WebSocket、长连接和非标准应用更稳。脚本会跳过局域网、localhost、苹果推送、微软连通性检测和 Xbox 等域名，并跳过私有地址、Tailscale 地址和链路本地地址。

## 稳定性设置

脚本还会：

- 将策略组测速地址统一为 `https://www.gstatic.com/generate_204`；
- 将策略组测速间隔限制为至少 900 秒；
- 启用延迟测速懒加载；
- 设置 TCP 保活空闲和间隔为 30 秒；
- 保存已选策略组和 fake-ip 映射。

这些设置旨在减少频繁测速、降低空闲长连接被清理的概率，并避免重启后 fake-ip 映射频繁变化。

## 本地服务安全

DNS/TUN 脚本不负责决定代理端口是否对局域网开放。如果只在本机使用 Mihomo，建议手动设置：

```yaml
allow-lan: false
bind-address: 127.0.0.1
```

## 修改原则

1. 优先修改 `global_script.js`，不要在客户端 UI 和脚本中重复维护同一项配置。
2. 修改 DNS 后重启 Mihomo，避免旧 fake-ip 映射影响测试。
3. 如果只有单个应用异常，先为该应用补充 fake-ip 黑名单或嗅探跳过项，不要关闭整个 TUN/fake-ip。
4. Minecraft 服务器直连使用域名规则集，不通过固定端口判断。
