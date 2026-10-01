# OpenClash 适配

这里存放从 `global_script.js` 转换出的 OpenClash 覆写模块，以及转换工具。

## 文件

- `convert-global-script-bash.sh`：脚本 A（Bash），把 Clash Verge Rev / Mihomo Party 的 `global_script.js` 转成 OpenClash 覆写脚本 B。
- `lipiston-side-router`：脚本 B，转换生成的旁路由覆写模块，当前启用 IPv6。
- `test_convert_global_script_bash.sh`：Bash 转换器回归测试。
- `convert-global-script.js`、`test_convert_global_script.js`：旧版 Node.js 转换器文件，暂保留，未作为使用入口。
- `../ruleset/lipiston.yaml`：个人直连规则集，供模块注册为本地 `rule-provider`。

## 与 JavaScript 版本的差异

OpenClash 不执行 Clash Verge Rev / Mihomo Party 的 JavaScript 全局脚本，因此转换为：

- `[General]`：写入 OpenClash UCI 覆写选项；
- `[YAML]`：合并 DNS、Fake-IP、运行参数、策略组和规则；
- 规则使用 OpenClash 支持的本地 `rule-provider` 和数组前置追加操作符 `+rules`。

旁路由版本不启用 TUN，避免与上游主路由的网关转发重复接管；保留 Fake-IP + Rule，并启用旁路网关兼容、代理服务器地址绕过和 IPv6。脚本 A 默认启用 IPv6，也可用 `--no-ipv6` 关闭。IPv6 使用 `IPV6_MODE = 0`（TProxy），并设置 `FAKEIP_RANGE6 = fdfe:dcba:9876::1/64`。

根据 OpenClash 指南，旁路由 IPv6 还需要：客户端默认 IPv6 网关指向旁路由；旁路由不要同时向 LAN 发送另一套 RA/DHCPv6；如果上游不能回程客户端地址，再单独评估 NAT66。仅写入覆写模块不会改变这些网络前提。

## Bash 转换

```bash
bash openclash/convert-global-script-bash.sh global_script.js openclash/lipiston-side-router --ipv6
bash openclash/test_convert_global_script_bash.sh
```

转换器只读取 JS 中的字面量 `ruleOptions` 开关和自定义规则，不执行输入脚本；不会转换 `PROCESS-NAME`，也不会把桌面端的 `MATCH` 放到前面截断 OpenClash 原有规则。

## 安装方式

在路由器上：

1. 将 `lipiston-side-router` 放到 `/etc/openclash/overwrite/`；
2. 将 `ruleset/lipiston.yaml` 放到 `/etc/openclash/rule_provider/lipiston.yaml`；
3. 创建 `config_overwrite` 条目，设置：
   - `name=lipiston-side-router`
   - `type=file`
   - `config=all`
   - `enable=1`
4. 修改后重启 OpenClash 才会生成运行配置；仅 `reload` 不会重新执行覆写模块。

模块不会覆盖 Kitty 原有 DNS 上游、策略组和远程 rule-providers，只追加兼容组与个人规则。
