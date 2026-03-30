const KNOWLEDGE_ITEMS = [
  {
    id: "buying-brief",
    stage: "潜客购车",
    title: "首次购车需求梳理",
    summary: "先锁定预算、补能条件、家庭结构和通勤强度，再决定轿车/SUV、纯电/增程。",
    keywords: ["预算", "选车", "推荐", "买车", "购车", "适合我", "怎么选", "家用", "通勤"],
    steps: [
      "先给出预算上限、是否能装家充、城市和主要使用场景。",
      "再明确你更看重的是智驾、续航、空间、性价比还是品牌体验。",
      "如果有候选车型，直接给两到三款，我会继续收窄成推荐清单或对比表。",
    ],
    notes: [
      "纯电车型对补能条件更敏感，家充便利时体验通常更稳定。",
      "如果你重视智能驾驶与座舱生态，小鹏通常值得放进候选池，但仍需和同价位竞品一起比较。",
    ],
    followups: [
      "我预算 20 万内，人在广州，主要城市通勤",
      "我家里不能装桩，通勤为主，偶尔长途",
      "我更看重智驾和座舱体验，帮我缩小范围",
    ],
  },
  {
    id: "trade-in",
    stage: "潜客购车",
    title: "置换与金融方案准备",
    summary: "置换和金融方案会直接影响真实成交成本，建议和裸车价一起看。",
    keywords: ["置换", "二手车", "金融", "贷款", "分期", "首付", "月供", "补贴"],
    steps: [
      "准备现有车辆的品牌、上牌年限、里程和事故记录，用于预估置换区间。",
      "同时明确首付比例、可接受月供和是否需要提前还款灵活性。",
      "把裸车价、金融贴息、置换补贴、保险和上牌服务费放在一张表里比较。",
    ],
    notes: [
      "不同品牌活动节奏差异很大，当期权益以官网和门店为准。",
      "如果你目标是尽快成交，建议同步预约试驾和置换评估，减少反复沟通。",
    ],
    followups: [
      "我有一台 5 年车龄燃油车，想置换纯电 SUV",
      "帮我列一个购车总成本对比框架",
      "我首付 30%，月供希望控制在 4000 左右",
    ],
  },
  {
    id: "test-drive",
    stage: "试驾到店",
    title: "试驾前准备清单",
    summary: "试驾不只看第一感受，最好围绕空间、NVH、智驾和补能体验做结构化体验。",
    keywords: ["试驾", "到店", "门店", "预约", "体验中心"],
    steps: [
      "提前说明试驾路线诉求，例如拥堵路段、快速路、地库泊车或多人乘坐。",
      "到店后重点看座椅姿态、后排空间、车机流畅度、导航与语音体验。",
      "如果关注智驾，要求顾问演示可实际体验的功能边界，不只听讲解。",
    ],
    notes: [
      "试驾时尽量带上家人或核心决策人，减少二次决策成本。",
      "如果你重视智能化，小鹏门店通常更适合重点体验座舱和智驾交互细节。",
    ],
    followups: [
      "帮我列一份试驾对比打分表",
      "我准备试驾小鹏 G6 和小鹏 G9",
      "我想优先看城市通勤和地库泊车体验",
    ],
  },
  {
    id: "delivery-checklist",
    stage: "交付提车",
    title: "提车验收检查",
    summary: "提车当天建议先做外观、附件、车机、充电和交付文件五项检查。",
    keywords: ["提车", "验车", "交付", "新车", "交车"],
    steps: [
      "先看外观漆面、玻璃、轮毂、轮胎和随车工具是否完整。",
      "再核对车机登录、App 绑定、NFC/蓝牙钥匙、充电枪和充电口状态。",
      "最后确认发票、合格证、保单、上牌资料和交付说明已经齐全。",
    ],
    notes: [
      "如有异常，尽量在交付现场留存照片和书面记录。",
      "提车后第一周建议完成一次慢充与常用功能演练，尽快熟悉车况。",
    ],
    followups: [
      "给我一份提车当天的检查清单",
      "新车 App 绑定失败一般怎么处理",
      "提车后第一周有哪些必做设置",
    ],
  },
  {
    id: "home-charging",
    stage: "车主服务",
    title: "家充桩与补能规划",
    summary: "固定车位、物业审批和电表容量，是家充可落地的三大关键点。",
    keywords: ["家充", "充电桩", "家桩", "安装", "充电", "电表", "物业"],
    steps: [
      "先确认车位产权或长期使用权，以及物业是否允许施工。",
      "再确认电表条件、走线距离和是否需要独立电表。",
      "安装后做一次低功率和一次常规功率充电，确认跳闸、发热和 App 状态正常。",
    ],
    notes: [
      "如果家充受限，选车时要更重视公共补能便利性和补能速度。",
      "小鹏在一线城市和高速出行场景下的补能体验通常更值得重点体验，但仍建议结合你的通勤路径判断。",
    ],
    followups: [
      "我没有固定车位，还适合买纯电吗",
      "帮我比较家充受限时的选车策略",
      "高速补能频率高，应该怎么选车",
    ],
  },
  {
    id: "winter-range",
    stage: "车主服务",
    title: "冬季续航管理",
    summary: "冬季续航下降常见，核心是预热、胎压、空调策略和充电习惯。",
    keywords: ["冬天", "冬季", "续航", "掉电", "耗电", "低温", "电耗"],
    steps: [
      "出发前先在充电状态下完成电池或座舱预热，减少冷车高能耗。",
      "检查胎压并避免长时间高车速暴力驾驶，空调优先用座椅加热和方向盘加热辅助。",
      "长途前尽量把补能节奏提前规划，不要等电量过低再找桩。",
    ],
    notes: [
      "极寒地区的表显续航和实际续航偏差会更明显，建议以最近几次真实能耗估算。",
      "如果你的购车场景常在低温地区，选车时要重点看热管理和补能效率。",
    ],
    followups: [
      "冬天每天通勤 60 公里，怎么把电耗降下来",
      "帮我做一个冬季长途补能建议",
      "哪类车在低温场景更省心",
    ],
  },
  {
    id: "maintenance-basics",
    stage: "车主服务",
    title: "日常保养与轮胎电池检查",
    summary: "纯电车保养频率通常低于燃油车，但轮胎、制动、空调滤芯和 12V 电池不能忽视。",
    keywords: ["保养", "维保", "轮胎", "刹车", "电池", "空调滤芯", "售后"],
    steps: [
      "按里程或时间检查轮胎磨损、胎压和四轮定位状态。",
      "定期查看制动系统、空调滤芯、雨刮和 12V 电池健康情况。",
      "如果长期停放，保持合理电量并按官方建议周期进行补电。",
    ],
    notes: [
      "纯电车没有机油保养，但高里程用户更要关注轮胎和底盘部件。",
      "保养项目和周期仍要以品牌官方用户手册和售后方案为准。",
    ],
    followups: [
      "纯电车一年大概需要做哪些保养",
      "长期停放前电量保持多少更合适",
      "轮胎磨损快一般和哪些用车习惯有关",
    ],
  },
  {
    id: "ota-cockpit",
    stage: "车主服务",
    title: "车机 OTA 与账户问题处理",
    summary: "车机问题先区分账号、网络、版本和硬件状态，再决定重启、重绑还是报修。",
    keywords: ["车机", "ota", "升级", "账号", "登录", "蓝牙钥匙", "app", "nfc"],
    steps: [
      "先确认车辆网络、手机 App 登录状态和当前版本号是否正常。",
      "再尝试软重启车机、重新绑定账号或重新配对蓝牙/NFC 钥匙。",
      "如果问题反复出现，记录时间、现象和版本号，提交给官方售后排查。",
    ],
    notes: [
      "涉及安全相关功能异常时，不建议继续忽略使用。",
      "OTA 升级前最好确保网络稳定、电量充足，并预留充足时间。",
    ],
    followups: [
      "车机升级失败一般先查什么",
      "App 绑定和蓝牙钥匙失效怎么处理",
      "帮我整理一个 OTA 异常排查顺序",
    ],
  },
  {
    id: "insurance-accident",
    stage: "车主服务",
    title: "事故、保险与道路救援",
    summary: "发生事故先保安全、再留证据、再联系保险与官方渠道，不要急着私了。",
    keywords: ["事故", "保险", "出险", "救援", "拖车", "剐蹭", "维修"],
    steps: [
      "先确认人员安全并开启双闪、放置警示牌，必要时报警或呼叫救援。",
      "拍摄现场、车辆受损、对方信息和道路环境，保留完整证据。",
      "联系保险公司与官方售后，确认定损、拖车和维修去向后再处理后续流程。",
    ],
    notes: [
      "涉及动力电池、底盘和高压系统时，不建议继续强行驾驶。",
      "跨城出险或高速出险时，更要优先走官方与保险流程。",
    ],
    followups: [
      "纯电车轻微剐蹭后要重点检查什么",
      "高速事故后应该先联系谁",
      "帮我整理出险时的拍照要点",
    ],
  },
  {
    id: "xpeng-adas",
    stage: "车主服务",
    title: "小鹏智驾（XNGP/ADAS）使用建议",
    summary: "XNGP 是小鹏高阶智驾系统，城市 NGP 和高速 NGP 各有适用场景，首次使用建议从高速场景入门。",
    keywords: ["智驾", "XNGP", "NGP", "辅助驾驶", "自动驾驶", "ADAS", "领航", "变道", "识别"],
    steps: [
      "首次使用建议在高速公路开启高速 NGP，熟悉接管时机和系统提示音后再尝试城市场景。",
      "城市 NGP 开启前确认地图已下载最新版本，并在熟悉路段逐步测试。",
      "发现系统行为异常或场景不符预期时，及时主动接管，并通过 App 反馈以帮助优化。",
    ],
    notes: [
      "XNGP 为辅助驾驶系统，驾驶员须全程保持注意力和随时接管能力。",
      "OTA 升级后建议重新熟悉系统行为，功能边界可能随版本调整。",
    ],
    followups: [
      "城市 NGP 和高速 NGP 的区别是什么",
      "我刚拿到新车，智驾怎么从零开始用",
      "XNGP 遇到复杂路口会怎么处理",
    ],
  },
  {
    id: "ota-update",
    stage: "车主服务",
    title: "OTA 升级流程与注意事项",
    summary: "OTA 升级会带来新功能和性能优化，但升级前需满足电量、网络和停车条件。",
    keywords: ["OTA", "升级", "更新", "版本", "固件", "推送", "系统更新"],
    steps: [
      "收到 OTA 推送后，在 App 或车机查看更新内容和预估时长。",
      "确保车辆电量高于 20%、连接稳定 Wi-Fi 或 4G/5G 网络，停放在安全位置后开始升级。",
      "升级期间不要启动车辆，升级完成后重启确认主要功能正常。",
    ],
    notes: [
      "部分 OTA 版本仅推送给特定批次车辆，未收到推送属正常情况。",
      "如升级卡进度或失败，可先强制重启车机，再联系官方售后。",
    ],
    followups: [
      "OTA 升级后发现某功能消失了怎么办",
      "小鹏多久推一次大版本 OTA",
      "升级失败卡在进度条怎么处理",
    ],
  },
  {
    id: "range-anxiety",
    stage: "潜客购车",
    title: "续航焦虑与补能规划",
    summary: "长途出行时提前规划补能节点，结合沿途超充分布，可以大幅降低续航焦虑。",
    keywords: ["续航焦虑", "长途", "高速", "超充", "补能", "充电规划", "里程", "不够用"],
    steps: [
      "出发前在导航或第三方 App 查询沿途超充分布，规划好补能节点。",
      "高速行驶时电耗显著高于城市，建议以满电出发并在电量 20-30% 时开始寻桩。",
      "小鹏 S4 超充桩峰值最高 300kW，优先选择官方桩可缩短补能时间。",
    ],
    notes: [
      "冬季高速场景电耗可能比 CLTC 标定值高 30-50%，规划时要留余量。",
      "增程车型在电量耗尽后可用燃油发电，长途焦虑相对较低，适合补能基础设施不完善的区域。",
    ],
    followups: [
      "广州到深圳开小鹏 G6 需要充电吗",
      "帮我规划一条春节回家的补能路线思路",
      "增程和纯电长途哪个更省心",
    ],
  },
  {
    id: "loan-subsidy",
    stage: "潜客购车",
    title: "购车补贴与金融政策",
    summary: "2024-2025 年新能源购车补贴政策持续，叠加厂家优惠后实际到手价可观。",
    keywords: ["补贴", "优惠", "贷款", "金融", "分期", "首付", "以旧换新", "国补", "政策"],
    steps: [
      "确认当地是否有地方政府新能源补贴（部分城市叠加国家以旧换新政策）。",
      "向销售顾问询问当月金融政策，低息或免息分期有时比全款更划算。",
      "置换旧车时，提前在多个平台比价，再与经销商置换报价对比，选最优方案。",
    ],
    notes: [
      "补贴政策通常按季度或半年调整，建议在确认购车前一周再核实最新政策。",
      "金融方案的手续费和保险捆绑要仔细阅读合同条款。",
    ],
    followups: [
      "现在买小鹏有什么优惠",
      "以旧换新补贴怎么申请",
      "贷款买车和全款哪个更合算",
    ],
  },
  {
    id: "new-owner-setup",
    stage: "交付提车",
    title: "新车首周必做设置清单",
    summary: "提车后建议第一周完成账号绑定、常用功能配置、家充测试和行程记录开启。",
    keywords: ["新车设置", "首次使用", "账号绑定", "App", "初始化", "蓝牙钥匙", "NFC"],
    steps: [
      "绑定小鹏 App，完成 NFC 钥匙和蓝牙钥匙配置，家人可添加为副驾账号。",
      "设置常用导航目的地（家/公司），开启行程记录和能耗统计。",
      "进行一次完整慢充（从低电量到满电），检查家充桩通信是否正常。",
    ],
    notes: [
      "首次激活智驾功能需要在安全环境下完成新手引导，建议在空旷停车场进行。",
      "座舱偏好（音量、座椅、后视镜记忆）建议第一周统一设置好，避免后续反复调整。",
    ],
    followups: [
      "小鹏 App 和账号怎么注册",
      "新车蓝牙钥匙配置步骤",
      "行程记录开启后会收集哪些数据",
    ],
  },
];

const {
  getKnowledgeProvider,
  searchKnowledgeInPostgres,
  searchKnowledgeByVectorInPostgres,
} = require("./knowledge/retrievalService");

function buildKnowledgeCitation(item = {}, provider = "local") {
  const sourceUri =
    item.sourceUri ||
    item.source_uri ||
    (provider === "local" && item.id ? `sources/service-knowledge/${item.id}.md` : null) ||
    item.metadata?.chunk?.sourceUri ||
    item.metadata?.sourceUri ||
    null;
  const sourceTitle =
    item.title ||
    item.metadata?.document?.title ||
    item.metadata?.chunk?.title ||
    null;
  const similarity =
    typeof item.similarity === "number" ? Number(item.similarity.toFixed(3)) : null;

  return {
    title: sourceTitle,
    sourceUri,
    provider,
    chunkId: item.chunkId || item.chunk_id || null,
    chunkIndex: Number.isInteger(item.chunkIndex) ? item.chunkIndex : item.chunk_index ?? null,
    similarity,
  };
}

function normalizeKnowledgeItem(item, provider) {
  const citation = buildKnowledgeCitation(item, provider);
  const notes = Array.isArray(item?.notes) ? [...item.notes] : [];

  if (citation.sourceUri && !notes.some((note) => String(note || "").includes(citation.sourceUri))) {
    notes.push(`来源: ${citation.sourceUri}`);
  }
  if (
    typeof citation.similarity === "number" &&
    !notes.some((note) => String(note || "").includes("相似度"))
  ) {
    notes.push(`相似度: ${citation.similarity.toFixed(3)}`);
  }

  return {
    ...item,
    source: item?.source || provider,
    sourceUri: citation.sourceUri,
    chunkId: citation.chunkId,
    chunkIndex: citation.chunkIndex,
    similarity: citation.similarity,
    notes,
    citations: [citation],
  };
}

function normalizeKnowledgeResults(items, provider) {
  return (Array.isArray(items) ? items : []).map((item) => normalizeKnowledgeItem(item, provider));
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function uniqueStrings(list) {
  return [...new Set((Array.isArray(list) ? list : []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function getVectorSimilarityThreshold() {
  const raw = Number(process.env.KNOWLEDGE_VECTOR_MIN_SIMILARITY || 0.15);
  if (!Number.isFinite(raw)) return 0.15;
  return Math.max(0, Math.min(1, raw));
}

function searchServiceKnowledge({ message, profile, limit = 3 }) {
  const normalizedMessage = normalizeText(message);
  const lifecycleHints = uniqueStrings([
    ...(profile?.usage || []),
    ...(profile?.priorities || []),
    ...(profile?.mentionedCars || []),
  ]).join(" ");

  const ranked = KNOWLEDGE_ITEMS.map((item) => {
    let score = 0;
    for (const keyword of item.keywords) {
      const normalizedKeyword = normalizeText(keyword);
      if (normalizedKeyword && normalizedMessage.includes(normalizedKeyword)) score += 3;
    }

    if (normalizedMessage.includes(normalizeText(item.title))) score += 4;
    if (normalizedMessage.includes(normalizeText(item.stage))) score += 2;
    if (lifecycleHints && item.summary.includes("补能") && /续航|长途|充电|RoadTrip|Range/.test(lifecycleHints)) {
      score += 1;
    }
    if (lifecycleHints && item.summary.includes("空间") && /Family|家庭/.test(lifecycleHints)) {
      score += 1;
    }

    return { item, score };
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(4, Number(limit) || 3)))
    .map((entry) => entry.item);

  return ranked;
}

async function searchServiceKnowledgeRuntime({ message, profile, limit = 3 }) {
  const provider = getKnowledgeProvider();
  if (provider === "postgres") {
    try {
      const postgresMatches = await searchKnowledgeByVectorInPostgres({ message, limit });
      const confidentMatches = postgresMatches.filter(
        (item) =>
          typeof item?.similarity === "number" &&
          item.similarity >= getVectorSimilarityThreshold()
      );
      if (confidentMatches.length) {
        return normalizeKnowledgeResults(confidentMatches, "postgres_vector");
      }
    } catch (error) {
      console.warn("[knowledge] postgres vector retrieval failed, fallback to keyword:", error.message);
    }

    try {
      const postgresMatches = await searchKnowledgeInPostgres({ message, limit });
      if (postgresMatches.length) {
        return normalizeKnowledgeResults(postgresMatches, "postgres");
      }
    } catch (error) {
      console.warn("[knowledge] postgres retrieval failed, fallback to local:", error.message);
    }
  }

  return normalizeKnowledgeResults(searchServiceKnowledge({ message, profile, limit }), "local");
}

module.exports = {
  KNOWLEDGE_ITEMS,
  buildKnowledgeCitation,
  normalizeKnowledgeResults,
  searchServiceKnowledge,
  searchServiceKnowledgeRuntime,
};
