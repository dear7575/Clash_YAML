/**
 * Clash 覆写 JS 脚本（修订版）
 * 原作者：powerfullz  /  自用版：dear7575
 *
 * ===== 使用 IPRoyal ISP 代理 =====
 * 只需要填下面 ispProxy 的 server / port / username / password。
 * server 留空 = 不注入。填好后脚本会：
 *   1. 把它作为 socks5 节点加入配置（ISP_CHAIN=true 时再经「前置代理」组链式连接）
 *   2. 自动开启落地功能（生成「落地节点」「前置代理」组）
 *   3. Claude / ChatGPT 组默认选中这个节点（REJECT 排第二，作为保险）
 * 注意：不要把填了账号密码的脚本上传到公开仓库。
 *
 * 传入参数（Sub-Store 用 #loadbalance=true&landing=true 传；Clash Party 等不支持传参，直接改下面的默认值）：
 * - loadbalance: 地区组用负载均衡（默认 false）
 * - landing:     启用落地节点功能（默认 false；注入了 ISP 节点时自动开启）
 * - ipv6:        启用 IPv6（默认 false）
 * - full:        输出完整基础配置，用于纯内核启动（默认 false）
 * - keepalive:   启用 tcp-keep-alive（默认 true）
 * - fakeip:      DNS 使用 FakeIP（默认 true；false 则用 redir-host）
 */

// ===================== ISP 节点配置（只改这里） =====================
const FRONT_GROUP = "前置代理";
// false = Clash 直连 ISP 代理（本机直连能通时用，和指纹浏览器一样）
// true  = 先走「前置代理」组再连 ISP（本机直连不通 / 需要隐藏本机 IP 时用）
const ISP_CHAIN = false;
const ispProxy = {
    // 名字必须含 落地|家宽|家庭|商宽|商业宽带|星链|Starlink 之一，否则不会被识别为落地节点
    name: "🇺🇸 美国ISP-落地",
    type: "socks5",
    server: "",          // IPRoyal 给你的 IP，留空则不注入
    port: 12324,         // 以 IPRoyal 后台显示的 SOCKS5 端口为准
    username: "",
    password: ""
};

// ===================== 参数解析 =====================
const inArg = typeof $arguments !== 'undefined' ? $arguments : {};

function parseBool(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value.toLowerCase() === "true" || value === "1";
    return false;
}

// 传入则按传入值解析，未传入用默认值（修复原 `parseBool(x) || true` 无法关闭的问题）
function getBoolArg(value, defaultValue) {
    if (value === undefined || value === null || value === "") return defaultValue;
    return parseBool(value);
}

const loadBalance = getBoolArg(inArg.loadbalance, false),
    landing = getBoolArg(inArg.landing, false),
    ipv6Enabled = getBoolArg(inArg.ipv6, false),
    fullConfig = getBoolArg(inArg.full, false),
    keepAliveEnabled = getBoolArg(inArg.keepalive, true),
    fakeIPEnabled = getBoolArg(inArg.fakeip, true);

// ===================== 关键字 / 过滤规则 =====================
// ISP / 家宽 / 落地类节点关键字
const landingKeywordSource = "家宽|家庭|家庭宽带|商宽|商业宽带|星链|Starlink|落地";
const landingFilter = `(?i)${landingKeywordSource}`;
const ispRegex = new RegExp(landingKeywordSource, "i");

// 低倍率 / 高倍率
const lowCostKeywordSource = "低倍率|省流|大流量|实验性";
const highCostKeywordSource = "高倍率|高速|旗舰|专线|VIP|Premium";
const multiplierNumberSource = "\\d+(?:\\.\\d+)?";
const lowMultiplierValueSource = "0(?:\\.\\d+)?";
const highMultiplierValueSource = "(?:1\\.(?:0*[1-9]\\d*)|(?:[2-9]\\d*|1\\d+)(?:\\.\\d+)?)";

function buildMultiplierSource(valueSource) {
    return [
        `(?:^|[^\\dA-Za-z])(?:[x×]\\s*${valueSource})(?:$|[^\\dA-Za-z])`,
        `(?:^|[^\\dA-Za-z])(?:${valueSource}\\s*[x×])(?:$|[^\\dA-Za-z])`,
        `倍率\\s*[:：]?\\s*${valueSource}`,
        `(?:^|[^\\dA-Za-z])(?:${valueSource}\\s*倍率)(?:$|[^\\dA-Za-z])`
    ].join("|");
}

const lowCostMatchSource = `${buildMultiplierSource(lowMultiplierValueSource)}|${lowCostKeywordSource}`;
const highCostMatchSource = `${buildMultiplierSource(highMultiplierValueSource)}|${highCostKeywordSource}`;
const lowCostRegex = new RegExp(lowCostMatchSource, "i");
const highCostRegex = new RegExp(highCostMatchSource, "i");
const lowCostExcludeFilter = `(?i)${lowCostMatchSource}`;
const highCostIncludeFilter = `(?i)${highCostMatchSource}`;

// 非代理的信息类节点（到期、流量、官网等）
const nonProxyKeywordSource = "DIRECTLY|DIRECT|过期|到期|官网|测速|订阅|重置|网址|失效|Expire|Expired|Invalid";
const leadingTrafficInfoSource = "^\\s*(?:剩余|套餐|流量|Traffic|Remaining)";
const autoTestFilter = `^((?!(${nonProxyKeywordSource}|${leadingTrafficInfoSource})).)*$`;
const autoTestRegex = new RegExp(autoTestFilter, "i");

// ===================== 地区元数据 =====================
const K = "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/";
const KT = "https://testingcf.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/";
const KR = "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/";
const V = "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/flags/";
const TW = "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/";

const region = (flag, pattern, icon) => ({flag, pattern, icon});

// 顺序即匹配优先级：更具体的放前面（如印度尼西亚必须在印度之前，否则「印度尼西亚」会被判成印度）
const countriesMeta = {
    "香港": region("🇭🇰", "(?i)香港|深港|沪港|港|\\bHK\\b|Hong ?Kong|🇭🇰", K + "Hong_Kong.png"),
    "澳门": region("🇲🇴", "(?i)澳门|\\bMO\\b|Macau|Macao|🇲🇴", K + "Macao.png"),
    "台湾": region("🇹🇼", "(?i)台北|台中|台南|台湾|新北|彰化|\\bTW\\b|Taiwan|🇹🇼", K + "Taiwan.png"),
    "新加坡": region("🇸🇬", "(?i)新加坡|狮城|\\bSG\\b|Singapore|🇸🇬", K + "Singapore.png"),
    "日本": region("🇯🇵", "(?i)日本|川日|东京|大阪|泉日|埼玉|沪日|深日|\\bJP\\b|Japan|🇯🇵", K + "Japan.png"),
    "韩国": region("🇰🇷", "(?i)\\bKR\\b|\\bKOR\\b|Korea|首尔|韩|韓|🇰🇷", K + "Korea.png"),
    "美国": region("🇺🇸", "(?i)美国|美|硅谷|洛杉矶|圣何塞|\\bUS\\b|\\bUSA\\b|United States|America|🇺🇸", K + "United_States.png"),
    "加拿大": region("🇨🇦", "(?i)加拿大|多伦多|温哥华|\\bCA\\b|\\bCAN\\b|Canada|🇨🇦", K + "Canada.png"),
    "英国": region("🇬🇧", "(?i)英国|伦敦|曼城|\\bUK\\b|\\bGB\\b|United Kingdom|🇬🇧", K + "United_Kingdom.png"),
    "澳大利亚": region("🇦🇺", "(?i)澳洲|澳大利亚|悉尼|墨尔本|\\bAU\\b|Australia|🇦🇺", K + "Australia.png"),
    "德国": region("🇩🇪", "(?i)德国|德|法兰克福|\\bDE\\b|\\bGER\\b|Germany|🇩🇪", K + "Germany.png"),
    "法国": region("🇫🇷", "(?i)法国|法|巴黎|\\bFR\\b|France|🇫🇷", K + "France.png"),
    "俄罗斯": region("🇷🇺", "(?i)俄罗斯|俄|莫斯科|\\bRU\\b|\\bRUS\\b|Russia|🇷🇺", K + "Russia.png"),
    "泰国": region("🇹🇭", "(?i)泰国|泰|曼谷|\\bTH\\b|Thailand|🇹🇭", K + "Thailand.png"),
    "印度尼西亚": region("🇮🇩", "(?i)印尼|印度尼西亚|雅加达|\\bID\\b|Indonesia|🇮🇩", V + "id.svg"),
    "印度": region("🇮🇳", "(?i)印度|孟买|\\bIN\\b|\\bIND\\b|India|🇮🇳", K + "India.png"),
    "马来西亚": region("🇲🇾", "(?i)马来西亚|马来|吉隆坡|\\bMY\\b|Malaysia|🇲🇾", K + "Malaysia.png"),
    "荷兰": region("🇳🇱", "(?i)荷兰|阿姆斯特丹|\\bNL\\b|Netherlands|🇳🇱", V + "nl.svg"),
    "瑞士": region("🇨🇭", "(?i)瑞士|苏黎世|\\bCH\\b|Switzerland|🇨🇭", V + "ch.svg"),
    "瑞典": region("🇸🇪", "(?i)瑞典|斯德哥尔摩|\\bSE\\b|Sweden|🇸🇪", V + "se.svg"),
    "挪威": region("🇳🇴", "(?i)挪威|奥斯陆|\\bNO\\b|Norway|🇳🇴", V + "no.svg"),
    "芬兰": region("🇫🇮", "(?i)芬兰|赫尔辛基|\\bFI\\b|Finland|🇫🇮", KT + "Finland.png"),
    "丹麦": region("🇩🇰", "(?i)丹麦|哥本哈根|\\bDK\\b|Denmark|🇩🇰", V + "dk.svg"),   // 修复：原图标 URL 缺 clash-verge-rev/ 路径
    "意大利": region("🇮🇹", "(?i)意大利|米兰|罗马|\\bIT\\b|Italy|🇮🇹", V + "it.svg"),
    "西班牙": region("🇪🇸", "(?i)西班牙|马德里|\\bES\\b|\\bESP\\b|Spain|🇪🇸", V + "es.svg"),
    "奥地利": region("🇦🇹", "(?i)奥地利|维也纳|\\bAT\\b|Austria|🇦🇹", V + "at.svg"),
    "比利时": region("🇧🇪", "(?i)比利时|布鲁塞尔|\\bBE\\b|Belgium|🇧🇪", V + "be.svg"),
    "菲律宾": region("🇵🇭", "(?i)菲律宾|马尼拉|\\bPH\\b|Philippines|🇵🇭", KT + "Philippines.png"),
    "阿根廷": region("🇦🇷", "(?i)阿根廷|布宜诺斯|\\bAR\\b|Argentina|🇦🇷", KT + "Argentina.png"),
    "越南": region("🇻🇳", "(?i)越南|河内|胡志明|\\bVN\\b|Vietnam|🇻🇳", V + "vn.svg"),
    "巴西": region("🇧🇷", "(?i)巴西|圣保罗|里约|\\bBR\\b|Brazil|🇧🇷", KT + "Brazil.png"),
    "罗马尼亚": region("🇷🇴", "(?i)罗马尼亚|布加勒斯特|\\bRO\\b|Romania|🇷🇴", KR + "Romania.png"),
    "波兰": region("🇵🇱", "(?i)波兰|华沙|\\bPL\\b|Poland|🇵🇱", KR + "Poland.png"),
    "土耳其": region("🇹🇷", "(?i)土耳其|伊斯坦布尔|\\bTR\\b|Turkey|🇹🇷", KR + "Turkey.png"),
    "爱尔兰": region("🇮🇪", "(?i)爱尔兰|都柏林|\\bIE\\b|Ireland|🇮🇪", KR + "Ireland.png"),
    "捷克": region("🇨🇿", "(?i)捷克|布拉格|\\bCZ\\b|Czech|🇨🇿", KR + "Czech_Republic.png"),
    "新西兰": region("🇳🇿", "(?i)新西兰|奥克兰|\\bNZ\\b|New Zealand|🇳🇿", KR + "New_Zealand.png"),
    "南非": region("🇿🇦", "(?i)南非|开普敦|\\bZA\\b|South Africa|🇿🇦", KR + "South_Africa.png"),
    "墨西哥": region("🇲🇽", "(?i)墨西哥|墨西哥城|\\bMX\\b|Mexico|🇲🇽", KR + "Mexico.png"),
    "以色列": region("🇮🇱", "(?i)以色列|特拉维夫|\\bIL\\b|Israel|🇮🇱", KR + "Israel.png"),
    "葡萄牙": region("🇵🇹", "(?i)葡萄牙|里斯本|\\bPT\\b|Portugal|🇵🇹", KR + "Portugal.png"),
    // 区域标签放最后，避免带国家的节点被宽泛规则提前命中
    "欧洲": region("🇪🇺", "(?i)欧洲|欧盟|\\bEU\\b|Europe|🇪🇺", TW + "1f1ea-1f1fa.svg"),
    "联合国": region("🇺🇳", "(?i)联合国|\\bUN\\b|United Nations|🇺🇳", TW + "1f1fa-1f1f3.svg")
};

const unclassifiedCountryName = "其他";
const unclassifiedCountryIcon = K + "Nfcloud.png";

function normalizeCountryPattern(pattern) {
    return pattern.replace(/^\(\?i\)/, '');
}

const countryOrder = Object.keys(countriesMeta);
const countryMatchSource = Object.values(countriesMeta).map(m => normalizeCountryPattern(m.pattern)).join("|");
const unclassifiedNodeExcludeFilter = `(?i)${countryMatchSource}|${landingKeywordSource}|${lowCostMatchSource}`;

const flagCompiledRegex = Object.entries(countriesMeta).map(([country, meta]) => ({
    country,
    flag: meta.flag,
    regex: new RegExp(normalizeCountryPattern(meta.pattern), 'i')
}));
const existingFlagRegex = /[\u{1F1E6}-\u{1F1FF}]{2}/u;

// ===================== 规则集 =====================
const GEO = "https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo";
const LOYAL = "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release";
const B7 = "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash";

// MetaCubeX mrs：key 为 provider 名，name 为 geosite/geoip 文件名
const geosite = (key, name = key) => ({
    type: "http", format: "mrs", behavior: "domain", interval: 86400,
    url: `${GEO}/geosite/${name}.mrs`, path: `./ruleset/${key}.mrs`
});
const geoip = (key, name = key) => ({
    type: "http", format: "mrs", behavior: "ipcidr", interval: 86400,
    url: `${GEO}/geoip/${name}.mrs`, path: `./ruleset/${key}.mrs`
});
const loyal = (key, behavior = "domain") => ({
    type: "http", behavior, format: "yaml", interval: 86400,
    url: `${LOYAL}/${key}.txt`, path: `./ruleset/${key}.yaml`
});
const b7 = (key, dir) => ({
    type: "http", behavior: "classical", format: "yaml", interval: 86400,
    url: `${B7}/${dir}/${dir}.yaml`, path: `./ruleset/${key}.yaml`
});
const inline = payload => ({type: "inline", behavior: "domain", payload});

const ruleProviders = {
    "overseas-ai-extra": inline([
        "+.lovable.dev", "+.bolt.new", "+.v0.app", "+.v0.dev", "+.replit.com", "+.augmentcode.com",
        "+.ampcode.com", "+.kilo.ai", "+.kilocode.ai", "+.aider.chat",
        "+.character.ai", "+.pi.ai", "+.you.com", "+.genspark.ai",
        "+.runwayml.com", "+.ideogram.ai", "+.leonardo.ai", "+.lumalabs.ai", "+.pika.art", "+.suno.com",
        "+.udio.com", "+.krea.ai", "+.heygen.com", "+.synthesia.io", "+.gamma.app",
        "firefly.adobe.com", "firefly-api.adobe.io",
        "+.together.ai", "api.together.xyz", "+.fireworks.ai", "+.replicate.com", "+.replicate.delivery",
        "+.fal.ai", "+.fal.run", "+.fal.media", "+.stability.ai"
    ]),
    "github-domains": inline([
        "+.github.com", "+.githubusercontent.com", "+.githubassets.com", "+.github.io", "+.github.dev", "+.ghcr.io"
    ]),
    "ibkr-domains": inline([
        "+.interactivebrokers.com", "+.ibkr.com", "+.ibkr.co.uk", "+.interactivebrokers.com.hk",
        "+.interactivebrokers.com.sg", "+.interactivebrokers.co.uk", "+.interactivebrokers.ie",
        "+.interactivebrokers.ca", "+.interactivebrokers.com.au", "+.interactivebrokers.co.jp",
        "+.interactivebrokers.co.in", "+.ibllc.com", "+.ibllc.com.cn"
    ]),
    "schwab-domains": inline(["+.schwab.com", "+.thinkorswim.com"]),

    // MetaCubeX geosite
    "bahamut-mrs": geosite("bahamut-mrs", "bahamut"),
    "tiktok-mrs": geosite("tiktok-mrs", "tiktok"),
    "netflix-mrs": geosite("netflix-mrs", "netflix"),
    "gitlab": geosite("gitlab"),
    "aws": geosite("aws"),
    "azure": geosite("azure"),
    "digitalocean": geosite("digitalocean"),
    "heroku": geosite("heroku"),
    "dropbox": geosite("dropbox"),
    "category-dev": geosite("category-dev"),
    "category-ads-all": geosite("category-ads-all"),
    "category-ai-chat-!cn": geosite("category-ai-chat-!cn"),
    "youtube": geosite("youtube"),
    "google-mrs": geosite("google-mrs", "google"),
    "telegram-mrs": geosite("telegram-mrs", "telegram"),
    "microsoft-mrs": geosite("microsoft-mrs", "microsoft"),
    "apple-mrs": geosite("apple-mrs", "apple"),
    "facebook": geosite("facebook"),
    "instagram": geosite("instagram"),
    "twitter": geosite("twitter"),
    "linkedin": geosite("linkedin"),
    "hulu": geosite("hulu"),
    "disney": geosite("disney"),
    "hbo": geosite("hbo"),
    "amazon": geosite("amazon"),
    "steam": geosite("steam"),
    "epicgames": geosite("epicgames"),
    "ea": geosite("ea"),
    "ubisoft": geosite("ubisoft"),
    "blizzard": geosite("blizzard"),
    "coursera": geosite("coursera"),
    "edx": geosite("edx"),
    "udemy": geosite("udemy"),
    "khanacademy": geosite("khanacademy"),
    "category-scholar-!cn": geosite("category-scholar-!cn"),
    "paypal": geosite("paypal"),
    "visa": geosite("visa"),
    "mastercard": geosite("mastercard"),
    "stripe": geosite("stripe"),
    "wise": geosite("wise"),
    "geolocation-!cn": geosite("geolocation-!cn"),
    "geolocation-cn": geosite("geolocation-cn"),
    "openai-mrs": geosite("openai-mrs", "openai"),
    "anthropic-mrs": geosite("anthropic-mrs", "anthropic"),
    "onedrive-mrs": geosite("onedrive-mrs", "onedrive"),
    // MetaCubeX geoip
    "private-mrs": geoip("private-mrs", "private"),
    "cn-mrs": geoip("cn-mrs", "cn"),

    // 广告
    "ByteDanceAd": {
        type: "http", format: "text", behavior: "classical", interval: 86400,
        url: "https://raw.githubusercontent.com/henrysha1989/shadowrocket-adr-rules/clash-ios/mihomo/bytedance-ad.list",
        path: "./ruleset/ByteDanceAd.list"
    },
    "BanAD": {
        type: "http", format: "text", behavior: "classical", interval: 86400,
        url: "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanAD.list",
        path: "./ruleset/BanAD.list"
    },
    "AntiAd": {
        type: "http", format: "yaml", behavior: "domain", interval: 86400,
        url: "https://raw.githubusercontent.com/privacy-protection-tools/anti-AD/master/anti-ad-clash.yaml",
        path: "./ruleset/anti-ad-clash.yaml"
    },
    "SukkaReject": {
        type: "http", format: "text", behavior: "classical", interval: 86400,
        url: "https://ruleset.skk.moe/Clash/non_ip/reject.txt",
        path: "./ruleset/skk-reject.txt"
    },

    // blackmatrix7
    "applemusic": b7("applemusic", "AppleMusic"),
    "discord": b7("discord", "Discord"),
    "whatsapp": b7("whatsapp", "Whatsapp"),
    "wikipedia": b7("wikipedia", "Wikipedia"),
    "reddit": b7("reddit", "Reddit"),
    "cloudflare": b7("cloudflare", "Cloudflare"),

    // Sukka
    "StaticResources": {
        type: "http", behavior: "domain", format: "text", interval: 86400,
        url: "https://ruleset.skk.moe/Clash/domainset/cdn.txt", path: "./ruleset/StaticResources.txt"
    },
    "CDNResources": {
        type: "http", behavior: "classical", format: "text", interval: 86400,
        url: "https://ruleset.skk.moe/Clash/non_ip/cdn.txt", path: "./ruleset/CDNResources.txt"
    },

    // Loyalsoldier
    "reject": loyal("reject"),
    "icloud": loyal("icloud"),
    "apple": loyal("apple"),
    "proxy": loyal("proxy"),
    "direct": loyal("direct"),
    "private": loyal("private"),
    "gfw": loyal("gfw"),
    "tld-not-cn": loyal("tld-not-cn"),
    "cncidr": loyal("cncidr", "ipcidr"),
    "lancidr": loyal("lancidr", "ipcidr"),
    "applications": loyal("applications", "classical")
};

const rules = [
    // IP 检测探针跟随选择节点
    "DOMAIN,2026.ip138.com,选择节点",
    "DOMAIN,my.ip.cn,选择节点",
    // -------- WebRTC 防泄露：拦截 STUN（UDP 探真实 IP） --------
    "DOMAIN-KEYWORD,stun,REJECT",
    "DST-PORT,3478,REJECT",
    "DST-PORT,5349,REJECT",
    // -------- 广告与隐私拦截 --------
    "RULE-SET,category-ads-all,广告拦截",
    "RULE-SET,reject,广告拦截",
    "RULE-SET,ByteDanceAd,广告拦截",
    "RULE-SET,BanAD,广告拦截",
    "RULE-SET,AntiAd,广告拦截",
    "RULE-SET,SukkaReject,广告拦截",
    "DOMAIN-KEYWORD,pangolin,广告拦截",
    "DOMAIN-SUFFIX,pglstatp-toutiao.com,广告拦截",
    "DOMAIN-SUFFIX,pglstatp-toutiao-b.com,广告拦截",
    "DOMAIN-KEYWORD,-ad-sign.byteimg.com,广告拦截",
    "DOMAIN-SUFFIX,zlink.ugsdk.cn,广告拦截",
    "DOMAIN-REGEX,^ads[0-9]+-normal\\.zijieapi\\.com$,广告拦截",

    // -------- 券商服务 --------
    "RULE-SET,ibkr-domains,盈透服务",
    "RULE-SET,schwab-domains,嘉信服务",

    // -------- AI（原脚本在每条后面又写了一条同规则集的 REJECT，永远匹配不到，已删除） --------
    "RULE-SET,openai-mrs,ChatGPT",
    "RULE-SET,anthropic-mrs,Claude",
    "DOMAIN-KEYWORD,nexus-websocket-,Claude",
    "RULE-SET,category-ai-chat-!cn,AI服务",
    "RULE-SET,overseas-ai-extra,AI服务",

    // -------- 开发服务 --------
    "RULE-SET,category-dev,开发服务",
    "RULE-SET,github-domains,开发服务",
    "RULE-SET,gitlab,开发服务",
    "RULE-SET,aws,开发服务",
    "RULE-SET,azure,开发服务",
    "RULE-SET,digitalocean,开发服务",
    "RULE-SET,heroku,开发服务",
    "RULE-SET,dropbox,开发服务",

    // -------- 通讯与社交 --------
    "RULE-SET,telegram-mrs,社交通讯",
    "RULE-SET,discord,社交通讯",
    "RULE-SET,whatsapp,社交通讯",
    "RULE-SET,facebook,社交通讯",
    "RULE-SET,instagram,社交通讯",
    "RULE-SET,twitter,社交通讯",
    "RULE-SET,linkedin,社交通讯",
    "RULE-SET,reddit,社交通讯",
    "RULE-SET,wikipedia,选择节点",

    // -------- 内容与流媒体 --------
    "RULE-SET,youtube,媒体服务",
    "RULE-SET,tiktok-mrs,媒体服务",
    "RULE-SET,netflix-mrs,媒体服务",
    "GEOSITE,SPOTIFY,媒体服务",
    "RULE-SET,hulu,媒体服务",
    "RULE-SET,disney,媒体服务",
    "RULE-SET,hbo,媒体服务",
    "RULE-SET,bahamut-mrs,媒体服务",
    "RULE-SET,amazon,选择节点",

    // -------- 教育、游戏与专项 --------
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

    // -------- 系统、云盘与生态 --------
    "RULE-SET,google-mrs,谷歌服务",
    "RULE-SET,microsoft-mrs,微软服务",
    "RULE-SET,onedrive-mrs,微软服务",
    "RULE-SET,apple-mrs,苹果服务",
    "RULE-SET,applemusic,苹果服务",
    "RULE-SET,icloud,苹果服务",
    "RULE-SET,apple,苹果服务",
    "RULE-SET,cloudflare,静态资源",
    "RULE-SET,StaticResources,静态资源",
    "RULE-SET,CDNResources,静态资源",

    // -------- 金融与支付 --------
    "RULE-SET,paypal,选择节点",
    "RULE-SET,visa,选择节点",
    "RULE-SET,mastercard,选择节点",
    "RULE-SET,stripe,选择节点",
    "RULE-SET,wise,选择节点",

    // -------- 直连 / 代理兜底 --------
    // 注意：private-mrs / cn-mrs 刻意不加 no-resolve，与原脚本保持一致。
    // 这样未命中的域名会先经代理 DoH 解析再比对 IP 段，DNS 泄漏检测表现和原脚本相同
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
    "GEOIP,TELEGRAM,社交通讯,no-resolve",
    "GEOIP,NETFLIX,媒体服务,no-resolve",
    "RULE-SET,cncidr,直连,no-resolve",
    "RULE-SET,lancidr,直连,no-resolve",
    "DST-PORT,22,SSH(22端口)",
    "MATCH,选择节点"
];

// ===================== 嗅探 / DNS / GEO =====================
const snifferConfig = {
    "enable": true,
    "force-dns-mapping": true,
    "override-destination": false,
    "sniff": {
        "TLS": {"ports": [443, 8443]},
        "HTTP": {"ports": [80, 8080, 8880]},
        "QUIC": {"ports": [443, 8443]}
    },
    // 修复：原来写的 "Mijia Cloud" 不是域名，无效
    "skip-domain": ["dlg.io.mi.com", "+.push.apple.com"]
};

const bootstrapDns = ["tls://223.5.5.5"];


const baseDnsConfig = {
    "enable": true,
    "ipv6": ipv6Enabled,
    "prefer-h3": false,
    "enhanced-mode": "redir-host",
    "default-nameserver": bootstrapDns,
    "nameserver": [
        "https://1.1.1.1/dns-query#选择节点",
        "https://8.8.8.8/dns-query#选择节点"
    ],
    "proxy-server-nameserver": bootstrapDns
};

const dnsConfig2 = {
    ...baseDnsConfig,
    "enhanced-mode": "fake-ip",
    "fake-ip-filter": [
        "geosite:private",
        "geosite:connectivity-check",
        "geosite:cn",
        "dlg.io.mi.com",      // 修复：原来 fake-ip-filter 写成 dig.io.mi.com，与嗅探跳过的 dlg 不一致
        "localhost.ptlogin2.qq.com",
        "*.icloud.com",
        "*.stun.*.*",
        "*.stun.*.*.*"
    ]
};

const geoxURL = {
    "geoip": "https://cdn.jsdelivr.net/gh/Loyalsoldier/v2ray-rules-dat@release/geoip.dat",
    "geosite": "https://cdn.jsdelivr.net/gh/Loyalsoldier/v2ray-rules-dat@release/geosite.dat",
    "mmdb": "https://cdn.jsdelivr.net/gh/Loyalsoldier/geoip@release/Country.mmdb",
    "asn": "https://cdn.jsdelivr.net/gh/Loyalsoldier/geoip@release/GeoLite2-ASN.mmdb"
};

// ===================== 工具函数 =====================
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

// 为节点名补国旗（已含国旗则跳过）。ISP/家宽节点也会加旗，只是不计入地区统计
function addFlagToName(name) {
    if (!name) return name;
    if (existingFlagRegex.test(name)) return name;
    for (const {flag, regex} of flagCompiledRegex) {
        if (flag && regex.test(name)) return `${flag} ${name}`;
    }
    return name;
}

function hasLowCost(config) {
    for (const proxy of config.proxies || []) {
        const name = proxy.name || "";
        const m = extractMultiplier(name);
        if (m !== null) {
            if (m < 1) return true;
            continue;
        }
        if (lowCostRegex.test(name)) return true;
    }
    return false;
}

function hasHighCost(config) {
    for (const proxy of config.proxies || []) {
        const name = proxy.name || "";
        const m = extractMultiplier(name);
        if (m !== null) {
            if (m > 1) return true;
            continue;
        }
        if (highCostRegex.test(name)) return true;
    }
    return false;
}

function parseCountries(config) {
    const counts = Object.create(null);
    let unclassifiedCount = 0;

    for (const proxy of config.proxies || []) {
        const name = proxy.name || '';
        if (!name) continue;
        if (ispRegex.test(name)) continue;
        // 新增：信息类节点（到期/流量/官网等）不参与统计，避免凭空多出只有信息节点的地区组
        if (!autoTestRegex.test(name)) continue;

        let matched = false;
        for (const {country, regex} of flagCompiledRegex) {
            if (regex.test(name)) {
                counts[country] = (counts[country] || 0) + 1;
                matched = true;
                break;
            }
        }
        if (!matched && !lowCostRegex.test(name)) unclassifiedCount++;
    }

    // 按 countriesMeta 顺序输出，避免地区组顺序随订阅节点顺序漂移
    const result = Object.entries(counts)
        .map(([country, count]) => ({country, count}))
        .sort((a, b) => countryOrder.indexOf(a.country) - countryOrder.indexOf(b.country));
    if (unclassifiedCount > 0) result.push({country: unclassifiedCountryName, count: unclassifiedCount});
    return result;
}

function buildBaseLists({landing, highCost, lowCost, countryInfo}) {
    const countryGroupNames = countryInfo.filter(i => i.count > 0).map(i => i.country + "节点");

    const selector = ["延迟自动", "故障转移"];
    if (landing) selector.push("落地节点");
    if (highCost) selector.push("高倍率节点");
    selector.push(...countryGroupNames);
    if (lowCost) selector.push("低倍率节点");
    selector.push("手动选择", "DIRECT");

    const defaultProxies = ["选择节点", "延迟自动"];
    if (highCost) defaultProxies.push("高倍率节点");
    defaultProxies.push(...countryGroupNames);
    if (lowCost) defaultProxies.push("低倍率节点");
    defaultProxies.push("手动选择");

    // 修复：故障转移不再包含「落地节点」。原来落地节点排第一，一旦选了故障转移，
    // 全部普通流量都会被送进 ISP 节点
    const defaultFallback = [];
    if (highCost) defaultFallback.push("高倍率节点");
    defaultFallback.push(...countryGroupNames);
    if (lowCost) defaultFallback.push("低倍率节点");
    defaultFallback.push("手动选择", "DIRECT");

    return {defaultProxies, defaultSelector: selector, defaultFallback, countryGroupNames};
}

function buildCountryProxyGroups(countryList, landingOn) {
    const groups = [];
    const common = {
        "type": loadBalance ? "load-balance" : "url-test",
        "url": "https://cp.cloudflare.com/generate_204",
        "interval": 600,
        "tolerance": 20,
        "lazy": false,
        "include-all": true
    };
    // 排除：落地（仅落地模式）、低倍率、信息类节点
    const excludeFilter = "(?i)" + [
        landingOn ? landingKeywordSource : null,
        lowCostMatchSource,
        nonProxyKeywordSource,
        leadingTrafficInfoSource
    ].filter(Boolean).join("|");

    for (const country of countryList) {
        if (country === unclassifiedCountryName) {
            groups.push({
                ...common,
                "name": `${unclassifiedCountryName}节点`,
                "icon": unclassifiedCountryIcon,
                "filter": autoTestFilter,
                "exclude-filter": unclassifiedNodeExcludeFilter
            });
        } else if (countriesMeta[country]) {
            groups.push({
                ...common,
                "name": `${country}节点`,
                "icon": countriesMeta[country].icon,
                "filter": countriesMeta[country].pattern,
                "exclude-filter": excludeFilter
            });
        }
    }
    return groups;
}

function buildProxyGroups({
                              countryProxyGroups, highCost, lowCost, landing,
                              defaultProxies, defaultSelector, defaultFallback, aiNodeProxies
                          }) {
    // 前置代理候选：去掉落地节点、故障转移，另外去掉「手动选择」和 DIRECT。
    // 手动选择 / 延迟自动 都 include-all，可能把 ISP 节点自己选成前置 → 链路死循环；
    // DIRECT 会让国内直连 ISP 代理，暴露且易被干扰。
    const frontProxySelector = defaultSelector.filter(
        n => !["落地节点", "故障转移", "手动选择", "DIRECT"].includes(n));

    // 落地模式下，自动/负载均衡组都不要把落地节点算进去
    const excludeLanding = landing ? {"exclude-filter": landingFilter} : {};
    const sel = (name, icon, proxies) => ({name, icon, type: "select", proxies});

    return [
        {
            "name": "延迟自动",
            "icon": K + "Auto.png",
            "type": "url-test",
            "include-all": true,
            "filter": autoTestFilter,
            ...excludeLanding,
            "url": "https://cp.cloudflare.com/generate_204",
            "interval": 300,
            "tolerance": 50,
            "lazy": false
        },
        sel("选择节点", K + "Ingress.png", defaultSelector),
        {
            "name": "手动选择",
            "icon": K + "Available.png",
            "include-all": true,
            "type": "select",
            "proxies": ["负载均衡(散列)", "负载均衡(轮询)"]
        },
        landing ? {
            "name": FRONT_GROUP,
            "icon": K + "Area.png",
            "type": "select",
            "include-all": true,
            "exclude-filter": landingFilter,
            "proxies": frontProxySelector
        } : null,
        landing ? {
            "name": "落地节点",
            "icon": K + "Airport.png",
            "type": "select",
            "include-all": true,
            "filter": landingFilter
        } : null,
        {
            "name": "故障转移",
            "icon": K + "Bypass.png",
            "type": "fallback",
            "url": "https://cp.cloudflare.com/generate_204",
            "proxies": defaultFallback,
            "interval": 600,
            "lazy": false
        },
        {
            "name": "负载均衡(散列)",
            "icon": KT + "Round_Robin_1.png",
            "type": "load-balance",
            "strategy": "consistent-hashing",
            "include-all": true,
            "filter": autoTestFilter,
            ...excludeLanding,
            "url": "https://cp.cloudflare.com/generate_204",
            "interval": 600,
            "timeout": 10000,
            "lazy": true,
            "max-failed-times": 3
        },
        {
            "name": "负载均衡(轮询)",
            "icon": KT + "Round_Robin.png",
            "type": "load-balance",
            "strategy": "round-robin",
            "include-all": true,
            "filter": autoTestFilter,
            ...excludeLanding,
            "url": "https://cp.cloudflare.com/generate_204",
            "interval": 600,
            "timeout": 10000,
            "lazy": true,
            "max-failed-times": 3
        },
        // -------- 服务分组 --------
        sel("静态资源", K + "Cloudflare.png", defaultProxies),
        sel("ChatGPT", "https://cdn.jsdelivr.net/gh/powerfullz/override-rules@master/icons/chatgpt.png", aiNodeProxies),
        sel("Claude", "https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@master/packages/static-png/dark/claude-color.png", aiNodeProxies),
        sel("AI服务", K + "AI.png", defaultProxies),
        sel("盈透服务", "https://www.interactivebrokers.com/images/web/favicons/home-screen-icon-128x128.png", [...defaultProxies, "直连"]),
        sel("嘉信服务", "https://www.schwab.com/themes/custom/sch_beacon_retail/favicons/icon_32x32.png", [...defaultProxies, "直连"]),
        sel("开发服务", K + "Proxy.png", defaultProxies),
        sel("社交通讯", K + "Telegram.png", defaultProxies),
        sel("媒体服务", K + "ForeignMedia.png", defaultProxies),
        sel("SSH(22端口)", K + "Server.png", ["直连", ...defaultProxies]),
        sel("谷歌服务", V.replace("flags/", "google.svg"), defaultProxies),
        sel("苹果服务", K + "Apple.png", ["直连", ...defaultProxies]),
        sel("微软服务", K + "Microsoft.png", ["直连", ...defaultProxies]),
        sel("直连", K + "Direct.png", ["DIRECT", "选择节点"]),
        sel("广告拦截", K + "AdBlack.png", ["REJECT", "直连"]),
        highCost ? {
            "name": "高倍率节点",
            "icon": K + "Rocket.png",
            "type": "url-test",
            "url": "https://cp.cloudflare.com/generate_204",
            "interval": 600,
            "timeout": 10000,
            "include-all": true,
            "filter": highCostIncludeFilter
        } : null,
        lowCost ? {
            "name": "低倍率节点",
            "icon": K + "Lab.png",
            "type": "url-test",
            "url": "https://cp.cloudflare.com/generate_204",
            "interval": 600,
            "timeout": 10000,
            "include-all": true,
            "filter": lowCostExcludeFilter
        } : null,
        ...countryProxyGroups
    ].filter(Boolean);
}

// ===================== 入口 =====================
function main(config) {
    // 1. 注入 ISP 节点（链式经「前置代理」组）
    let proxies = (config.proxies || []).slice();
    // 链式开启时节点名带「(链式)」后缀：在面板里看到后缀，就说明该节点已设置 dialer-proxy
    const ispName = ispProxy.server ? (ISP_CHAIN ? `${ispProxy.name} (链式)` : ispProxy.name) : null;
    if (ispName) {
        proxies = proxies.filter(p => p.name !== ispName);
        proxies.push({...ispProxy, name: ispName, ...(ISP_CHAIN ? {"dialer-proxy": FRONT_GROUP} : {})});
    }

    // 2. 加国旗 + 重名处理（先加旗再去重，保证后续各组引用的名字一致）
    const seenNames = new Map();
    const ambiguousNames = new Set();
    const deduplicatedProxies = proxies.map(proxy => {
        const flaggedName = addFlagToName(proxy.name);
        let newName = flaggedName;
        if (seenNames.has(flaggedName)) {
            const count = seenNames.get(flaggedName) + 1;
            seenNames.set(flaggedName, count);
            newName = `${flaggedName} ${count + 1}`;
            ambiguousNames.add(flaggedName);
            ambiguousNames.add(newName);
        } else {
            seenNames.set(flaggedName, 0);
        }
        return {...proxy, name: newName};
    });

    // 3. 是否启用落地功能：用户开启或已注入 ISP 节点，且确实存在落地节点。
    //    没有落地节点时不生成「落地节点」组，避免空组被内核补成 DIRECT 导致误直连
    const hasLandingNodes = deduplicatedProxies.some(p => ispRegex.test(p.name));
    const landingOn = (landing || !!ispName) && hasLandingNodes;

    // 4. ChatGPT / Claude 组候选：ISP 节点排第一（默认选中），其次 REJECT 作保险，再是其他节点
    const nonNodeTypes = new Set(["direct", "reject", "reject-drop", "dns", "pass", "pass-rule", "compatible"]);
    const otherNodes = deduplicatedProxies
        .filter(p => p.name !== ispName && !ambiguousNames.has(p.name) &&
            autoTestRegex.test(p.name) && !nonNodeTypes.has(p.type))
        .map(p => p.name);
    const aiNodeProxies = ispName ? [ispName, "REJECT", ...otherNodes] : ["REJECT", ...otherNodes];

    config = {...config, proxies: deduplicatedProxies};

    const countryInfo = parseCountries(config);
    const lowCost = hasLowCost(config);
    const highCost = hasHighCost(config);

    const {defaultProxies, defaultSelector, defaultFallback, countryGroupNames} =
        buildBaseLists({landing: landingOn, highCost, lowCost, countryInfo});

    const countryProxyGroups = buildCountryProxyGroups(
        countryGroupNames.map(n => n.replace(/节点$/, '')), landingOn);

    const proxyGroups = buildProxyGroups({
        countryProxyGroups, highCost, lowCost, landing: landingOn,
        defaultProxies, defaultSelector, defaultFallback, aiNodeProxies
    });

    proxyGroups.push({
        "name": "GLOBAL",
        "icon": K + "Global.png",
        "include-all": true,
        "type": "select",
        "proxies": proxyGroups.map(g => g.name)
    });

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
        // 修复：原来是 ":9999" 且开了 allow-lan、无 secret，局域网内任何人都能控制内核
        "external-controller": "127.0.0.1:9999",
        "disable-keep-alive": !keepAliveEnabled
    });

    Object.assign(config, {
        "profile": {...config.profile, "store-selected": true},
        "proxy-groups": proxyGroups,
        "rule-providers": ruleProviders,
        "rules": rules,
        "sniffer": snifferConfig,
        "dns": fakeIPEnabled ? dnsConfig2 : baseDnsConfig,
        "geodata-mode": true,
        "geox-url": geoxURL
    });

    // 仅加固已启用自动路由的 TUN
    if (config.tun?.enable && config.tun["auto-route"]) {
        config.tun = {
            ...config.tun,
            "strict-route": true,
            "dns-hijack": [...new Set([
                ...(config.tun["dns-hijack"] || []),
                "any:53",
                "tcp://any:53"
            ])]
        };
    }

    return config;
}
