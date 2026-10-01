# clash-override

个人使用的 Clash Verge Rev / Mihomo Party 全局扩展脚本，以及把这份脚本转成 OpenClash 旁路由覆写模块的转换器。

`global_script.js` 是**唯一事实来源**：桌面端直接用它，旁路由模块由它生成，两边永远同源。生成物不要手改 —— 改了脚本就重跑转换器。

脚本接管以下配置：

- 代理节点过滤、地区分组和自动测速；
- 常用服务、地区和游戏分流，广告交给 AWAvenue-Ads-Rule；
- 自定义域名、关键词、进程和规则集分流；
- DNS（全 DoH 上游）、fake-ip、TUN 和保守嗅探；
- 健康检查、长连接和 fake-ip 映射保存。

> 本项目是个人定制配置，不保证适用于所有网络环境。修改后请先确认生成的配置可以正常启动。

## 仓库结构

| 路径 | 说明 |
| --- | --- |
| `global_script.js` | 桌面端全局扩展脚本，也是旁路由模块的源脚本 |
| `openclash/convert-global-script.js` | 转换器：在 `vm` 沙箱里真正执行源脚本，读回它生成的整份配置，再翻译成 OpenClash 覆写模块 |
| `openclash/lipiston-side-router` | 生成物：**纯 v4** 模块，路由器上默认用这条 |
| `openclash/lipiston-side-router-v4v6` | 生成物：**v4+v6** 模块，两条只差 IPv6 开关 |
| `openclash/lipiston-side-router.sha256` | 源脚本与两条生成物的校验和 |
| `openclash/test_converter.js` | 转换器回归测试 |
| `test_select_group_auto_options.js` | 桌面脚本回归测试：选择组里的自动测速选项不能被排除 |
| `ruleset/lipiston.yaml` | 个人直连规则集（Minecraft / UU 远程），模块把它注册成本地 rule-provider |
| `docs/` | 配置说明与 DNS/TUN/嗅探说明 |

旁路由那条线的细节（安装、与桌面端的差异、geodata 空间占用）都在 [openclash/README.md](openclash/README.md)。

## 快速使用（桌面端）

直接脚本地址：

```text
https://raw.githubusercontent.com/LIPiston/clash-override/main/global_script.js
```

### Clash Verge Rev

1. 打开 **设置 → 配置 → 全局扩展脚本**。
2. 导入上面的脚本地址，或粘贴 `global_script.js` 内容。
3. 保存并重新载入配置。

### Mihomo Party

1. 打开 **覆写 → 脚本覆写**。
2. 导入脚本地址，或粘贴 `global_script.js` 内容。
3. 确认脚本总开关为 `true`。
4. 关闭客户端对 DNS 和嗅探的接管，让脚本成为唯一配置来源。
5. 保存并应用配置。

## 使用前设置

### 关闭客户端 DNS / 嗅探接管

如果客户端提供以下开关，建议关闭：

```yaml
controlDns: false
controlSniff: false
```

否则 Mihomo Party 的界面配置可能覆盖脚本生成的 DNS 或嗅探配置。脚本生成的 DNS 上游全部为 DoH 且使用 IP 直连形式，客户端接管会破坏这一点。具体说明见 [DNS、TUN 与嗅探](docs/dns-and-sniffer.md)。

### geodata

脚本自己就把 geodata 配好了，桌面端不需要手动下载：

```yaml
geodata-mode: true
geodata-loader: memconservative   # 小内存环境用；旁路由模块保持不变
geo-auto-update: true
geo-update-interval: 24
geox-url:                         # MetaCubeX meta-rules-dat latest
  geoip:   .../geoip.dat
  geosite: .../geosite.dat
  mmdb:    .../country-lite.mmdb
  asn:     .../GeoLite2-ASN.mmdb
```

脚本用到地区和地理规则，必须是**完整版** `geoip.dat` / `geosite.dat`，不要用精简版 `geoip-lite.dat`。如果你的客户端不支持上面的键、需要手动放置，推荐地址：

```text
https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat
https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat
```

如果日志出现以下错误，通常是 geoip 文件不完整：

```text
country code hk not found in geoip.dat
```

旁路由是另一套策略：模块把 `geodata-mode` 固定为 `false`（读 0.2 M 的 `Country.mmdb` 而不是 16.5 M 的 `GeoIP.dat`），并在模块 `[General]` 里钉住哪几份库需要下载，详见 [openclash/README.md](openclash/README.md#旁路由的-geodata-占用)。

## OpenClash 旁路由模块

同一条源脚本，转成 OpenClash 的覆写模块（整棵策略组树替换掉订阅自带的：主选择器接管 `节点选择` 这个名字，模块的规则前置，OpenClash 自己的兜底 `MATCH` 因此落回模块的树）：

```bash
node openclash/convert-global-script.js          # 同时生成纯 v4 与 v4+v6 两条
```

- 按需收窄地区组：`--regions=HK,JP,SG,US,TW,KR`（订阅里没有节点的地区会解析成空组，mihomo 会拒绝启动）。
- 连规则一起接管（放弃订阅自带规则与 OpenClash 的规则注入）：`--replace-rules`。
- 完整参数表、生成物结构、与桌面端的逐条差异、路由器上的安装步骤：见 [openclash/README.md](openclash/README.md)。

## 改完之后

```bash
node test_select_group_auto_options.js        # 桌面脚本回归
node openclash/test_converter.js              # 转换器回归（结构、引用、环路、geodata 开关）
node openclash/convert-global-script.js       # 重新生成两条模块
sha256sum openclash/lipiston-side-router openclash/lipiston-side-router-v4v6
# 用上面的结果更新 openclash/lipiston-side-router.sha256
```

改完 `global_script.js` 别忘了重跑转换器：生成物是产物，不是手写文件。推送到路由器后需要**重启** OpenClash 才会重新执行覆写模块（仅 `reload` 不会）。

## 内置 Minecraft / UU 远程 / 运动世界校园直连

`ruleset/lipiston.yaml` 用于游戏与校园 App 相关域名直连，当前包含：

- `tecostudio`、`vitasub` 关键词；
- `mc.windmilltown.net`、`lvss.xyz`；
- `149.104.21.239/32`；
- UU 远程 / GameViewer 相关的网易域名（`nrd.nie.163.com`、`webapp.163.com`、`gdl.netease.com`、`fp.ps.netease.com`）；
- 运动世界校园 / [NekoSportsWorldTool](https://github.com/YanamiNeko/NekoSportsWorldTool) 的域名（`iydsj.com`，覆盖 `run.gxapp.iydsj.com`、`discovery.gxapp.iydsj.com`）与登录用极验域名（`geetest.com`）。

规则按域名/关键词匹配，不依赖服务器端口，也不会把整个 Java/Minecraft 进程设为直连。桌面端通过 `direct.ruleSets = ['lipiston']` 挂上这份规则集；模块则把它注册为本地 `rule-provider`（`type: file` + `./rule_provider/lipiston.yaml`）。另外 `direct` 规则的关键词表里有 `lipiston`，所以所有匹配 `lipiston` 的域名（含 `mix.lipiston.top`）统一走直连。

## 文档

- [配置说明](docs/configuration.md)：总开关、自动测速、地区分组和自定义分流规则。
- [DNS、TUN 与嗅探](docs/dns-and-sniffer.md)：脚本生成的运行配置、客户端开关和稳定性说明。
- [OpenClash 适配](openclash/README.md)：转换器用法、生成物结构、与桌面端的差异、旁路由安装与 geodata 占用。

## 本地服务暴露建议

如果不需要让局域网设备使用本机代理，建议在 Mihomo 核心配置中手动设置：

```yaml
allow-lan: false
bind-address: 127.0.0.1
```

这两项没有写入脚本，避免覆盖客户端对本地服务暴露的管理选择。

## 项目来源

本仓库基于以下项目二次开发：

| 项目 | 仓库 | 用途 |
|------|------|------|
| YaNet | https://github.com/dahaha-365/YaNet | 核心脚本来源 |
| clash-override | https://github.com/Adsryen/clash-override | 覆写结构参考 |
| ACL4SSR | https://github.com/ACL4SSR/ACL4SSR | 自动测速策略组参考 |
| Surfing | https://github.com/GitMetaio/Surfing | 分流规则结构参考 |
| MetaCubeX | https://github.com/MetaCubeX/meta-rules-dat | 规则集与 geodata |
| AWAvenue-Ads-Rule | https://github.com/TG-Twilight/AWAvenue-Ads-Rule | 广告规则集 |

## 许可证

本项目整体按 GNU GPL v3.0 分发。各上游项目的原始许可证和版权声明保留在 [LICENSE](LICENSE) 中。

仅供学习交流使用，请遵守当地法律法规。
