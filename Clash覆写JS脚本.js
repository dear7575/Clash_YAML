/*
powerfullz 的 Substore 订阅转换脚本 - 增强版
https://github.com/powerfullz/override-rules
传入参数：
- loadbalance: 启用负载均衡 (默认false)
- landing: 启用落地节点功能 (默认false)
- ipv6: 启用 IPv6 支持 (默认false)
- full: 启用完整配置，用于纯内核启动 (默认false)
- keepalive: 启用 tcp-keep-alive (默认false)
- fakeip: DNS 使用 FakeIP 而不是 RedirHost (默认false)
- tunmode: 启用TUN模式防DNS泄漏 (默认false)
- providers: 自定义代理提供者配置 (默认false)
*/

const inArg = typeof $arguments !== 'undefined' ? $arguments : {};
const loadBalance = parseBool(inArg.loadbalance) || false,
    landing = parseBool(inArg.landing) || false,
    ipv6Enabled = parseBool(inArg.ipv6) || false,
    fullConfig = parseBool(inArg.full) || false,
    keepAliveEnabled = parseBool(inArg.keepalive) || false,
    fakeIPEnabled = parseBool(inArg.fakeip) || false,
    tunModeEnabled = parseBool(inArg.tunmode) || false,
    customProviders = parseBool(inArg.providers) || false;

function parseBool(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
        return value.toLowerCase() === "true" || value === "1";
    }
    return false;
}

// 增强的DNS配置 - 结合test2的防泄漏特性
const enhancedDnsConfig = {
    "enable": true,
    "listen": "0.0.0.0:1053",
    "ipv6": ipv6Enabled,
    "use-system-hosts": false,
    "cache-algorithm": "arc",
    "prefer-h3": true,
    "use-hosts": false, // 禁用hosts文件防止DNS泄漏
    "respect-rules": true,
    "enhanced-mode": fakeIPEnabled ? "fake-ip" : "redir-host",
    "fake-ip-range": "198.18.0.1/16",
    "fake-ip-filter": [
        // 本地主机/设备
        "+.lan", "+.local", "*.localhost", "*.local", "*.lan",
        "localhost", "ip6-localhost", "ip6-loopback",
        // 局域网IP段
        "127.*", "10.*", "172.*.*", "192.168.*", "169.254.*",
        // 路由器管理界面
        "router.asus.com", "routerlogin.net", "orbilogin.com",
        "amplifi.lan", "router.synology.com", "myrouter.local",
        "www.routerlogin.net",
        // 打印机等设备
        "*.printer", "*.router", "*.nas",
        // NTP时间服务器
        "time.*.com", "ntp.*.com", "*.time.edu.cn", "*.ntp.org.cn",
        // Windows连接检测
        "+.msftconnecttest.com", "+.msftncsi.com",
        "www.msftconnecttest.com", "ipv6.msftconnecttest.com",
        // Apple连接检测
        "captive.apple.com", "*.apple.com.edgekey.net", "*.icloud.com.edgekey.net",
        // QQ快速登录检测失败
        "localhost.ptlogin2.qq.com", "localhost.sec.qq.com",
        // 微信快速登录检测失败
        "localhost.work.weixin.qq.com",
        // 游戏平台本地服务
        "*.battle.net", "*.blizzard.com", "*.steam-chat.com", "*.epicgames.dev",
        // 开发环境
        "*.test", "*.localhost", "*.dev", "*.example",
        // DNS根服务器
        "a.root-servers.net", "b.root-servers.net", "c.root-servers.net",
        "d.root-servers.net", "e.root-servers.net", "f.root-servers.net",
        "g.root-servers.net", "h.root-servers.net", "i.root-servers.net",
        "j.root-servers.net", "k.root-servers.net", "l.root-servers.net",
        "m.root-servers.net"
    ],
    "default-nameserver": [
        "119.29.29.29",
        "223.5.5.5",
    ],
    "nameserver": [
        "system",
        "223.5.5.5",
        "119.29.29.29",
        "180.184.1.1",
    ],
    "fallback": [
        "quic://dns0.eu",
        "https://dns.cloudflare.com/dns-query",
        "https://dns.sb/dns-query",
        "tcp://208.67.222.222",
        "tcp://8.26.56.2"
    ],
    "proxy-server-nameserver": [
        "quic://223.5.5.5",
        "tls://dot.pub",
    ],
    // DNS配置优化
    "force-dns-mapping": true,
    "disable-cache": false
};

// 国内DNS服务器
const domesticNameservers = [
    "https://dns.alidns.com/dns-query", // 阿里云公共DNS
    "https://doh.pub/dns-query", // 腾讯DNSPod
    "https://doh.360.cn/dns-query" // 360安全DNS
];

// 国外DNS服务器
const foreignNameservers = [
    "https://1.1.1.1/dns-query", // Cloudflare(主)
    "https://1.0.0.1/dns-query", // Cloudflare(备)
    "https://208.67.222.222/dns-query", // OpenDNS(主)
    "https://208.67.220.220/dns-query", // OpenDNS(备)
    "https://194.242.2.2/dns-query", // Mullvad(主)
    "https://194.242.2.3/dns-query" // Mullvad(备)
];

// 如果启用FakeIP，使用增强的DNS配置
if (fakeIPEnabled) {
    enhancedDnsConfig["nameserver-policy"] = {
        "geosite:cn,private": domesticNameservers, // 国内域名用国内DNS
        "geo:cn": domesticNameservers, // IP地址也分流
        "geosite:gfw": foreignNameservers, // GFW列表用国外DNS
        "geosite:geolocation-!cn": foreignNameservers, // 国外域名用国外DNS
        "full-nameserver": foreignNameservers // 兜底用国外DNS
    };
}

function buildBaseLists({ landing, lowCost, countryInfo }) {
    const countryGroupNames = countryInfo
        .filter(item => item.count > 2)
        .map(item => item.country + "节点");

    // defaultSelector (选择节点 组里展示的候选)
    const selector = ["故障转移"]; // 把 fallback 放在最前
    if (landing) selector.push("落地节点");
    selector.push(...countryGroupNames);
    if (lowCost) selector.push("低倍率节点");
    selector.push("手动选择", "DIRECT");

    // defaultProxies (各分类策略引用)
    const defaultProxies = ["选择节点", ...countryGroupNames];
    if (lowCost) defaultProxies.push("低倍率节点");
    defaultProxies.push("手动选择", "直连");

    // direct 优先的列表
    const defaultProxiesDirect = ["直连", ...countryGroupNames, "选择节点", "手动选择"];
    if (lowCost) {
        defaultProxiesDirect.splice(1 + countryGroupNames.length, 0, "低倍率节点");
    }

    const defaultFallback = [];
    if (landing) defaultFallback.push("落地节点");
    defaultFallback.push(...countryGroupNames);
    if (lowCost) defaultFallback.push("低倍率节点");
    defaultFallback.push("手动选择", "DIRECT");

    return { defaultProxies, defaultProxiesDirect, defaultSelector: selector, defaultFallback, countryGroupNames };
}

// 增强的规则提供者配置 - 结合两个脚本的规则集
const enhancedRuleProviders = {
    // 原有的powerfullz规则集
    "ADBlock": {
        "type": "http", "behavior": "domain", "format": "text", "interval": 86400,
        "url": "https://adrules.top/adrules_domainset.txt",
        "path": "./ruleset/ADBlock.txt"
    },
    "TruthSocial": {
        "url": "https://cdn.jsdelivr.net/gh/powerfullz/override-rules@master/ruleset/TruthSocial.list",
        "path": "./ruleset/TruthSocial.list",
        "behavior": "classical", "interval": 86400, "format": "text", "type": "http"
    },
    "SogouInput": {
        "type": "http", "behavior": "classical", "format": "text", "interval": 86400,
        "url": "https://ruleset.skk.moe/Clash/non_ip/sogouinput.txt",
        "path": "./ruleset/SogouInput.txt"
    },
    "StaticResources": {
        "type": "http", "behavior": "domain", "format": "text", "interval": 86400,
        "url": "https://ruleset.skk.moe/Clash/domainset/cdn.txt",
        "path": "./ruleset/StaticResources.txt"
    },
    "CDNResources": {
        "type": "http", "behavior": "classical", "format": "text", "interval": 86400,
        "url": "https://ruleset.skk.moe/Clash/non_ip/cdn.txt",
        "path": "./ruleset/CDNResources.txt"
    },
    "AI": {
        "type": "http", "behavior": "classical", "format": "text", "interval": 86400,
        "url": "https://ruleset.skk.moe/Clash/non_ip/ai.txt",
        "path": "./ruleset/AI.txt"
    },
    "TikTok": {
        "type": "http", "behavior": "classical", "format": "text", "interval": 86400,
        "url": "https://cdn.jsdelivr.net/gh/powerfullz/override-rules@master/ruleset/TikTok.list",
        "path": "./ruleset/TikTok.list"
    },
    "EHentai": {
        "type": "http", "behavior": "classical", "format": "text", "interval": 86400,
        "url": "https://cdn.jsdelivr.net/gh/powerfullz/override-rules@master/ruleset/EHentai.list",
        "path": "./ruleset/EHentai.list"
    },
    "SteamFix": {
        "type": "http", "behavior": "classical", "format": "text", "interval": 86400,
        "url": "https://cdn.jsdelivr.net/gh/powerfullz/override-rules@master/ruleset/SteamFix.list",
        "path": "./ruleset/SteamFix.list"
    },
    "GoogleFCM": {
        "type": "http", "behavior": "classical", "interval": 86400, "format": "text",
        "path": "./ruleset/FirebaseCloudMessaging.list",
        "url": "https://cdn.jsdelivr.net/gh/powerfullz/override-rules@master/ruleset/FirebaseCloudMessaging.list",
    },
    "AdditionalFilter": {
        "type": "http", "behavior": "classical", "format": "text", "interval": 86400,
        "url": "https://cdn.jsdelivr.net/gh/powerfullz/override-rules@master/ruleset/AdditionalFilter.list",
        "path": "./ruleset/AdditionalFilter.list"
    },
    "AdditionalCDNResources": {
        "type": "http", "behavior": "classical", "format": "text", "interval": 86400,
        "url": "https://cdn.jsdelivr.net/gh/powerfullz/override-rules@master/ruleset/AdditionalCDNResources.list",
        "path": "./ruleset/AdditionalCDNResources.list"
    },
    "Crypto": {
        "type": "http", "behavior": "classical", "format": "text", "interval": 86400,
        "url": "https://cdn.jsdelivr.net/gh/powerfullz/override-rules@master/ruleset/Crypto.list",
        "path": "./ruleset/Crypto.list"
    },
    // 新增Loyalsoldier规则集 - 来自test2
    "reject": {
        "type": "http", "format": "yaml", "interval": 86400,
        "behavior": "domain",
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/reject.txt",
        "path": "./ruleset/loyalsoldier/reject.yaml"
    },
    "icloud": {
        "type": "http", "format": "yaml", "interval": 86400,
        "behavior": "domain",
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/icloud.txt",
        "path": "./ruleset/loyalsoldier/icloud.yaml"
    },
    "apple": {
        "type": "http", "format": "yaml", "interval": 86400,
        "behavior": "domain",
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/apple.txt",
        "path": "./ruleset/loyalsoldier/apple.yaml"
    },
    "google": {
        "type": "http", "format": "yaml", "interval": 86400,
        "behavior": "domain",
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/google.txt",
        "path": "./ruleset/loyalsoldier/google.yaml"
    },
    "proxy": {
        "type": "http", "format": "yaml", "interval": 86400,
        "behavior": "domain",
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/proxy.txt",
        "path": "./ruleset/loyalsoldier/proxy.yaml"
    },
    "direct": {
        "type": "http", "format": "yaml", "interval": 86400,
        "behavior": "domain",
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/direct.txt",
        "path": "./ruleset/loyalsoldier/direct.yaml"
    },
    "private": {
        "type": "http", "format": "yaml", "interval": 86400,
        "behavior": "domain",
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/private.txt",
        "path": "./ruleset/loyalsoldier/private.yaml"
    },
    "gfw": {
        "type": "http", "format": "yaml", "interval": 86400,
        "behavior": "domain",
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/gfw.txt",
        "path": "./ruleset/loyalsoldier/gfw.yaml"
    },
    "tld-not-cn": {
        "type": "http", "format": "yaml", "interval": 86400,
        "behavior": "domain",
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/tld-not-cn.txt",
        "path": "./ruleset/loyalsoldier/tld-not-cn.yaml"
    },
    "telegramcidr": {
        "type": "http", "format": "yaml", "interval": 86400,
        "behavior": "ipcidr",
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/telegramcidr.txt",
        "path": "./ruleset/loyalsoldier/telegramcidr.yaml"
    },
    "cncidr": {
        "type": "http", "format": "yaml", "interval": 86400,
        "behavior": "ipcidr",
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/cncidr.txt",
        "path": "./ruleset/loyalsoldier/cncidr.yaml"
    },
    "lancidr": {
        "type": "http", "format": "yaml", "interval": 86400,
        "behavior": "ipcidr",
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/lancidr.txt",
        "path": "./ruleset/loyalsoldier/lancidr.yaml"
    },
    "applications": {
        "type": "http", "format": "yaml", "interval": 86400,
        "behavior": "classical",
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/applications.txt",
        "path": "./ruleset/loyalsoldier/applications.yaml"
    },
    "openai": {
        "type": "http", "format": "yaml", "interval": 86400,
        "behavior": "classical",
        "url": "https://fastly.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Clash/OpenAI/OpenAI.yaml",
        "path": "./ruleset/blackmatrix7/openai.yaml"
    }
};

// 增强的规则配置 - 结合两个脚本的规则
const enhancedRules = [
    // 局域网和本地服务 - 最高优先级
    "DOMAIN-SUFFIX,local,直连",
    "DOMAIN-SUFFIX,lan,直连",
    "DOMAIN-SUFFIX,localhost,直连",
    "IP-CIDR,127.0.0.0/8,直连,no-resolve",
    "IP-CIDR,10.0.0.0/8,直连,no-resolve",
    "IP-CIDR,172.16.0.0/12,直连,no-resolve",
    "IP-CIDR,192.168.0.0/16,直连,no-resolve",
    "IP-CIDR,169.254.0.0/16,直连,no-resolve",

    // AI服务相关 - 高优先级
    "DOMAIN-SUFFIX,chatgpt.com,AI",
    "DOMAIN-SUFFIX,claude.ai,AI",
    "DOMAIN-SUFFIX,anthropic.com,AI",
    "DOMAIN-SUFFIX,perplexity.ai,AI",
    "DOMAIN-SUFFIX,gemini.google.com,AI",
    "DOMAIN-SUFFIX,augmentcode.com,AI",

    // 原有规则集
    "RULE-SET,ADBlock,广告拦截",
    "RULE-SET,AdditionalFilter,广告拦截",
    "RULE-SET,SogouInput,搜狗输入法",
    "RULE-SET,TruthSocial,Truth Social",
    "RULE-SET,StaticResources,静态资源",
    "RULE-SET,CDNResources,静态资源",
    "RULE-SET,AdditionalCDNResources,静态资源",
    "RULE-SET,AI,AI",
    "RULE-SET,Crypto,Crypto",
    "RULE-SET,EHentai,E-Hentai",
    "RULE-SET,TikTok,TikTok",
    "RULE-SET,SteamFix,直连",
    "RULE-SET,GoogleFCM,直连",

    // 新增Loyalsoldier规则集
    "RULE-SET,applications,直连",
    "RULE-SET,private,直连",
    "RULE-SET,reject,广告拦截",
    "RULE-SET,icloud,苹果服务",
    "RULE-SET,apple,苹果服务",
    "RULE-SET,google,谷歌服务",
    "RULE-SET,proxy,选择节点",
    "RULE-SET,gfw,选择节点",
    "RULE-SET,tld-not-cn,选择节点",
    "RULE-SET,direct,直连",
    "RULE-SET,lancidr,直连,no-resolve",
    "RULE-SET,cncidr,直连,no-resolve",
    "RULE-SET,telegramcidr,Telegram,no-resolve",
    "RULE-SET,openai,AI",

    // 原有GEOSITE规则
    "GEOSITE,GOOGLE-PLAY@CN,直连",
    "GEOSITE,TELEGRAM,Telegram",
    "GEOSITE,YOUTUBE,YouTube",
    "GEOSITE,NETFLIX,Netflix",
    "GEOSITE,SPOTIFY,Spotify",
    "GEOSITE,BAHAMUT,Bahamut",
    "GEOSITE,BILIBILI,Bilibili",
    "GEOSITE,MICROSOFT@CN,直连",
    "GEOSITE,PIKPAK,PikPak",
    "GEOSITE,GFW,选择节点",
    "GEOSITE,CN,直连",
    "GEOSITE,PRIVATE,直连",
    "GEOIP,NETFLIX,Netflix,no-resolve",
    "GEOIP,TELEGRAM,Telegram,no-resolve",
    "GEOIP,CN,直连",
    "GEOIP,PRIVATE,直连",
    "DST-PORT,22,SSH(22端口)",
    "MATCH,选择节点"
];

// 增强的嗅探配置
const enhancedSnifferConfig = {
    "sniff": {
        "TLS": {
            "ports": [443, 8443],
        },
        "HTTP": {
            "ports": [80, 8080, 8880],
        },
        "QUIC": {
            "ports": [443, 8443],
        }
    },
    "override-destination": false,
    "enable": true,
    "force-dns-mapping": true,
    "skip-domain": [
        "Mijia Cloud",
        "dlg.io.mi.com",
        "+.push.apple.com"
    ]
};

const geoxURL = {
    "geoip": "https://cdn.jsdelivr.net/gh/Loyalsoldier/v2ray-rules-dat@release/geoip.dat",
    "geosite": "https://cdn.jsdelivr.net/gh/Loyalsoldier/v2ray-rules-dat@release/geosite.dat",
    "mmdb": "https://cdn.jsdelivr.net/gh/Loyalsoldier/geoip@release/Country.mmdb",
    "asn": "https://cdn.jsdelivr.net/gh/Loyalsoldier/geoip@release/GeoLite2-ASN.mmdb"
};

// 地区元数据 - 扩展更多地区
const countriesMeta = {
    "香港": {
        pattern: "(?i)香港|港|HK|hk|Hong Kong|HongKong|hongkong|🇭🇰",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Hong_Kong.png"
    },
    "澳门": {
        pattern: "(?i)澳门|MO|Macau|🇲🇴",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Macao.png"
    },
    "台湾": {
        pattern: "(?i)台|新北|彰化|TW|Taiwan|🇹🇼",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Taiwan.png"
    },
    "新加坡": {
        pattern: "(?i)新加坡|坡|狮城|SG|Singapore|🇸🇬",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Singapore.png"
    },
    "日本": {
        pattern: "(?i)日本|川日|东京|大阪|泉日|埼玉|沪日|深日|JP|Japan|🇯🇵",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Japan.png"
    },
    "韩国": {
        pattern: "(?i)KR|Korea|KOR|首尔|韩|韓|🇰🇷",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Korea.png"
    },
    "美国": {
        pattern: "(?i)美国|美|US|United States|🇺🇸",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/United_States.png"
    },
    "加拿大": {
        pattern: "(?i)加拿大|Canada|CA|🇨🇦",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Canada.png"
    },
    "英国": {
        pattern: "(?i)英国|United Kingdom|UK|伦敦|London|🇬🇧",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/United_Kingdom.png"
    },
    "澳大利亚": {
        pattern: "(?i)澳洲|澳大利亚|AU|Australia|🇦🇺",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Australia.png"
    },
    "德国": {
        pattern: "(?i)德国|德|DE|Germany|🇩🇪",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Germany.png"
    },
    "法国": {
        pattern: "(?i)法国|法|FR|France|🇫🇷",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/France.png"
    },
    "俄罗斯": {
        pattern: "(?i)俄罗斯|俄|RU|Russia|🇷🇺",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Russia.png"
    },
    "泰国": {
        pattern: "(?i)泰国|泰|TH|Thailand|🇹🇭",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Thailand.png"
    },
    "印度": {
        pattern: "(?i)印度|IN|India|🇮🇳",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/India.png"
    },
    "马来西亚": {
        pattern: "(?i)马来西亚|马来|MY|Malaysia|🇲🇾",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Malaysia.png"
    },
    "荷兰": {
        pattern: "(?i)荷兰|NL|Netherlands|🇳🇱",
        icon: "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/flags/nl.svg"
    },
    "瑞士": {
        pattern: "(?i)瑞士|CH|Switzerland|🇨🇭",
        icon: "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/flags/ch.svg"
    },
    "瑞典": {
        pattern: "(?i)瑞典|SE|Sweden|🇸🇪",
        icon: "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/flags/se.svg"
    },
    "挪威": {
        pattern: "(?i)挪威|NO|Norway|🇳🇴",
        icon: "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/flags/no.svg"
    },
    "芬兰": {
        pattern: "(?i)芬兰|FI|Finland|🇫🇮",
        icon: "https://testingcf.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Finland.png"
    },
    "丹麦": {
        pattern: "(?i)丹麦|DK|Denmark|🇩🇰",
        icon: "https://fastly.jsdelivr.net/gh/clash-verge-rev.github.io@main/docs/assets/icons/flags/dk.svg"
    },
    "意大利": {
        pattern: "(?i)意大利|IT|Italy|🇮🇹",
        icon: "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/flags/it.svg"
    },
    "西班牙": {
        pattern: "(?i)西班牙|ES|Spain|🇪🇸",
        icon: "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/flags/es.svg"
    },
    "奥地利": {
        pattern: "(?i)奥地利|AT|Austria|🇦🇹",
        icon: "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/flags/at.svg"
    },
    "比利时": {
        pattern: "(?i)比利时|BE|Belgium|🇧🇪",
        icon: "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/flags/be.svg"
    },
    "菲律宾": {
        pattern: "(?i)菲律宾|PH|Philippines|🇵🇭",
        icon: "https://testingcf.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Philippines.png"
    },
    "阿根廷": {
        pattern: "(?i)阿根廷|AR|Argentina|🇦🇷",
        icon: "https://testingcf.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Argentina.png"
    },
    "印度尼西亚": {
        pattern: "(?i)印尼|印度尼西亚|ID|Indonesia|🇮🇩",
        icon: "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/flags/id.svg"
    },
    "越南": {
        pattern: "(?i)越南|VN|Vietnam|🇻🇳",
        icon: "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/flags/vn.svg"
    },
    "巴西": {
        pattern: "(?i)巴西|BR|Brazil|🇧🇷",
        icon: "https://testingcf.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Brazil.png"
    }
};

// 健康检查配置模板 - 来自test2的优秀特性
const healthCheckTemplates = {
    // 高敏感度测速
    highSensitive: {
        "enable": true,
        "interval": 300,  // 5分钟
        "url": "https://cp.cloudflare.com/generate_204",
        "method": "HEAD",
        "timeout": 3,
        "expected-status": "204"
    },
    // 标准健康检查
    standard: {
        "enable": true,
        "interval": 600,  // 10分钟
        "url": "https://cp.cloudflare.com/generate_204",
        "method": "HEAD",
        "timeout": 5,
        "expected-status": "204"
    },
    // 快速健康检查
    fast: {
        "enable": true,
        "interval": 300,  // 5分钟
        "url": "https://cp.cloudflare.com/generate_204",
        "method": "HEAD",
        "timeout": 3,
        "expected-status": "204"
    },
    // AI服务健康检查
    ai: {
        "enable": true,
        "interval": 1200,  // 20分钟
        "url": "https://chatgpt.com",
        "method": "HEAD",
        "timeout": 10,
        "expected-status": "200"
    },
    // 媒体服务健康检查
    media: {
        "enable": true,
        "interval": 900,  // 15分钟
        "url": "https://www.youtube.com/generate_204",
        "method": "HEAD",
        "timeout": 8,
        "expected-status": "204"
    }
};

// 代理组通用配置
const groupBaseOption = {
    "interval": 300,
    "timeout": 3000,
    "url": "https://cp.cloudflare.com/generate_204",
    "lazy": true,
    "max-failed-times": 3,
    "hidden": false
};

function hasLowCost(config) {
    // 检查是否有低倍率节点
    const proxies = config["proxies"];
    const lowCostRegex = new RegExp(/0\.[0-5]|低倍率|省流|大流量|实验性/, 'i');
    for (const proxy of proxies) {
        if (lowCostRegex.test(proxy.name)) {
            return true;
        }
    }
    return false;
}

function parseCountries(config) {
    const proxies = config.proxies || [];
    const ispRegex = /家宽|家庭|家庭宽带|商宽|商业宽带|星链|Starlink|落地/i;   // 需要排除的关键字

    // 用来累计各国节点数
    const countryCounts = Object.create(null);

    // 构建地区正则表达式，去掉 (?i) 前缀
    const compiledRegex = {};
    for (const [country, meta] of Object.entries(countriesMeta)) {
        compiledRegex[country] = new RegExp(
            meta.pattern.replace(/^\(\?i\)/, ''),
            'i'
        );
    }

    // 逐个节点进行匹配与统计
    for (const proxy of proxies) {
        const name = proxy.name || '';

        // 过滤掉不想统计的 ISP 节点
        if (ispRegex.test(name)) continue;

        // 找到第一个匹配到的地区就计数并终止本轮
        for (const [country, regex] of Object.entries(compiledRegex)) {
            if (regex.test(name)) {
                countryCounts[country] = (countryCounts[country] || 0) + 1;
                break;    // 避免一个节点同时累计到多个地区
            }
        }
    }

    // 将结果对象转成数组形式
    const result = [];
    for (const [country, count] of Object.entries(countryCounts)) {
        result.push({ country, count });
    }

    return result;   // [{ country: 'Japan', count: 12 }, ...]
}

function buildCountryProxyGroups(countryList) {
    // 获取实际存在的地区列表
    const countryProxyGroups = [];

    // 为实际存在的地区创建节点组
    for (const country of countryList) {
        // 确保地区名称在预设的地区配置中存在
        if (countriesMeta[country]) {
            const groupName = `${country}节点`;
            const pattern = countriesMeta[country].pattern;

            const groupConfig = {
                "name": groupName,
                "icon": countriesMeta[country].icon,
                "include-all": true,
                "filter": pattern,
                "exclude-filter": landing ? "(?i)家宽|家庭|家庭宽带|商宽|商业宽带|星链|Starlink|落地|0\.[0-5]|低倍率|省流|大流量|实验性" : "0\.[0-5]|低倍率|省流|大流量|实验性",
                "type": (loadBalance) ? "load-balance" : "url-test",
            };

            if (!loadBalance) {
                Object.assign(groupConfig, {
                    "url": "https://cp.cloudflare.com/generate_204",
                    "interval": 60,
                    "tolerance": 20,
                    "lazy": false,
                    "health-check": healthCheckTemplates.standard
                });
            }

            countryProxyGroups.push(groupConfig);
        }
    }

    return countryProxyGroups;
}

function buildProxyGroups({
                              countryList,
                              countryProxyGroups,
                              lowCost,
                              defaultProxies,
                              defaultProxiesDirect,
                              defaultSelector,
                              defaultFallback
                          }) {
    // 查看是否有特定地区的节点
    const hasTW = countryList.includes("台湾");
    const hasHK = countryList.includes("香港");
    const hasUS = countryList.includes("美国");
    // 排除落地节点、选择节点和故障转移以避免死循环
    const frontProxySelector = [
        ...defaultSelector.filter(name => name !== "落地节点" && name !== "故障转移")
    ];

    const baseGroups = [
        {
            "name": "选择节点",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Proxy.png",
            "type": "select",
            "proxies": defaultSelector,
            "health-check": healthCheckTemplates.fast
        },
        {
            "name": "手动选择",
            "icon": "https://cdn.jsdmirror.com/gh/shindgewongxj/WHATSINStash@master/icon/select.png",
            "include-all": true,
            "type": "select"
        },
        (landing) ? {
            "name": "前置代理",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Area.png",
            "type": "select",
            "include-all": true,
            "exclude-filter": "(?i)家宽|家庭|家庭宽带|商宽|商业宽带|星链|Starlink|落地",
            "proxies": frontProxySelector
        } : null,
        (landing) ? {
            "name": "落地节点",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Airport.png",
            "type": "select",
            "include-all": true,
            "filter": "(?i)家宽|家庭|家庭宽带|商宽|商业宽带|星链|Starlink|落地",
        } : null,
        {
            "name": "故障转移",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Bypass.png",
            "type": "fallback",
            "url": "https://cp.cloudflare.com/generate_204",
            "proxies": defaultFallback,
            "interval": 180,
            "tolerance": 20,
            "lazy": false,
            "health-check": healthCheckTemplates.standard
        },
        // 负载均衡组 - 来自test2的优秀特性
        {
            ...groupBaseOption,
            "name": "负载均衡(散列)", // 适合：流媒体、游戏、需要会话保持的服务
            "type": "load-balance",
            "strategy": "consistent-hashing", // 相同域名总是使用相同节点
            "include-all": true,
            "filter": "^((?!(DIRECTLY|DIRECT|Proxy|Traffic|Expire|Expired|过期|到期|套餐|剩余|流量|官网|超时|失效|Invalid|Test|测速|本地|Local)).)*$",
            "health-check": healthCheckTemplates.standard,
            "icon": "https://testingcf.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Round_Robin_1.png"
        },
        {
            ...groupBaseOption,
            "name": "负载均衡(轮询)", // 适合：下载、浏览、API调用
            "type": "load-balance",
            "strategy": "round-robin", // 请求轮流分配到不同节点
            "include-all": true,
            "filter": "^((?!(DIRECTLY|DIRECT|Proxy|Traffic|Expire|Expired|过期|到期|套餐|剩余|流量|官网|超时|失效|Invalid|Test|测速|本地|Local)).)*$",
            "health-check": healthCheckTemplates.standard,
            "icon": "https://testingcf.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Round_Robin.png"
        },
        {
            "name": "静态资源",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Cloudflare.png",
            "type": "select",
            "proxies": defaultProxies,
        },
        {
            "name": "AI",
            "icon": "https://cdn.jsdelivr.net/gh/powerfullz/override-rules@master/icons/chatgpt.png",
            "type": "select",
            "proxies": defaultProxies,
            "health-check": healthCheckTemplates.ai
        },
        {
            "name": "Telegram",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Telegram.png",
            "type": "select",
            "proxies": defaultProxies
        },
        {
            "name": "YouTube",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/YouTube.png",
            "type": "select",
            "proxies": defaultProxies,
            "health-check": healthCheckTemplates.media
        },
        {
            "name": "Bilibili",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/bilibili.png",
            "type": "select",
            "proxies": (hasTW && hasHK) ? ["直连", "台湾节点", "香港节点"] : defaultProxiesDirect
        },
        {
            "name": "Netflix",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Netflix.png",
            "type": "select",
            "proxies": defaultProxies,
            "health-check": healthCheckTemplates.media
        },
        {
            "name": "Spotify",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Spotify.png",
            "type": "select",
            "proxies": defaultProxies,
            "health-check": healthCheckTemplates.media
        },
        {
            "name": "TikTok",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/TikTok.png",
            "type": "select",
            "proxies": defaultProxies
        },
        {
            "name": "E-Hentai",
            "icon": "https://cdn.jsdelivr.net/gh/powerfullz/override-rules@master/icons/Ehentai.png",
            "type": "select",
            "proxies": defaultProxies
        },
        {
            "name": "PikPak",
            "icon": "https://cdn.jsdelivr.net/gh/powerfullz/override-rules@master/icons/PikPak.png",
            "type": "select",
            "proxies": defaultProxies
        },
        {
            "name": "Truth Social",
            "icon": "https://cdn.jsdelivr.net/gh/powerfullz/override-rules@master/icons/TruthSocial.png",
            "type": "select",
            "proxies": (hasUS) ? ["美国节点", "选择节点", "手动选择"] : defaultProxies
        },
        {
            "name": "Bahamut",
            "icon": "https://cdn.jsdmirror.com/gh/Koolson/Qure@master/IconSet/Color/Bahamut.png",
            "type": "select",
            "proxies": (hasTW) ? ["台湾节点", "选择节点", "手动选择", "直连"] : defaultProxies
        },
        {
            "name": "Crypto",
            "icon": "https://cdn.jsdmirror.com/gh/Koolson/Qure@master/IconSet/Color/Cryptocurrency_3.png",
            "type": "select",
            "proxies": defaultProxies
        },
        {
            "name": "SSH(22端口)",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Server.png",
            "type": "select",
            "proxies": defaultProxies
        },
        {
            "name": "搜狗输入法",
            "icon": "https://cdn.jsdelivr.net/gh/powerfullz/override-rules@master/icons/Sougou.png",
            "type": "select",
            "proxies": [
                "直连", "REJECT"
            ]
        },
        // 新增服务组 - 来自test2
        {
            "name": "谷歌服务",
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/google.svg",
            "type": "select",
            "proxies": defaultProxies
        },
        {
            "name": "苹果服务",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Apple.png",
            "type": "select",
            "proxies": ["直连", ...defaultProxies]
        },
        {
            "name": "微软服务",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Microsoft.png",
            "type": "select",
            "proxies": ["直连", ...defaultProxies]
        },
        {
            "name": "直连",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Direct.png",
            "type": "select",
            "proxies": [
                "DIRECT", "选择节点"
            ]
        },
        {
            "name": "广告拦截",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/AdBlack.png",
            "type": "select",
            "proxies": [
                "REJECT", "直连"
            ]
        },
        (lowCost) ? {
            "name": "低倍率节点",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Lab.png",
            "type": "url-test",
            "url": "https://cp.cloudflare.com/generate_204",
            "include-all": true,
            "filter": "(?i)0\.[0-5]|低倍率|省流|大流量|实验性",
            "health-check": healthCheckTemplates.standard
        } : null,
        ...countryProxyGroups
    ].filter(Boolean); // 过滤掉 null 值

    return baseGroups;
}

// 代理提供者配置模板 - 来自test2的优秀特性
function buildProxyProviders() {
    if (!customProviders) return {};

    return {
        // 示例配置，用户可以根据需要修改
        "provider1": {
            "type": "http",
            "url": "", // 用户需要填入实际订阅地址
            "path": "./proxy_provider/provider1.yaml",
            "interval": 3600,
            "health-check": {
                "enable": true,
                "interval": 600,
                "url": "https://cp.cloudflare.com/generate_204"
            }
        },
        "provider2": {
            "type": "http",
            "url": "", // 用户需要填入实际订阅地址
            "path": "./proxy_provider/provider2.yaml",
            "interval": 3600,
            "health-check": {
                "enable": true,
                "interval": 600,
                "url": "https://cp.cloudflare.com/generate_204"
            }
        }
    };
}

function main(config) {
    config = { proxies: config.proxies };
    // 解析地区与低倍率信息
    const countryInfo = parseCountries(config); // [{ country, count }]
    const lowCost = hasLowCost(config);

    // 构建基础数组
    const {
        defaultProxies,
        defaultProxiesDirect,
        defaultSelector,
        defaultFallback,
        countryGroupNames: targetCountryList
    } = buildBaseLists({ landing, lowCost, countryInfo });

    // 为地区构建对应的 url-test / load-balance 组
    const countryProxyGroups = buildCountryProxyGroups(targetCountryList.map(n => n.replace(/节点$/, '')));

    // 生成代理组
    const proxyGroups = buildProxyGroups({
        countryList: targetCountryList.map(n => n.replace(/节点$/, '')),
        countryProxyGroups,
        lowCost,
        defaultProxies,
        defaultProxiesDirect,
        defaultSelector,
        defaultFallback
    });

    // 如果启用完整配置
    if (fullConfig) Object.assign(config, {
        "mixed-port": 7890,
        "redir-port": 7892,
        "tproxy-port": 7893,
        "routing-mark": 7894,
        "allow-lan": true,
        "ipv6": ipv6Enabled,
        "mode": "rule",
        "unified-delay": true,
        "tcp-concurrent": true,
        "find-process-mode": "off",
        "log-level": "info",
        "geodata-loader": "standard",
        "external-controller": ":9999",
        "disable-keep-alive": !keepAliveEnabled,
        "profile": {
            "store-selected": true,
            "store-fake-ip": true   // 存储fake-ip映射
        }
    });

    // 如果启用TUN模式 - 来自test2的防DNS泄漏特性
    if (tunModeEnabled) {
        config["tun"] = {
            "enable": true,
            "stack": "mixed", // system/gvisor/mixed
            "auto-route": true,
            "auto-redirect": true,
            "auto-detect-interface": true,
            "strict-route": true, // 避免路由污染，防止DNS泄漏
            "dns-hijack": ["any:53", "tcp://any:53"], // 强制劫持所有DNS
            "mtu": 1500,
            "gso": true,
            "gso-max-size": 65536
        };
    }

    // 实验性功能 - 来自test2
    config["experimental"] = {
        "ignore-resolve-fail": true, // 忽略DNS解析失败
        "sniff-tls-sni": true,      // 嗅探TLS SNI
        "sniff-http-host": true     // 嗅探HTTP Host
    };

    // 全局客户端配置
    config["global-client-fingerprint"] = "chrome"; // 使用Chrome指纹

    Object.assign(config, {
        "proxy-groups": proxyGroups,
        "rule-providers": enhancedRuleProviders,
        "rules": enhancedRules,
        "sniffer": enhancedSnifferConfig,
        "dns": enhancedDnsConfig,
        "geodata-mode": true,
        "geox-url": geoxURL,
    });

    // 如果启用自定义代理提供者
    if (customProviders) {
        config["proxy-providers"] = buildProxyProviders();
    }

    return config;
}
