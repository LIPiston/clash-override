# clash-override

个人使用的 Clash Verge Rev / Mihomo Party 全局扩展脚本。

脚本接管以下配置：

- 代理节点过滤、地区分组和自动测速；
- 常用服务、地区和游戏分流；
- 自定义域名、关键词、进程和规则集分流；
- DNS、fake-ip、TUN 和保守嗅探；
- 健康检查、长连接和 fake-ip 映射保存。

> 本项目是个人定制配置，不保证适用于所有网络环境。修改后请先确认生成的配置可以正常启动。

## 快速使用

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

否则 Mihomo Party 的界面配置可能覆盖脚本生成的 DNS 或嗅探配置。具体说明见 [DNS、TUN 与嗅探](docs/dns-and-sniffer.md)。

### 使用完整版 geodata

脚本使用地区和地理规则，建议使用完整版 `geoip.dat` 和 `geosite.dat`，不要使用精简版 `geoip-lite.dat`。

推荐地址：

```text
https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat
https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat
```

如果日志出现以下错误，通常是 geoip 文件不完整：

```text
country code hk not found in geoip.dat
```

## 内置 Minecraft 直连

`ruleset/lipiston.yaml` 用于游戏相关 Minecraft 域名直连，当前包含：

- `tecostudio` 关键词；
- `vitasub` 关键词；
- `mc.windmilltown.net`；
- `lvss.xyz`。

规则按域名匹配，不依赖服务器端口，也不会把整个 Java/Minecraft 进程设为直连。

## 文档

- [配置说明](docs/configuration.md)：总开关、自动测速、地区分组和自定义分流规则。
- [DNS、TUN 与嗅探](docs/dns-and-sniffer.md)：脚本生成的运行配置、客户端开关和稳定性说明。

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

## 许可证

本项目整体按 GNU GPL v3.0 分发。各上游项目的原始许可证和版权声明保留在 [LICENSE](LICENSE) 中。

仅供学习交流使用，请遵守当地法律法规。
