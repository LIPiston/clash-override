# DNS 与嗅探设置

> 本文件记录 Mihomo Party 客户端当前的 DNS 与嗅探（sniffer）配置。
> 来源：Mihomo Party 核心配置文件（Windows 默认 `%APPDATA%\mihomo-party\mihomo.yaml`）。
>
> `global_script.js` 已**不再覆盖** DNS 与嗅探，直接使用客户端里的这些设置。
> 若要修改，请在客户端（Mihomo Party → DNS / 嗅探）里改，改完会写入 `mihomo.yaml`。

## 客户端开关

`config.yaml` 中有两个总控开关，控制 DNS / 嗅探是否由客户端接管：

| 开关 | 当前值 | 含义 |
|------|--------|------|
| `controlDns` | `true` | 由客户端管理 DNS（页面里的 DNS 卡片可编辑） |
| `controlSniff` | `true` | 由客户端管理嗅探（页面里的嗅探卡片可编辑） |

---

## DNS

`mihomo.yaml` 中的 `dns:` 段，完整内容如下：

```yaml
dns:
  enable: true
  ipv6: false                          # 关闭 AAAA 查询，减少 IPv6 侧信道
  enhanced-mode: fake-ip               # fake-ip 模式
  fake-ip-range: 198.18.0.1/16
  fake-ip-filter-mode: blacklist       # 下列 fake-ip-filter 为「不返回 fake-ip」的黑名单
  fake-ip-filter:
    - +.lan
    - +.local
    - localhost
    - time.*.com
    - ntp.*.com
    - +.market.xiaomi.com
    - localhost.ptlogin2.qq.com
    - +.qq.com
    - +.tencent.com
    - +.gtimg.com
    - +.gtimg.cn
    - +.qpic.cn
    - +.myqcloud.com
    - +.idqqimg.com
    - +.qlogo.cn
    - +.msftconnecttest.com
    - +.msftncsi.com
    - +.xboxlive.com
  use-hosts: true
  use-system-hosts: true
  respect-rules: true
  default-nameserver:                  # 解析 DoH 域名本身用的纯 IP DNS
    - 223.5.5.5
    - 223.6.6.6
    - 119.29.29.29
  nameserver:                          # 国内默认 DNS
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
  proxy-server-nameserver:             # 解析代理服务器域名用的 DNS
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
  direct-nameserver:                   # 直连域名解析用的 DNS
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
  fallback:                            # 国外 DNS，配合 fallback-filter 兜底
    - https://cloudflare-dns.com/dns-query
    - https://dns.google/dns-query
  fallback-filter:                     # 判断「国内/国外」的分流规则
    geoip: true
    geoip-code: CN
    ipcidr:
      - 240.0.0.0/4
      - 0.0.0.0/32
    domain:                            # 命中这些域名时强制走 fallback（国外）
      - +.google.com
      - +.facebook.com
      - +.youtube.com
      - +.github.com
      - +.githubusercontent.com
      - +.twitter.com
      - +.x.com
      - +.telegram.org
      - +.openai.com
      - +.chatgpt.com
      - +.anthropic.com
  prefer-h3: false
```

### DNS 说明

- **国内解析**走阿里 DoH（`dns.alidns.com`）+ 腾讯 DoH（`doh.pub`），全加密、抗劫持。
- **国外解析**走 Cloudflare + Google 的 DoH，仅在 `fallback-filter` 判定为国外域名时使用。
- **`default-nameserver`** 用三个国内纯 IP 递归 DNS，专门用来解析上面那些 DoH 域名自己的 IP（DoH 需要一个明文 IP 做 bootstrap）。
- **`fake-ip-filter-mode: blacklist`**：只有列表里的域名返回真实 IP，其余一律返回 fake-ip；黑名单已把局域网、NTP 校时、QQ/腾讯系、微软连通性检测（`msftconnecttest.com` / `msftncsi.com`）等需要真实 IP 的场景放行。
- 没看到 `nameserver-policy` 段：客户端界面里 `useNameserverPolicy: false`、`nameserverPolicy: {}`，即当前**未启用**按 geosite 分流的 nameserver-policy，统一靠 `fallback-filter` 的 geoip 判定来分国内外。

---

## 嗅探（Sniffer）

`mihomo.yaml` 中的 `sniffer:` 段，完整内容如下：

```yaml
sniffer:
  enable: true
  parse-pure-ip: true
  force-dns-mapping: true
  override-destination: false          # 只识别域名、不改目的地址（保守）
  sniff:
    HTTP:
      ports:
        - 80
      override-destination: false      # HTTP 不强制覆盖目标
    TLS:
      ports:
        - 443
    QUIC:
      ports:
        - 443
  skip-domain:                         # 这些域名跳过嗅探
    - +.push.apple.com
    - +.apple.com
    - +.icloud.com
    - +.mzstatic.com
    - +.msftconnecttest.com
    - +.msftncsi.com
    - +.xboxlive.com
    - +.lan
    - +.local
    - localhost
  skip-dst-address:                    # 这些目标地址跳过嗅探
    - 10.0.0.0/8
    - 100.64.0.0/10                    # Tailscale 网段
    - 172.16.0.0/12
    - 192.168.0.0/16
    - 224.0.0.0/4
    - 240.0.0.0/4
    - fd00::/8
    - fe80::/10
  force-domain:                        # 这些域名强制嗅探
    - +.google.com
    - +.googleapis.com
    - +.gstatic.com
    - +.youtube.com
    - +.googlevideo.com
    - +.github.com
    - +.githubusercontent.com
    - +.telegram.org
    - +.openai.com
    - +.chatgpt.com
    - +.anthropic.com
  skip-src-address:
    - 127.0.0.0/8
    - ::1/128
```

### 嗅探说明

- **保守基线**：`override-destination: false` 表示嗅探只用来恢复域名信息（供日志/规则用），不强行改写连接目的地，避免某些应用出诡异问题。
- **HTTP 单独关掉了 override**：`sniff.HTTP.override-destination: false`，TLS / QUIC 才默认嗅探。
- **`skip-domain` 放行苹果推送 / 微软连通性检测 / 局域网**，这些域名被嗅探反而会出问题。
- **`skip-dst-address` 把私网、组播、Tailscale（`100.64.0.0/10`）、IPv6 链路本地全部跳过**，避免内网流量被嗅探。
- **`force-domain` 强制对 Google / GitHub / OpenAI 等域名嗅探**，保证这些站点即使目标写成 IP 也能正确映射回域名规则。

---

## 注意

- 以上是从当前 `mihomo.yaml` 读到的实际运行值；若你在客户端里改了 DNS / 嗅探，以客户端为准，本文件可同步更新。
- 脚本侧（`global_script.js`）不含任何 DNS / 嗅探逻辑，二者互不冲突。
