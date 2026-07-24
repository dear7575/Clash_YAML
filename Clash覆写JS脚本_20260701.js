/**
 * 修改自用版 clash 覆写 js 脚本
 * 原作者：powerfullz
 * @author dear7575
 * 传入参数：
 * - loadbalance: 启用负载均衡 (默认false)
 * - landing: 启用落地节点功能 (默认false)
 * - ipv6: 启用 IPv6 支持 (默认false)
 * - full: 启用完整配置，用于纯内核启动 (默认false)
 * - keepalive: 启用 tcp-keep-alive (默认false)
 * - fakeip: DNS 使用 FakeIP 而不是 RedirHost (默认false)
 */

const inArg = typeof $arguments !== 'undefined' ? $arguments : {};

// 读取布尔参数：传入则按传入值解析，未传入则使用 defaultValue。
// 修复原 `parseBool(x) || true` 的逻辑错误——该写法会使任何显式 false 被覆盖为 true，
// 导致 SubStore 混合订阅下无法关闭负载均衡 / FakeIP，进而触发内核校验失败、节点丢失。
// 注意：Clash Party 写入 JS 时 $arguments 始终为空，此时所有值走默认值。
function getBoolArg(value, defaultValue) {
    if (value === undefined || value === null || value === "") return defaultValue;
    return parseBool(value);
}

const loadBalance = getBoolArg(inArg.loadbalance, false),   // 负载均衡：默认开启（Clash Party 无法传参）
    landing = getBoolArg(inArg.landing, false),       // 落地节点：默认关闭
    ipv6Enabled = getBoolArg(inArg.ipv6, false),          // IPv6：默认关闭
    fullConfig = getBoolArg(inArg.full, false),          // 完整配置：默认关闭
    keepAliveEnabled = getBoolArg(inArg.keepalive, true),  // TCP keep-alive：默认关闭
    fakeIPEnabled = getBoolArg(inArg.fakeip, true);         // FakeIP：默认开启

function parseBool(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
        return value.toLowerCase() === "true" || value === "1";
    }
    return false;
}

function buildBaseLists({landing, highCost, lowCost, countryInfo}) {
    const countryGroupNames = countryInfo
        .filter(item => item.count > 0)
        .map(item => item.country + "节点");

    // defaultSelector (选择节点 组里展示的候选)
    // 故障转移, 落地节点(可选), 高倍率节点(可选), 各地区节点, 低倍率节点(可选), 手动选择, DIRECT
    const selector = ["延迟自动", "故障转移"]; // 把 fallback 放在最前
    if (landing) selector.push("落地节点");
    if (highCost) selector.push("高倍率节点");
    selector.push(...countryGroupNames);
    if (lowCost) selector.push("低倍率节点");
    selector.push("手动选择", "DIRECT");

    // defaultProxies (各分类策略引用)
    // 选择节点, 延迟自动, 高倍率节点(可选), 各地区节点, 低倍率节点(可选), 手动选择
    const defaultProxies = ["选择节点", "延迟自动"];
    if (highCost) defaultProxies.push("高倍率节点");
    defaultProxies.push(...countryGroupNames);
    if (lowCost) defaultProxies.push("低倍率节点");
    defaultProxies.push("手动选择");

    // direct 优先的列表
    const defaultProxiesDirect = ["直连", ...countryGroupNames, "选择节点", "手动选择"]; // 直连优先
    // 高倍率放在地区之后、选择节点之前
    if (highCost) {
        defaultProxiesDirect.splice(1 + countryGroupNames.length, 0, "高倍率节点");
    }
    if (lowCost) {
        // 低倍率次于高倍率、早于选择节点
        const insertPos = 1 + countryGroupNames.length + (highCost ? 1 : 0);
        defaultProxiesDirect.splice(insertPos, 0, "低倍率节点");
    }

    const defaultFallback = [];
    if (landing) defaultFallback.push("落地节点");
    if (highCost) defaultFallback.push("高倍率节点");
    defaultFallback.push(...countryGroupNames);
    if (lowCost) defaultFallback.push("低倍率节点");
    // 可选是否加入 手动选择 / DIRECT；按容灾语义加入。
    defaultFallback.push("手动选择", "DIRECT");

    return {defaultProxies, defaultProxiesDirect, defaultSelector: selector, defaultFallback, countryGroupNames};
}

const ruleProviders = {
    "category-ads-all": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/category-ads-all.mrs",
        "path": "./ruleset/category-ads-all.mrs"
    },
    "category-ai-chat-!cn": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/category-ai-chat-!cn.mrs",
        "path": "./ruleset/category-ai-chat-!cn.mrs"
    },
    "youtube": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/youtube.mrs",
        "path": "./ruleset/youtube.mrs"
    },
    "google-mrs": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/google.mrs",
        "path": "./ruleset/google-mrs.mrs"
    },
    "private-mrs": {
        "type": "http", "format": "mrs", "behavior": "ipcidr", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geoip/private.mrs",
        "path": "./ruleset/private-mrs.mrs"
    },
    "geolocation-cn": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/geolocation-cn.mrs",
        "path": "./ruleset/geolocation-cn.mrs"
    },
    "cn-mrs": {
        "type": "http", "format": "mrs", "behavior": "ipcidr", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geoip/cn.mrs",
        "path": "./ruleset/cn-mrs.mrs"
    },
    "telegram-mrs": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/telegram.mrs",
        "path": "./ruleset/telegram-mrs.mrs"
    },
    "github": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/github.mrs",
        "path": "./ruleset/github.mrs"
    },
    "gitlab": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/gitlab.mrs",
        "path": "./ruleset/gitlab.mrs"
    },
    "microsoft-mrs": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/microsoft.mrs",
        "path": "./ruleset/microsoft-mrs.mrs"
    },
    "apple-mrs": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/apple.mrs",
        "path": "./ruleset/apple-mrs.mrs"
    },
    "facebook": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/facebook.mrs",
        "path": "./ruleset/facebook.mrs"
    },
    "instagram": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/instagram.mrs",
        "path": "./ruleset/instagram.mrs"
    },
    "twitter": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/twitter.mrs",
        "path": "./ruleset/twitter.mrs"
    },
    "tiktok-mrs": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/tiktok.mrs",
        "path": "./ruleset/tiktok-mrs.mrs"
    },
    "linkedin": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/linkedin.mrs",
        "path": "./ruleset/linkedin.mrs"
    },
    "netflix-mrs": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/netflix.mrs",
        "path": "./ruleset/netflix-mrs.mrs"
    },
    "hulu": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/hulu.mrs",
        "path": "./ruleset/hulu.mrs"
    },
    "disney": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/disney.mrs",
        "path": "./ruleset/disney.mrs"
    },
    "hbo": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/hbo.mrs",
        "path": "./ruleset/hbo.mrs"
    },
    "amazon": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/amazon.mrs",
        "path": "./ruleset/amazon.mrs"
    },
    "bahamut-mrs": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/bahamut.mrs",
        "path": "./ruleset/bahamut-mrs.mrs"
    },
    "steam": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/steam.mrs",
        "path": "./ruleset/steam.mrs"
    },
    "epicgames": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/epicgames.mrs",
        "path": "./ruleset/epicgames.mrs"
    },
    "ea": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/ea.mrs",
        "path": "./ruleset/ea.mrs"
    },
    "ubisoft": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/ubisoft.mrs",
        "path": "./ruleset/ubisoft.mrs"
    },
    "blizzard": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/blizzard.mrs",
        "path": "./ruleset/blizzard.mrs"
    },
    "coursera": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/coursera.mrs",
        "path": "./ruleset/coursera.mrs"
    },
    "edx": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/edx.mrs",
        "path": "./ruleset/edx.mrs"
    },
    "udemy": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/udemy.mrs",
        "path": "./ruleset/udemy.mrs"
    },
    "khanacademy": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/khanacademy.mrs",
        "path": "./ruleset/khanacademy.mrs"
    },
    "category-scholar-!cn": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/category-scholar-!cn.mrs",
        "path": "./ruleset/category-scholar-!cn.mrs"
    },
    "paypal": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/paypal.mrs",
        "path": "./ruleset/paypal.mrs"
    },
    "visa": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/visa.mrs",
        "path": "./ruleset/visa.mrs"
    },
    "mastercard": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/mastercard.mrs",
        "path": "./ruleset/mastercard.mrs"
    },
    "stripe": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/stripe.mrs",
        "path": "./ruleset/stripe.mrs"
    },
    "wise": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/wise.mrs",
        "path": "./ruleset/wise.mrs"
    },
    "aws": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/aws.mrs",
        "path": "./ruleset/aws.mrs"
    },
    "azure": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/azure.mrs",
        "path": "./ruleset/azure.mrs"
    },
    "digitalocean": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/digitalocean.mrs",
        "path": "./ruleset/digitalocean.mrs"
    },
    "heroku": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/heroku.mrs",
        "path": "./ruleset/heroku.mrs"
    },
    "dropbox": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/dropbox.mrs",
        "path": "./ruleset/dropbox.mrs"
    },
    "geolocation-!cn": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/geolocation-!cn.mrs",
        "path": "./ruleset/geolocation-!cn.mrs"
    },
    // -------- MetaCubeX 扩展服务规则（域名 / MRS） --------
    "openai-mrs": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/openai.mrs",
        "path": "./ruleset/openai-mrs.mrs"
    },
    "onedrive-mrs": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/onedrive.mrs",
        "path": "./ruleset/onedrive-mrs.mrs"
    },
    "biliintl-mrs": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/biliintl.mrs",
        "path": "./ruleset/biliintl-mrs.mrs"
    },
    "category-dev": {
        "type": "http", "format": "mrs", "behavior": "domain", "interval": 86400,
        "url": "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/category-dev.mrs",
        "path": "./ruleset/category-dev.mrs"
    },
    // -------- blackmatrix7 细分类规则（classical / YAML） --------
    "applemusic": {
        "type": "http", "behavior": "classical", "format": "yaml", "interval": 86400,
        "url": "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/AppleMusic/AppleMusic.yaml",
        "path": "./ruleset/applemusic.yaml"
    },
    "discord": {
        "type": "http", "behavior": "classical", "format": "yaml", "interval": 86400,
        "url": "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Discord/Discord.yaml",
        "path": "./ruleset/discord.yaml"
    },
    "whatsapp": {
        "type": "http", "behavior": "classical", "format": "yaml", "interval": 86400,
        "url": "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Whatsapp/Whatsapp.yaml",
        "path": "./ruleset/whatsapp.yaml"
    },
    "wikipedia": {
        "type": "http", "behavior": "classical", "format": "yaml", "interval": 86400,
        "url": "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Wikipedia/Wikipedia.yaml",
        "path": "./ruleset/wikipedia.yaml"
    },
    "reddit": {
        "type": "http", "behavior": "classical", "format": "yaml", "interval": 86400,
        "url": "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Reddit/Reddit.yaml",
        "path": "./ruleset/reddit.yaml"
    },
    "speedtest": {
        "type": "http", "behavior": "classical", "format": "yaml", "interval": 86400,
        "url": "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Speedtest/Speedtest.yaml",
        "path": "./ruleset/speedtest.yaml"
    },
    "cloudflare": {
        "type": "http", "behavior": "classical", "format": "yaml", "interval": 86400,
        "url": "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Cloudflare/Cloudflare.yaml",
        "path": "./ruleset/cloudflare.yaml"
    },
    "mail": {
        "type": "http", "behavior": "classical", "format": "yaml", "interval": 86400,
        "url": "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Mail/Mail.yaml",
        "path": "./ruleset/mail.yaml"
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
    "crypto": {
        "type": "http", "behavior": "classical", "format": "text", "interval": 86400,
        "url": "https://cdn.jsdelivr.net/gh/powerfullz/override-rules@master/ruleset/Crypto.list",
        "path": "./ruleset/Crypto.list"
    },
    "reject": {
        "type": "http", "behavior": "domain", "format": "yaml", "interval": 86400,
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/reject.txt",
        "path": "./ruleset/reject.yaml"
    },
    "icloud": {
        "type": "http", "behavior": "domain", "format": "yaml", "interval": 86400,
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/icloud.txt",
        "path": "./ruleset/icloud.yaml"
    },
    "apple": {
        "type": "http", "behavior": "domain", "format": "yaml", "interval": 86400,
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/apple.txt",
        "path": "./ruleset/apple.yaml"
    },
    "proxy": {
        "type": "http", "behavior": "domain", "format": "yaml", "interval": 86400,
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/proxy.txt",
        "path": "./ruleset/proxy.yaml"
    },
    "direct": {
        "type": "http", "behavior": "domain", "format": "yaml", "interval": 86400,
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/direct.txt",
        "path": "./ruleset/direct.yaml"
    },
    "private": {
        "type": "http", "behavior": "domain", "format": "yaml", "interval": 86400,
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/private.txt",
        "path": "./ruleset/private.yaml"
    },
    "gfw": {
        "type": "http", "behavior": "domain", "format": "yaml", "interval": 86400,
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/gfw.txt",
        "path": "./ruleset/gfw.yaml"
    },
    "tld-not-cn": {
        "type": "http", "behavior": "domain", "format": "yaml", "interval": 86400,
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/tld-not-cn.txt",
        "path": "./ruleset/tld-not-cn.yaml"
    },
    "cncidr": {
        "type": "http", "behavior": "ipcidr", "format": "yaml", "interval": 86400,
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/cncidr.txt",
        "path": "./ruleset/cncidr.yaml"
    },
    "lancidr": {
        "type": "http", "behavior": "ipcidr", "format": "yaml", "interval": 86400,
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/lancidr.txt",
        "path": "./ruleset/lancidr.yaml"
    },
    "applications": {
        "type": "http", "behavior": "classical", "format": "yaml", "interval": 86400,
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/applications.txt",
        "path": "./ruleset/applications.yaml"
    }
}

const rules = [
    // -------- 广告与隐私拦截 --------
    "RULE-SET,category-ads-all,广告拦截",
    "RULE-SET,reject,广告拦截",

    // -------- AI 与开发服务 --------
    "RULE-SET,openai-mrs,AI",
    "RULE-SET,category-ai-chat-!cn,AI",
    "RULE-SET,category-dev,开发服务",
    "RULE-SET,github,开发服务",
    "RULE-SET,gitlab,开发服务",
    "RULE-SET,aws,开发服务",
    "RULE-SET,azure,开发服务",
    "RULE-SET,digitalocean,开发服务",
    "RULE-SET,heroku,开发服务",
    "RULE-SET,dropbox,开发服务",

    // -------- 通讯与社交 --------
    "RULE-SET,telegram-mrs,Telegram",
    "RULE-SET,discord,社交通讯",
    "RULE-SET,whatsapp,社交通讯",
    "RULE-SET,facebook,社交通讯",
    "RULE-SET,instagram,社交通讯",
    "RULE-SET,twitter,社交通讯",
    "RULE-SET,linkedin,社交通讯",
    "RULE-SET,reddit,社交通讯",
    "RULE-SET,wikipedia,选择节点",

    // -------- 内容与流媒体 --------
    "RULE-SET,youtube,YouTube",
    "RULE-SET,tiktok-mrs,TikTok",
    "RULE-SET,netflix-mrs,Netflix",
    "RULE-SET,hulu,选择节点",
    "RULE-SET,disney,选择节点",
    "RULE-SET,hbo,选择节点",
    "RULE-SET,amazon,选择节点",
    "RULE-SET,bahamut-mrs,Bahamut",
    "RULE-SET,biliintl-mrs,Bilibili",
    "GEOSITE,SPOTIFY,Spotify",
    "GEOSITE,BILIBILI,Bilibili",

    // -------- 教育、游戏与专项服务 --------
    "RULE-SET,coursera,选择节点",
    "RULE-SET,edx,选择节点",
    "RULE-SET,udemy,选择节点",
    "RULE-SET,khanacademy,选择节点",
    "RULE-SET,category-scholar-!cn,选择节点",
    "RULE-SET,steam,选择节点",
    "RULE-SET,epicgames,选择节点",
    "RULE-SET,ea,选择节点",
    "RULE-SET,ubisoft,选择节点",
    "RULE-SET,blizzard,选择节点",
    "RULE-SET,crypto,Crypto",
    "RULE-SET,speedtest,测速服务",

    // -------- 系统、云盘与生态服务 --------
    "RULE-SET,google-mrs,谷歌服务",
    "RULE-SET,microsoft-mrs,微软服务",
    "RULE-SET,onedrive-mrs,微软服务",
    "RULE-SET,apple-mrs,苹果服务",
    "RULE-SET,applemusic,苹果服务",
    "RULE-SET,icloud,苹果服务",
    "RULE-SET,apple,苹果服务",
    "RULE-SET,mail,邮件服务",
    "RULE-SET,cloudflare,静态资源",
    "RULE-SET,StaticResources,静态资源",
    "RULE-SET,CDNResources,静态资源",

    // -------- 金融与支付 --------
    "RULE-SET,paypal,选择节点",
    "RULE-SET,visa,选择节点",
    "RULE-SET,mastercard,选择节点",
    "RULE-SET,stripe,选择节点",
    "RULE-SET,wise,选择节点",

    // -------- 基础直连 / 代理兜底 --------
    "RULE-SET,applications,直连",
    "RULE-SET,private-mrs,直连",
    "RULE-SET,private,直连",
    "RULE-SET,geolocation-cn,直连",
    "RULE-SET,cn-mrs,直连",
    "RULE-SET,direct,直连",
    "RULE-SET,proxy,选择节点",
    "RULE-SET,gfw,选择节点",
    "RULE-SET,tld-not-cn,选择节点",
    "RULE-SET,geolocation-!cn,选择节点",
    "GEOSITE,GFW,选择节点",
    "GEOIP,NETFLIX,Netflix,no-resolve",
    "GEOIP,TELEGRAM,Telegram,no-resolve",
    "RULE-SET,cncidr,直连,no-resolve",
    "RULE-SET,lancidr,直连,no-resolve",
    "DST-PORT,22,SSH(22端口)",
    "MATCH,选择节点"
];

const snifferConfig = {
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

const dnsConfig = {
    "enable": true,
    "ipv6": ipv6Enabled,
    "prefer-h3": true,
    "enhanced-mode": "redir-host",
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
    ]
};

const dnsConfig2 = {
    // 提供使用 FakeIP 的 DNS 配置
    "enable": true,
    "ipv6": ipv6Enabled,
    "prefer-h3": true,
    "enhanced-mode": "fake-ip",
    "fake-ip-filter": [
        "geosite:private",
        "geosite:connectivity-check",
        "geosite:cn",
        "Mijia Cloud",
        "dig.io.mi.com",
        "localhost.ptlogin2.qq.com",
        "*.icloud.com",
        "*.stun.*.*",
        "*.stun.*.*.*"
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
    ]
};

const geoxURL = {
    "geoip": "https://cdn.jsdelivr.net/gh/Loyalsoldier/v2ray-rules-dat@release/geoip.dat",
    "geosite": "https://cdn.jsdelivr.net/gh/Loyalsoldier/v2ray-rules-dat@release/geosite.dat",
    "mmdb": "https://cdn.jsdelivr.net/gh/Loyalsoldier/geoip@release/Country.mmdb",
    "asn": "https://cdn.jsdelivr.net/gh/Loyalsoldier/geoip@release/GeoLite2-ASN.mmdb"
};

// 地区元数据
const countriesMeta = {
    "香港": {
        pattern: "(?i)香港|深港|沪港|港|\\bHK\\b|Hong ?Kong|🇭🇰",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Hong_Kong.png"
    },
    "澳门": {
        pattern: "(?i)澳门|\\bMO\\b|Macau|Macao|🇲🇴",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Macao.png"
    },
    "台湾": {
        pattern: "(?i)台北|台中|台南|台湾|新北|彰化|\\bTW\\b|Taiwan|🇹🇼",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Taiwan.png"
    },
    "新加坡": {
        pattern: "(?i)新加坡|狮城|\\bSG\\b|Singapore|🇸🇬",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Singapore.png"
    },
    "日本": {
        pattern: "(?i)日本|川日|东京|大阪|泉日|埼玉|沪日|深日|\\bJP\\b|Japan|🇯🇵",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Japan.png"
    },
    "韩国": {
        pattern: "(?i)\\bKR\\b|\\bKOR\\b|Korea|首尔|韩|韓|🇰🇷",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Korea.png"
    },
    "美国": {
        pattern: "(?i)美国|美|硅谷|洛杉矶|圣何塞|\\bUS\\b|\\bUSA\\b|United States|America|🇺🇸",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/United_States.png"
    },
    "加拿大": {
        pattern: "(?i)加拿大|多伦多|温哥华|\\bCA\\b|\\bCAN\\b|Canada|🇨🇦",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Canada.png"
    },
    "英国": {
        pattern: "(?i)英国|伦敦|曼城|\\bUK\\b|\\bGB\\b|United Kingdom|🇬🇧",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/United_Kingdom.png"
    },
    "澳大利亚": {
        pattern: "(?i)澳洲|澳大利亚|悉尼|墨尔本|\\bAU\\b|Australia|🇦🇺",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Australia.png"
    },
    "德国": {
        pattern: "(?i)德国|德|法兰克福|\\bDE\\b|\\bGER\\b|Germany|🇩🇪",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Germany.png"
    },
    "法国": {
        pattern: "(?i)法国|法|巴黎|\\bFR\\b|France|🇫🇷",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/France.png"
    },
    "俄罗斯": {
        pattern: "(?i)俄罗斯|俄|莫斯科|\\bRU\\b|\\bRUS\\b|Russia|🇷🇺",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Russia.png"
    },
    "泰国": {
        pattern: "(?i)泰国|泰|曼谷|\\bTH\\b|Thailand|🇹🇭",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Thailand.png"
    },
    "印度": {
        pattern: "(?i)印度|孟买|\\bIN\\b|\\bIND\\b|India|🇮🇳",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/India.png"
    },
    "马来西亚": {
        pattern: "(?i)马来西亚|马来|吉隆坡|\\bMY\\b|Malaysia|🇲🇾",
        icon: "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Malaysia.png"
    },
    "荷兰": {
        pattern: "(?i)荷兰|阿姆斯特丹|\\bNL\\b|Netherlands|🇳🇱",
        icon: "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/flags/nl.svg"
    },
    "瑞士": {
        pattern: "(?i)瑞士|苏黎世|\\bCH\\b|Switzerland|🇨🇭",
        icon: "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/flags/ch.svg"
    },
    "瑞典": {
        pattern: "(?i)瑞典|斯德哥尔摩|\\bSE\\b|Sweden|🇸🇪",
        icon: "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/flags/se.svg"
    },
    "挪威": {
        pattern: "(?i)挪威|奥斯陆|\\bNO\\b|Norway|🇳🇴",
        icon: "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/flags/no.svg"
    },
    "芬兰": {
        pattern: "(?i)芬兰|赫尔辛基|\\bFI\\b|Finland|🇫🇮",
        icon: "https://testingcf.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Finland.png"
    },
    "丹麦": {
        pattern: "(?i)丹麦|哥本哈根|\\bDK\\b|Denmark|🇩🇰",
        icon: "https://fastly.jsdelivr.net/gh/clash-verge-rev.github.io@main/docs/assets/icons/flags/dk.svg"
    },
    "意大利": {
        pattern: "(?i)意大利|米兰|罗马|\\bIT\\b|Italy|🇮🇹",
        icon: "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/flags/it.svg"
    },
    "西班牙": {
        pattern: "(?i)西班牙|马德里|\\bES\\b|\\bESP\\b|Spain|🇪🇸",
        icon: "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/flags/es.svg"
    },
    "奥地利": {
        pattern: "(?i)奥地利|维也纳|\\bAT\\b|Austria|🇦🇹",
        icon: "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/flags/at.svg"
    },
    "比利时": {
        pattern: "(?i)比利时|布鲁塞尔|\\bBE\\b|Belgium|🇧🇪",
        icon: "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/flags/be.svg"
    },
    "菲律宾": {
        pattern: "(?i)菲律宾|马尼拉|\\bPH\\b|Philippines|🇵🇭",
        icon: "https://testingcf.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Philippines.png"
    },
    "阿根廷": {
        pattern: "(?i)阿根廷|布宜诺斯|\\bAR\\b|Argentina|🇦🇷",
        icon: "https://testingcf.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Argentina.png"
    },
    "印度尼西亚": {
        pattern: "(?i)印尼|印度尼西亚|雅加达|\\bID\\b|Indonesia|🇮🇩",
        icon: "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/flags/id.svg"
    },
    "越南": {
        pattern: "(?i)越南|河内|胡志明|\\bVN\\b|Vietnam|🇻🇳",
        icon: "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/flags/vn.svg"
    },
    "巴西": {
        pattern: "(?i)巴西|圣保罗|里约|\\bBR\\b|Brazil|🇧🇷",
        icon: "https://testingcf.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Brazil.png"
    },
    // ---------- 以下为补增的常见缺失国家 ----------
    "罗马尼亚": {
        pattern: "(?i)罗马尼亚|布加勒斯特|\\bRO\\b|Romania|🇷🇴",
        icon: "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Romania.png"
    },
    "波兰": {
        pattern: "(?i)波兰|华沙|\\bPL\\b|Poland|🇵🇱",
        icon: "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Poland.png"
    },
    "土耳其": {
        pattern: "(?i)土耳其|伊斯坦布尔|\\bTR\\b|Turkey|🇹🇷",
        icon: "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Turkey.png"
    },
    "爱尔兰": {
        pattern: "(?i)爱尔兰|都柏林|\\bIE\\b|Ireland|🇮🇪",
        icon: "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Ireland.png"
    },
    "捷克": {
        pattern: "(?i)捷克|布拉格|\\bCZ\\b|Czech|🇨🇿",
        icon: "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Czech_Republic.png"
    },
    "新西兰": {
        pattern: "(?i)新西兰|奥克兰|\\bNZ\\b|New Zealand|🇳🇿",
        icon: "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/New_Zealand.png"
    },
    "南非": {
        pattern: "(?i)南非|开普敦|\\bZA\\b|South Africa|🇿🇦",
        icon: "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/South_Africa.png"
    },
    "墨西哥": {
        pattern: "(?i)墨西哥|墨西哥城|\\bMX\\b|Mexico|🇲🇽",
        icon: "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Mexico.png"
    },
    "以色列": {
        pattern: "(?i)以色列|特拉维夫|\\bIL\\b|Israel|🇮🇱",
        icon: "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Israel.png"
    },
    "葡萄牙": {
        pattern: "(?i)葡萄牙|里斯本|\\bPT\\b|Portugal|🇵🇹",
        icon: "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Portugal.png"
    },
    // 区域标签放在具体国家之后，避免节点同时带国家与区域时被宽泛规则提前命中。
    "欧洲": {
        pattern: "(?i)欧洲|欧盟|\\bEU\\b|Europe|🇪🇺",
        icon: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f1ea-1f1fa.svg"
    },
    "联合国": {
        pattern: "(?i)联合国|\\bUN\\b|United Nations|🇺🇳",
        icon: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f1fa-1f1f3.svg"
    }
};

// 国旗 emoji 映射表：键需与 countriesMeta 的地区名保持一致
// 用于在节点名前自动补充国旗图标（如 "US 洛杉矶" -> "🇺🇸 US 洛杉矶"）
const countryFlags = {
    "香港": "🇭🇰",
    "澳门": "🇲🇴",
    "台湾": "🇹🇼",
    "新加坡": "🇸🇬",
    "日本": "🇯🇵",
    "韩国": "🇰🇷",
    "美国": "🇺🇸",
    "加拿大": "🇨🇦",
    "英国": "🇬🇧",
    "澳大利亚": "🇦🇺",
    "德国": "🇩🇪",
    "法国": "🇫🇷",
    "俄罗斯": "🇷🇺",
    "泰国": "🇹🇭",
    "印度": "🇮🇳",
    "马来西亚": "🇲🇾",
    "荷兰": "🇳🇱",
    "瑞士": "🇨🇭",
    "瑞典": "🇸🇪",
    "挪威": "🇳🇴",
    "芬兰": "🇫🇮",
    "丹麦": "🇩🇰",
    "意大利": "🇮🇹",
    "西班牙": "🇪🇸",
    "奥地利": "🇦🇹",
    "比利时": "🇧🇪",
    "菲律宾": "🇵🇭",
    "阿根廷": "🇦🇷",
    "印度尼西亚": "🇮🇩",
    "越南": "🇻🇳",
    "巴西": "🇧🇷",
    "罗马尼亚": "🇷🇴",
    "波兰": "🇵🇱",
    "土耳其": "🇹🇷",
    "爱尔兰": "🇮🇪",
    "捷克": "🇨🇿",
    "新西兰": "🇳🇿",
    "南非": "🇿🇦",
    "墨西哥": "🇲🇽",
    "以色列": "🇮🇱",
    "葡萄牙": "🇵🇹",
    "欧洲": "🇪🇺",
    "联合国": "🇺🇳"
};

// ISP / 家宽 / 落地类节点的关键字。加旗与地区统计、地区分组共用，保证口径一致。
const landingKeywordSource = "家宽|家庭|家庭宽带|商宽|商业宽带|星链|Starlink|落地";
const landingFilter = `(?i)${landingKeywordSource}`;

// 低倍率 / 高倍率的文本关键字与倍率值规则。
// 社区里常见写法并不统一，通常会出现 0.5x / x0.5 / 2X / X20 / 0.5倍率 / 倍率2 这几类。
const lowCostKeywordSource = "低倍率|省流|大流量|实验性";
const highCostKeywordSource = "高倍率|高速|旗舰|专线|VIP|Premium";
const multiplierNumberSource = "\\d+(?:\\.\\d+)?";
const lowMultiplierValueSource = "0(?:\\.\\d+)?";
const highMultiplierValueSource = "(?:1\\.(?:0*[1-9]\\d*)|(?:[2-9]\\d*|1\\d+)(?:\\.\\d+)?)";

/**
 * 构建倍率匹配片段
 * @param {string} valueSource 倍率数值对应的正则片段
 * @returns {string} 可复用的倍率匹配规则
 */
function buildMultiplierSource(valueSource) {
    return [
        `(?:^|[^\\dA-Za-z])(?:[x×]\\s*${valueSource})(?:$|[^\\dA-Za-z])`,
        `(?:^|[^\\dA-Za-z])(?:${valueSource}\\s*[x×])(?:$|[^\\dA-Za-z])`,
        `倍率\\s*[:：]?\\s*${valueSource}`,
        `(?:^|[^\\dA-Za-z])(?:${valueSource}\\s*倍率)(?:$|[^\\dA-Za-z])`
    ].join("|");
}

const lowMultiplierSource = buildMultiplierSource(lowMultiplierValueSource);
const highMultiplierSource = buildMultiplierSource(highMultiplierValueSource);
const lowCostMatchSource = `${lowMultiplierSource}|${lowCostKeywordSource}`;
const highCostMatchSource = `${highMultiplierSource}|${highCostKeywordSource}`;

// ISP / 家宽 / 落地类节点的排除正则。加旗与地区统计共用，保证两处口径一致：
// 这类节点会进入"落地节点"等专用组，不应被当作普通地区节点加旗或计入地区数量。
const ispRegex = new RegExp(landingKeywordSource, "i");
const lowCostRegex = new RegExp(lowCostMatchSource, "i");
const highCostRegex = new RegExp(highCostMatchSource, "i");
const lowCostExcludeFilter = `(?i)${lowCostMatchSource}`;
const highCostIncludeFilter = `(?i)${highCostMatchSource}`;

// 未命中国家/地区规则的普通节点统一进入兜底组，避免只因命名不规范而缺少分组入口。
const unclassifiedCountryName = "其他";
const unclassifiedCountryIcon = "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Proxy.png";

/**
 * 移除地区规则中的内联忽略大小写标记，方便 JS RegExp 与 Clash 过滤规则复用。
 * @param {string} pattern 地区匹配规则
 * @returns {string} 去除内联标记后的匹配规则
 */
function normalizeCountryPattern(pattern) {
    return pattern.replace(/^\(\?i\)/, '');
}

// 合并全部地区规则，用作"其他节点"的反向排除条件，避免已归类节点重复进入兜底组。
const countryMatchSource = Object.values(countriesMeta)
    .map(meta => normalizeCountryPattern(meta.pattern))
    .join("|");
const unclassifiedNodeExcludeFilter = `(?i)${countryMatchSource}|${landingKeywordSource}|${lowCostMatchSource}`;

// 预编译地区匹配正则（去掉 (?i) 前缀，统一加 'i' 标志），供国旗匹配与地区统计复用
const flagCompiledRegex = Object.entries(countriesMeta).map(([country, meta]) => ({
    country,
    flag: countryFlags[country],
    regex: new RegExp(normalizeCountryPattern(meta.pattern), 'i')
}));

// 匹配任意国旗 emoji 的正则（用于判断节点名是否已带国旗，避免重复添加）
const existingFlagRegex = /[\u{1F1E6}-\u{1F1FF}]{2}/u;

/**
 * 从节点名中提取倍率数值
 * @param {string} name 节点名称
 * @returns {number|null} 提取出的倍率；未识别时返回 null
 */
function extractMultiplier(name) {
    if (!name) return null;

    const patterns = [
        new RegExp(`(?:^|[^\\dA-Za-z])[x×]\\s*(${multiplierNumberSource})(?:$|[^\\dA-Za-z])`, "i"),
        new RegExp(`(?:^|[^\\dA-Za-z])(${multiplierNumberSource})\\s*[x×](?:$|[^\\dA-Za-z])`, "i"),
        new RegExp(`倍率\\s*[:：]?\\s*(${multiplierNumberSource})`, "i"),
        new RegExp(`(?:^|[^\\dA-Za-z])(${multiplierNumberSource})\\s*倍率(?:$|[^\\dA-Za-z])`, "i")
    ];

    for (const pattern of patterns) {
        const match = name.match(pattern);
        if (match) {
            const value = Number(match[1]);
            if (!Number.isNaN(value)) return value;
        }
    }

    return null;
}

/**
 * 为节点名补充国旗图标
 * @param {string} name 原始节点名
 * @returns {string} 处理后的节点名；未匹配到地区或已含国旗时原样返回
 *
 * 注意：ISP/家宽/落地节点地理上仍属于某国，也会被加旗。
 *      ispRegex 仅在 parseCountries 中用于排除"拉入统计"（避免它们撑大地区节点数），
 *      但不影响加旗。两者口径不一致是设计意图，不是 bug。
 */
function addFlagToName(name) {
    if (!name) return name;
    // 已包含国旗 emoji，直接跳过，避免出现两个旗帜
    if (existingFlagRegex.test(name)) return name;
    // 按 countriesMeta 顺序匹配，命中第一个地区即添加对应国旗
    for (const {flag, regex} of flagCompiledRegex) {
        if (flag && regex.test(name)) {
            return `${flag} ${name}`;
        }
    }
    return name;
}

// 健康检查配置模板
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

// 自动测速/负载均衡组的统一节点过滤正则。
// 仅排除明确的"信息类/非代理"节点；流量/剩余/套餐只在名称开头时排除，避免误伤真实线路名。
// 三个自动组共用同一规则，保证行为一致（DRY）。
const nonProxyKeywordSource = "DIRECTLY|DIRECT|过期|到期|官网|测速|订阅|重置|网址|失效|Expire|Expired|Invalid";
const leadingTrafficInfoSource = "^\\s*(?:剩余|套餐|流量|Traffic|Remaining)";
const autoTestFilter = `^((?!(${nonProxyKeywordSource}|${leadingTrafficInfoSource})).)*$`;
const autoTestRegex = new RegExp(autoTestFilter, "i");

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
    // 先按显式倍率数值判断；未标倍率时再回退到关键字匹配。
    const proxies = config["proxies"] || [];
    for (const proxy of proxies) {
        const name = proxy.name || "";
        const multiplier = extractMultiplier(name);
        if (multiplier !== null) {
            if (multiplier < 1) return true;
            continue;
        }
        if (lowCostRegex.test(name)) return true;
    }
    return false;
}

function hasHighCost(config) {
    // 标准倍率 1x 不计入高倍率，仅识别大于 1 的倍率与高成本关键字。
    const proxies = config["proxies"] || [];
    for (const proxy of proxies) {
        const name = proxy.name || "";
        const multiplier = extractMultiplier(name);
        if (multiplier !== null) {
            if (multiplier > 1) return true;
            continue;
        }
        if (highCostRegex.test(name)) return true;
    }
    return false;
}

function parseCountries(config) {
    const proxies = config.proxies || [];

    // 用来累计各国节点数
    const countryCounts = Object.create(null);
    let unclassifiedCount = 0;

    // 逐个节点进行匹配与统计
    for (const proxy of proxies) {
        const name = proxy.name || '';
        if (!name) continue;

        // 过滤掉不想统计的 ISP 节点
        if (ispRegex.test(name)) continue;

        // 找到第一个匹配到的地区就计数并终止本轮
        let matchedCountry = false;
        for (const {country, regex} of flagCompiledRegex) {
            if (regex.test(name)) {
                countryCounts[country] = (countryCounts[country] || 0) + 1;
                matchedCountry = true;
                break;    // 避免一个节点同时累计到多个地区
            }
        }

        // 未命中国家/地区且属于普通代理节点时，计入"其他节点"兜底组。
        if (!matchedCountry && autoTestRegex.test(name) && !lowCostRegex.test(name)) {
            unclassifiedCount++;
        }
    }

    // 将结果对象转成数组形式
    const result = [];
    for (const [country, count] of Object.entries(countryCounts)) {
        result.push({country, count});
    }
    if (unclassifiedCount > 0) {
        result.push({country: unclassifiedCountryName, count: unclassifiedCount});
    }

    return result;   // [{ country: 'Japan', count: 12 }, ...]
}


function buildCountryProxyGroups(countryList) {
    // 获取实际存在的地区列表
    const countryProxyGroups = [];

    // 为实际存在的地区创建节点组
    for (const country of countryList) {
        if (country === unclassifiedCountryName) {
            const groupConfig = {
                "name": `${unclassifiedCountryName}节点`,
                "icon": unclassifiedCountryIcon,
                "include-all": true,
                "filter": autoTestFilter,
                "exclude-filter": unclassifiedNodeExcludeFilter,
                "type": (loadBalance) ? "load-balance" : "url-test",
                // 兜底组只承接未命中国家/地区规则的普通节点，不与地区、落地、低倍率组重复。
                "url": "https://cp.cloudflare.com/generate_204",
                "interval": 60,
                "tolerance": 20,
                "lazy": false,
                "health-check": healthCheckTemplates.fast
            };

            countryProxyGroups.push(groupConfig);
            continue;
        }

        // 确保地区名称在预设的地区配置中存在
        if (countriesMeta[country]) {
            const groupName = `${country}节点`;
            const pattern = countriesMeta[country].pattern;

            const groupConfig = {
                "name": groupName,
                "icon": countriesMeta[country].icon,
                "include-all": true,
                "filter": pattern,
                "exclude-filter": landing ? `${landingFilter}|${lowCostMatchSource}` : lowCostExcludeFilter,
                "type": (loadBalance) ? "load-balance" : "url-test",
                // 健康检查对 load-balance 与 url-test 都是必需的：load-balance 依赖它分配流量，
                // 缺失时混合订阅（节点数多）易触发组内节点不可用/丢失。此处两种类型统一补齐。
                "url": "https://cp.cloudflare.com/generate_204",
                "interval": 60,
                "tolerance": 20,
                "lazy": false,
                "health-check": healthCheckTemplates.fast
            };

            countryProxyGroups.push(groupConfig);
        }
    }

    return countryProxyGroups;
}

function buildProxyGroups({
                              countryList,
                              countryProxyGroups,
                              highCost,
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


    // 过滤掉 null 值
    return [
        {
            "name": "延迟自动",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Auto.png",
            "type": "url-test",
            "include-all": true,
            "filter": autoTestFilter,
            "url": "https://cp.cloudflare.com/generate_204",
            "interval": 300,
            "tolerance": 50,
            "lazy": false,
            "health-check": healthCheckTemplates.fast
        },
        {
            "name": "选择节点",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Proxy.png",
            "type": "select",
            "proxies": defaultSelector,
            "health-check": healthCheckTemplates.standard
        },
        {
            "name": "手动选择",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Available.png",
            "include-all": true,
            "type": "select"
        },
        (landing) ? {
            "name": "前置代理",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Area.png",
            "type": "select",
            "include-all": true,
            "exclude-filter": landingFilter,
            "proxies": frontProxySelector
        } : null,
        (landing) ? {
            "name": "落地节点",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Airport.png",
            "type": "select",
            "include-all": true,
            "filter": landingFilter,
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
        // 负载均衡组
        {
            ...groupBaseOption,
            "name": "负载均衡(散列)", // 适合：流媒体、游戏、需要会话保持的服务
            "type": "load-balance",
            "strategy": "consistent-hashing", // 相同域名总是使用相同节点
            "include-all": true,
            "filter": autoTestFilter,
            "health-check": healthCheckTemplates.standard,
            "icon": "https://testingcf.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Round_Robin_1.png"
        },
        {
            ...groupBaseOption,
            "name": "负载均衡(轮询)", // 适合：下载、浏览、API调用
            "type": "load-balance",
            "strategy": "round-robin", // 请求轮流分配到不同节点
            "include-all": true,
            "filter": autoTestFilter,
            "health-check": healthCheckTemplates.standard,
            "icon": "https://testingcf.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Round_Robin.png"
        },
        // -------- 通用服务分组 --------
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
            "name": "开发服务",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Proxy.png",
            "type": "select",
            "proxies": defaultProxies
        },
        {
            "name": "社交通讯",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Telegram.png",
            "type": "select",
            "proxies": defaultProxies
        },
        {
            "name": "邮件服务",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Available.png",
            "type": "select",
            "proxies": defaultProxies
        },
        {
            "name": "测速服务",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Auto.png",
            "type": "select",
            "proxies": defaultProxiesDirect
        },

        // -------- 通讯与媒体分组 --------
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
            "proxies": ["直连", ...defaultProxies]
        },
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
        (highCost) ? {
            "name": "高倍率节点",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Rocket.png",
            "type": "url-test",
            "url": "https://cp.cloudflare.com/generate_204",
            "include-all": true,
            "filter": highCostIncludeFilter,
            "health-check": healthCheckTemplates.standard
        } : null,
        (lowCost) ? {
            "name": "低倍率节点",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Lab.png",
            "type": "url-test",
            "url": "https://cp.cloudflare.com/generate_204",
            "include-all": true,
            "filter": lowCostExcludeFilter,
            "health-check": healthCheckTemplates.standard
        } : null,
        ...countryProxyGroups
    ].filter(Boolean);
}

function main(config) {
    // 先为每个节点补充国旗图标，再做去重。
    // 顺序很关键：基于"加旗后的名字"去重，确保最终节点名与各代理组的引用一致，
    // 避免 SubStore 混合订阅时因命名变动导致组引用断裂、节点丢失。
    const seenNames = new Map();
    const deduplicatedProxies = (config.proxies || []).map(proxy => {
        const flaggedName = addFlagToName(proxy.name);
        let newName = flaggedName;
        if (seenNames.has(flaggedName)) {
            const count = seenNames.get(flaggedName) + 1;
            seenNames.set(flaggedName, count);
            // 用 " 2" 数字后缀替代 " | #2"：去掉 | 与 # 特殊字符，
            // 规避部分内核版本对含特殊字符节点名的解析异常。
            newName = `${flaggedName} ${count + 1}`;
        } else {
            seenNames.set(flaggedName, 0);
        }
        return {...proxy, name: newName};
    });

    config = {...config, proxies: deduplicatedProxies};
    // 解析地区与高/低倍率信息
    const countryInfo = parseCountries(config); // [{ country, count }]
    const lowCost = hasLowCost(config);
    const highCost = hasHighCost(config);

    // 构建基础数组
    const {
        defaultProxies,
        defaultProxiesDirect,
        defaultSelector,
        defaultFallback,
        countryGroupNames: targetCountryList
    } = buildBaseLists({landing, highCost, lowCost, countryInfo});

    // 为地区构建对应的 url-test / load-balance 组
    const countryProxyGroups = buildCountryProxyGroups(targetCountryList.map(n => n.replace(/节点$/, '')));

    // 生成代理组
    const proxyGroups = buildProxyGroups({
        countryList: targetCountryList.map(n => n.replace(/节点$/, '')),
        countryProxyGroups,
        highCost,
        lowCost,
        defaultProxies,
        defaultProxiesDirect,
        defaultSelector,
        defaultFallback
    });
    const globalProxies = proxyGroups.map(item => item.name);

    proxyGroups.push(
        {
            "name": "GLOBAL",
            "icon": "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Global.png",
            "include-all": true,
            "type": "select",
            "proxies": globalProxies
        }
    );

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
        }
    });

    Object.assign(config, {
        "proxy-groups": proxyGroups,
        "rule-providers": ruleProviders,
        "rules": rules,
        "sniffer": snifferConfig,
        "dns": fakeIPEnabled ? dnsConfig2 : dnsConfig,
        "geodata-mode": true,
        "geox-url": geoxURL,
    });

    return config;
}
