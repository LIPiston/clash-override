# clash-override

个人自用的 Clash Verge Rev 全局扩展脚本 / Mihomo Party 覆写脚本。

自动完成代理节点地区分组、智能分流、DNS 优化等配置，让机场订阅「即插即用」。

## 项目来源

本仓库基于以下项目二次开发，仅做个人定制，非通用发布：

| 项目 | 仓库 | 说明 |
|------|------|------|
| **YaNet** | https://github.com/dahaha-365/YaNet | 核心脚本来源（BSD 3-Clause） |
| **clash-override** | https://github.com/Adsryen/clash-override | 核心脚本来源（MIT） |
| **ACL4SSR** | https://github.com/ACL4SSR/ACL4SSR | 自动测速策略组参考 |
| **Surfing** | https://github.com/GitMetaio/Surfing | 分流规则 / 策略组结构参考 |

> 上游 [clash-override](https://github.com/Adsryen/clash-override) 本身也是基于 [YaNet](https://github.com/dahaha-365/YaNet) 二次开发而来。规则集来自 [MetaCubeX](https://github.com/MetaCubeX/meta-rules-dat)，图标来自 [Qure](https://github.com/Koolson/Qure)。

## 直接下载

- GitHub 仓库：https://github.com/LIPiston/clash-override
- 直接下载：https://raw.githubusercontent.com/LIPiston/clash-override/main/global_script.js
- GitHub 网页版：https://github.com/LIPiston/clash-override/raw/refs/heads/main/global_script.js

## 快速开始

### Clash Verge Rev

1. 打开 Clash Verge Rev → **设置** → **配置** → **全局扩展脚本**
2. 点击 **导入**，粘贴上面的 `global_script.js` 在线地址，或选择下载好的文件
3. 保存并重启
4. ⚠️ 配置 geodata 地址为完整版（见下方「必须配置：geodata 地址」）

### Mihomo Party

1. 打开 Mihomo Party → **覆写** → **脚本覆写**
2. 粘贴 `global_script.js` 内容（或导入在线地址）
3. 确认脚本开头 `enable` 为 `true`，保存并应用
4. ⚠️ 配置 geodata 地址为完整版（见下方「必须配置：geodata 地址」）

## 必须配置：geodata 地址

脚本开启 `geodata-mode`，且分流规则里包含 `GEOIP,HK/US/JP/RU` 等地区规则，因此**必须使用完整版 `geoip.dat`**。

如果客户端里的 geodata 地址还是精简版 `geoip-lite.dat`，会因缺少国家代码（如 `hk`）导致内核启动失败：

```
country code hk not found in geoip.dat
```

导入脚本后，请把客户端的 geoip 地址改成完整版：

```
https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat
```

- **Mihomo Party**：核心设置里把 `geoip` 地址从 `geoip-lite.dat` 改为 `geoip.dat`（若 UI 找不到，直接编辑核心配置文件，Windows 默认路径 `%APPDATA%\mihomo-party\mihomo.yaml` 中的 `geox-url.geoip`）
- **Clash Verge Rev**：核心配置里同样把 `geox-url` 的 `geoip` 换成完整版地址

## 文档

- [自定义你自己的规则 / 配置说明](docs/configuration.md) — 总开关、自动测速、分流规则、地区分组、强制代理 / 直连规则、Strict Mode、故障排查
- [DNS 与嗅探设置](docs/dns-and-sniffer.md) — 客户端当前 DNS / 嗅探配置记录

## 许可证

本项目整体按 **GNU GPL v3.0** 分发（因整合了 GPL-3.0 的 [Surfing](https://github.com/GitMetaio/Surfing) 规则与结构），各上游部分的原始许可与版权声明保留在 [LICENSE](LICENSE) 中：

- [YaNet](https://github.com/dahaha-365/YaNet)：BSD 3-Clause
- [clash-override](https://github.com/Adsryen/clash-override)：MIT
- [ACL4SSR](https://github.com/ACL4SSR/ACL4SSR)：CC BY-SA 4.0（自动测速策略组参考）
- [Surfing](https://github.com/GitMetaio/Surfing)：GPL-3.0（分流规则 / 策略组结构参考）

仅供学习交流使用，请遵守当地法律法规。
