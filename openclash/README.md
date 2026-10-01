# OpenClash 适配

把桌面端（Clash Verge Rev / Mihomo Party）的 `global_script.js` 全局覆写脚本转成 OpenClash 旁路由覆写模块。

## 文件

- `convert-global-script.js`：转换器。在 `vm` 沙箱里**真正执行** `global_script.js`，读回它生成的整份配置，再翻译成 OpenClash 覆写模块。一次运行出两条（纯 v4 / v4+v6）。
- `lipiston-side-router`：**纯 v4** 产物，路由器上默认用这个。
- `lipiston-side-router-v4v6`：**v4+v6** 产物，两条只差 IPv6 开关。
- `lipiston-side-router.sha256`：源脚本与两条产物的校验和，改完记得同步。
- `test_converter.js`：转换器回归测试。
- `../ruleset/lipiston.yaml`：个人直连规则集，模块把它注册为本地 `rule-provider`。

## 用法

```bash
# 默认：一次生成两条 —— openclash/lipiston-side-router（纯 v4）
# 与 openclash/lipiston-side-router-v4v6（v4+v6）
node openclash/convert-global-script.js

# 只要其中一条
node openclash/convert-global-script.js --no-ipv6   # 只出纯 v4
node openclash/convert-global-script.js --ipv6      # 只出 v4+v6

node openclash/test_converter.js
```

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--ipv6` / `--no-ipv6` | 两条都出 | 只出 `-v4v6`（v4+v6）或只出纯 v4。切换的是 `[General]` 的 `IPV6_ENABLE`/`IPV6_DNS`/`ENABLE_V6_UDP_PROXY`/`FAKEIP_RANGE6` 与 `[YAML]` 里的 `dns.ipv6`、`dns.fake-ip-range6`，其余内容两条完全一致 |
| `--regions=HK,JP,SG,US` | 全部 20 个地区 | 生成哪些地区组，可写地区码或全名，`ALL` 表示源脚本里的全部 20 个 |
| `--replace-rules` / `--no-replace-rules` | `--no-replace-rules` | 把整份规则表也换成源脚本自己的（`rules!`，含它自己的 `MATCH,其他外网`）。代价：订阅自带规则、OpenClash 的自定义规则/路由自身规则注入全部失效 |
| `--tun` / `--no-tun` | `--no-tun` | 是否输出源脚本的 `tun` 块 |
| `--sniffer` / `--no-sniffer` | `--sniffer` | 是否输出源脚本的 `sniffer` 块 |
| `--geo-update` / `--no-geo-update` | `--no-geo-update` | 是否输出 `geo-auto-update` + `geo-update-interval` + `geox-url`（默认不发，见下文） |
| `--tail-rules` / `--no-tail-rules` | `--tail-rules` | 是否保留源脚本末尾的 `GEOSITE/GEOIP private` 与 `cn` 四条规则 |

## 产出结构

- `[General]`：OpenClash 的 UCI 覆写选项，`KEY = value` 形式（注意不是 YAML 的 `key: value`）。
- `[YAML]`：`dns`、运行参数（`mode` / `profile` / `tcp-concurrent` / `unified-delay` / `keep-alive-*` / `find-process-mode` / `geodata-*` / `ntp` / 可选 `tun` / 可选 `sniffer`）、`proxies+`、`proxy-groups!`、`rule-providers`、`+rules`（`--replace-rules` 时是 `rules!`）。

**策略组整棵替换，规则是前置追加。** `proxy-groups!` 是 YAML.rb 的强覆写操作符，合并时整份 `proxy-groups` 都被模块的树取代 —— 订阅自带的 `节点选择` / `自动选择` 不会作为第二棵树留下来，也就不可能撞名。`proxies+` 追加节点、`+rules` 把自己的规则前置、`rule-providers` 按键深合并，所以 OpenClash 原有的 DNS 上游、远程 rule-providers 以及末尾的 `MATCH` 都还在；那个 `MATCH` 指向 `节点选择`，正是模块接管过去的组名，兜底流量因此也走模块自己的选择器。要连规则一起接管就用 `--replace-rules`。

## 与桌面脚本的差异

差异都是有意的，不是漏转：

- **不启用 TUN**（`--no-tun`）：旁路由已经在主路由后面，再开 TUN 会和主路由的网关转发重复接管。
- **丢弃 `PROCESS-NAME` 规则**：路由器上 mihomo 看不到客户端进程名，留着只会误判。
- **默认丢弃桌面端的 `MATCH`，把兜底留给 OpenClash**：兜底规则放到前面会截断 OpenClash 自己的规则。模块把主选择器发布成 `节点选择` 之后，OpenClash 配置末尾原有的 `MATCH,节点选择` 恰好落回模块的树，所以既不用改规则、也没丢 OpenClash 的规则注入；要让源脚本自己的 `MATCH,其他外网` 生效就用 `--replace-rules`（整份规则表一起替换）。
- **地区组改成动态**：桌面端是靠 JS 正则去匹配节点名、把成员写死；模块改用 `include-all: true` + `filter`（源脚本的地区正则）+ `exclude-type`（排除策略组，避免自环）。订阅换节点名也不用重新生成模块。
- **地区组不看倍率**：桌面端静态轮里 `ratioLimit`（默认 5）确实会挡掉高倍率节点，但它后面的 `autoDetect` 完全不看倍率、按国家码把那些节点又塞回地区组（`existingGroup.proxies.push(n)`），净效果是倍率对地区组不起作用。所以模块的地区组**不带**倍率 `exclude-filter` —— 带上反而更不准：那些节点会被地区正则挡在 `其他节点` 之外、又进不了地区组，变成哪个组都不在。整份模块现在只剩 `其他节点` 一处 `exclude-filter`（排除全部 20 个地区用的）。
- **地区正则补上 `(?i)`**：源脚本的地区正则是 `/i` 的，转成 Go 正则时必须写成 `(?i)…`，否则 `Hong Kong`、`Japan` 这类大小写混排的节点名匹配不上，会整组漏进 `其他节点`（甚至让某个地区组变空）。
- **默认生成全部 20 个地区组**：与桌面端一致，顺序也照源脚本的地区表。代价是某个地区在订阅里确实没有节点时，该组会解析成空组，mihomo 会以 `proxy group [X] has no proxies` 拒绝启动 —— 用 `--regions=HK,JP,SG,US,TW,KR` 收窄即可。
- **整棵策略组树替换掉订阅自带的**：模块用 `proxy-groups!`（YAML.rb 的强覆写）发布完整一棵树，并把源脚本的主选择器 `默认节点` 改用订阅规则已经在引用的名字 `节点选择` 发布出去 —— 订阅自己的 42 条规则（含末尾 `MATCH,节点选择`）因此继续有效，路由器上只剩一棵选择器树。三条自动测试组直接用源脚本的裸名字 `自动选择` / `故障转移` / `负载均衡`：既然整份 `proxy-groups` 被替换，就不可能再撞名。（早先用的是 `proxy-groups+` 纯追加，OpenClash 的深度合并不按组名去重，撞名时 mihomo 以 `Parse config error: ProxyGroup 自动选择: duplicate group name` 拒绝启动，才需要加 `·模块` 后缀区分。）`默认节点` 这个名字现在不会出现在产物里，回归测试会断言这一点。
- **`其他节点` 只收「匹配不到任何地区」的节点**：它的 `exclude-filter` 用的是源脚本地区表里**全部 20 个地区**的正则并集（同样带 `(?i)`），而不是只排除本次生成的地区。默认 20 个组全生成时它就是纯兜底组；用 `--regions=` 收窄后，未生成地区的节点也不会混进来 —— 它们仍然能从 `节点选择` → `其他节点` 里选到，只是不进任何地区组。顺带修掉了源脚本里主选择器 ↔ `其他节点` 的互相引用：`其他节点` 不再把主选择器列成成员（`global_script.js` 的 `selectableProxyGroupNames.filter((x) => x !== '其他节点' && x !== '默认节点')`），因为主选择器本来就把 `其他节点` 当成员，互指会被 mihomo 判成 `Parse config error: loop is detected in ProxyGroup, please check following ProxyGroups: [默认节点 其他节点]`。主选择器 → `其他节点` 这条单向边保留，所以兜底节点仍然能从主选择器里选到；回归测试现在会对每个生成结果做一遍深度优先环路检测。
- **广告只走 AWAvenue**：模块里删掉了源脚本自带的两层广告拦截 —— 规则层的 `GEOSITE,category-ads-all,广告过滤` 与 DNS 层的 `nameserver-policy: 'geosite:category-ads-all': 'rcode://success'`（广告域名照常解析，不再被 `rcode://success` 短路），只保留 `AWAvenue-Ads-Rule` 这个 `behavior: classical` 的 YAML 规则集 + `广告过滤` 组。桌面端两层都保留。
- **`跟踪分析` 组整个删掉了**：源脚本里的 `GEOSITE,tracker,跟踪分析` 规则和 `跟踪分析` 选择组已从 `global_script.js` 移除 —— AWAvenue-Ads-Rule 本身已经收录跟踪/分析域名（规则层的 `RULE-SET,AWAvenue-Ads-Rule,广告过滤` 会兜住），而且不少路由器自带的 GeoSite.dat 没有 `tracker` 这个分类，留着会让 mihomo 以 `list tracker not found in GeoSite.dat` 直接拒绝启动。桌面端和模块都跟着源脚本一起不再生成，所以这不是「差异」，是两边同时去掉。
- **`lipiston` 改成本地文件**：`type: file` + `path: ./rule_provider/lipiston.yaml`，不从 GitHub 拉自己的规则集。
- **其余 rule-providers 的 `path` 改到 `./rule_provider/`**：那是 OpenClash 的 rule-provider 目录。
- **默认发布纯 v4，同时附一条 v4+v6**：旁路由的 IPv6 需要上游提供 IPv6-PD、默认路由和正确回程，条件不满足就不要开，所以默认装到路由器上的 `lipiston-side-router` 是纯 v4；同一个源脚本开 IPv6 的那条叫 `lipiston-side-router-v4v6`，条件具备时换上去即可（两条只差 IPv6 开关）。按 OpenClash 指南，还需要客户端默认 IPv6 网关指向旁路由、旁路由不要同时向 LAN 发另一套 RA/DHCPv6；上游不能回程客户端地址时再单独评估 NAT66。仅写入覆写模块不会改变这些网络前提。
- **模块固定 mmdb 模式**：桌面脚本在 `global_script.js` 里写 `geodata-mode: true`（它有磁盘），但那样 mihomo 会读 `GeoIP.dat`（约 16.5 M）而不是 `Country.mmdb`（约 200 K）。旁路由的 flash 只有 38.6 M，所以模块固定输出 `geodata-mode: false`：`GEOIP,cn` 照常工作（`Country.mmdb` 就是回国 IP 段），私网地址另有显式 `IP-CIDR` 规则兜住，`GeoIP.dat` 不必存在。同一个策略在 `[General]` 里又钉了一遍（`ENABLE_GEOIP_DAT = 0`，见下面「旁路由的 geodata 占用」）：YAML 只能决定 mihomo 读哪份库，决定不了 OpenClash 自己去下哪几份文件，两件事得分别钉。
- **默认 `--no-geo-update`**：`geo-auto-update` 会让 mihomo 自己拉 geodata，而 OpenClash 的 cron 本来就会拉同一批文件（`openclash_geo.sh`），两边叠起来就是「每天一次 + 每周一次」的重复下载。模块用到一批 GeoSite 分类（`youtube`、`google`、`microsoft`、`category-games` 等），但这批分类由 OpenClash 的 `geosite` cron 维护，所以默认不发 `geo-auto-update` / `geo-update-interval` / `geox-url`；要让 mihomo 自己更新时用 `--geo-update`（它只把 mihomo 的更新器放回来，不会把 `GeoIP.dat` / `ASN.mmdb` 的下载开关打开 —— 那两个开关回答的是「这份库有没有人用」，不是「谁来更新」，见下一节）。

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

改了 `global_script.js` 之后，重跑转换器再重启 OpenClash（别忘了 `sha256sum` 更新 `lipiston-side-router.sha256`）。

## 旁路由的 geodata 占用

OpenClash 在 `/etc/openclash/` 放四份 geodata，配好模块后只有两份是必需的：

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `GeoSite.dat` | 10.4 M | 必需，模块有 16 条 `GEOSITE` 规则 |
| `Country.mmdb` | 0.2 M | 必需，`geodata-mode: false` 时 `GEOIP,cn` 走它 |
| `GeoIP.dat` | 16.5 M | **不需要**，只有 `geodata-mode: true` 才读 |
| `ASN.mmdb` | 12.1 M | **不需要**，模块里没有任何 ASN 规则 |

其中「要不要下这几份库」由模块自己钉，写在 `[General]` 里（转出来的 `lipiston-side-router` 第 19–23 行）：

```
ENABLE_GEOIP_DAT = 0      # 跟 YAML 的 `geodata-mode: false` 是同一件事，只是从 OpenClash 侧再钉一遍
GEOIP_AUTO_UPDATE = 0     # `GeoIP.dat`（16.5 M）mmdb 模式根本不读
GEOASN_AUTO_UPDATE = 0    # `ASN.mmdb`（12.1 M）没有任何规则引用
GEO_AUTO_UPDATE = 1       # `Country.mmdb` 是真在用的那份，必须继续周更
GEOSITE_AUTO_UPDATE = 1   # `GeoSite.dat` 同理
```

机制：`[General]` 的键由 `/etc/init.d/openclash` 写进 `openclash.@overwrite[0].<小写键名>`（那里有一份 101 项的允许表 + 类型校验，这五个都是 `int_bool`，所以只收 `0` / `1`），而所有读取方都走 `/usr/share/openclash/uci.sh` 里的 `uci -q get openclash.@overwrite[0]."$key" || uci -q get openclash.config."$key"` —— **按配置的覆写段优先于 `openclash.config`**，模块每次启动都会盖掉 LuCI 设置页里存的值。所以在 LuCI 里手动打开这几个开关不牢靠（下次启动就被改回去），要改就改模块。

剩下「配置之外」的部分仍然必须手动 —— cron 行、文件搬运、符号链接都没法写进任何配置文件。先备份到 `/tmp/geodata-stash/`，重启验证无误后再当最终结果：

```sh
# 没在用这个模块、或者想让设置立刻生效（不等下次重启）时，才需要手动设这一遍：
uci set openclash.config.enable_geoip_dat='0'
uci set openclash.config.geoip_auto_update='0'
uci set openclash.config.geoasn_auto_update='0'
uci commit openclash
# 下面全是配置之外的东西，用不用模块都得手动：
sed -i '/openclash_geo.sh geoip/d;/openclash_geo.sh geoasn/d' /etc/crontabs/root
/etc/init.d/cron restart
mv /etc/openclash/GeoIP.dat /tmp/geodata-stash/
mv /etc/openclash/ASN.mmdb  /tmp/geodata-stash/
rm -f /etc/openclash/GeoSite.dat
ln -s /rom/etc/openclash/GeoSite.dat /etc/openclash/GeoSite.dat
/etc/init.d/openclash restart
```

需要注意的地方：

- `GeoIP.dat` 删掉就不会再回来（mmdb 模式不读它）。但 **`ASN.mmdb` 删掉后 mihomo 会自己拉回来**：它启动时检查这个文件存不存在，缺了就按 `geox-url.asn` 下载一遍（日志 `Can't find ASN.mmdb, start download`），所以光删文件省不下这 12.1 M。用一份 200 K 的 stub 顶替它：

  ```sh
  cp /etc/openclash/Country.mmdb /etc/openclash/asn-stub.mmdb
  # 把声明的 database_type 从 GeoIP2-Country 改成 GeoLite2-ASN，
  # 否则 mihomo 会一直刷 Unsupported ASN type: GeoIP2-Country
  sed -i 's/NGeoIP2-Country/LGeoLite2-ASN/' /etc/openclash/asn-stub.mmdb
  rm -f /etc/openclash/ASN.mmdb
  ln -s /etc/openclash/asn-stub.mmdb /etc/openclash/ASN.mmdb
  ```

  stub 是合法 mmdb（内容是国家库），文件存在所以 mihomo 不下载，声明成 `GeoLite2-ASN` 所以不再告警；模块没有 ASN 规则，查询结果不会被用到。`sed` 只改 metadata 里那一处声明，205449 → 205447 字节，不影响读取。备份别放进 `/tmp/etc/openclash/` —— OpenClash 启动时会把这个目录里的 geodata **搬回** `/etc/openclash/`（`do_run_file()` 里的 `mv "/tmp/etc/openclash/ASN.mmdb" "$asn_path"` 等），文件会原地复活。

- 不能靠「删掉上层文件、吃固件里那份」省 `GeoSite.dat`：`/rom` 是只读 squashfs（`/dev/root on /rom type squashfs (ro)`），里面确实有 10.4 M 的 `GeoSite.dat`，但 overlay 是 `lowerdir=/,upperdir=/overlay/upper`，而 `/etc/openclash` 在 upper 层里是**完整物化**的（拿两边的目录名做差集，下层独有项是 0 个），同名下层文件被整片遮住，不存在回退。删的瞬间 `stat` 还能看到 `Links: 0` 的悬挂 inode，`sha256sum` 读的也是这个已 unlink 的 inode —— 上层那份又恰好和 `/rom` 逐字节相同，于是"回退成功"是个假象；`echo 2 > /proc/sys/vm/drop_caches` 之后合并路径就是 `No such file or directory`。另外必须用**原始 upper 路径**删，走合并路径 `rm` 会留下 whiteout，更回退不了。

- 但**指向固件副本的符号链接可以** —— 路径解析由内核 VFS 做，跟 overlay 无关，`/rom` 又是常驻的只读根，所以这份 10.4 M 能直接省掉：

  ```sh
  mv /etc/openclash/GeoSite.dat /tmp/geodata-stash/GeoSite.dat.upper
  ln -s /rom/etc/openclash/GeoSite.dat /etc/openclash/GeoSite.dat
  sha256sum /etc/openclash/GeoSite.dat   # 26d0b6e7…，能读到就说明链接可用
  ```

  `grep -ac geodata-path /etc/openclash/clash` = 0：mihomo 没有「指定 geodata 路径」的配置项，文件名固定按 `-d` 所在目录拼，所以符号链接是唯一的接入方式。代价是 `GeoSite.dat` 冻结在固件版本（Jul 15）；每周的 `geosite` cron 会 `cmp` 比对，上游真变了就把这个链接 `mv` 掉（变回真的 10.4 M 文件）—— 你拿到新数据，省下的空间随之收回，想继续省就再 `ln -s` 一次（会把数据退回固件版本），两者二选一。`Country.mmdb` 只有 205 K，同样可以链 `/rom/etc/openclash/Country.mmdb`，收益可以忽略，没做。

- 实测这台（38.6 M 的 `/overlay`）：原本 37188/39564 KiB used，处理后 **23684/39564（63%）**，约 13.2 MiB 实际 flash（`GeoSite.dat` 刚链上去那会儿测到的是 23916/39564，之后几次重启落回 23684）。省掉的是 39.0 M 逻辑字节（GeoIP.dat 16.5 + ASN.mmdb 12.1 + GeoSite.dat 10.4），UBIFS 会压缩，所以 `df` 上看到的实占比逻辑值小得多 —— 按逻辑值算「省了 39 M」，按 `df` 算 13 MiB，两个都对。

- 判断模块有没有生效：`grep -n 'geodata-mode\|geo-auto-update' /etc/openclash/<运行配置>` 应该是 `geodata-mode: false` 且没有 `geo-auto-update: true`；`/tmp/openclash.log` 里能看到 `match GeoIP(cn) using 国内网站[直连]` 就说明 mmdb 模式的 `GEOIP,cn` 正常工作。`uci show openclash.@overwrite[0]` 里应该出现模块钉的那五个键（`enable_geoip_dat='0'`、`geoip_auto_update='0'`、`geoasn_auto_update='0'`、`geo_auto_update='1'`、`geosite_auto_update='1'`），有这几项才说明 `[General]` 被接受了；想单独验证优先级，用 `. /usr/share/openclash/uci.sh; uci_get_config geoip_auto_update`，即使 `openclash.config.geoip_auto_update='1'` 也应该返回 `0`。
