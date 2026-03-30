const { getCars } = require("./agent");

function listBrandsFromCatalog() {
  return ["小鹏"];
}

/** 地球表面两点距离（km） */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function normalizeBrandName(raw, brands) {
  const t = String(raw || "").trim();
  if (!t) return null;
  for (const b of brands) {
    if (t === b || t.includes(b) || b.includes(t)) return b;
  }
  const aliases = [
    [/xpeng|小鹏汽车/i, "小鹏"],
    [/tesla|特斯拉/i, "特斯拉"],
    [/byd|比亚迪/i, "比亚迪"],
    [/理想汽车|理想/i, "理想"],
    [/蔚来|nio/i, "蔚来"],
    [/问界|aito/i, "问界"],
    [/极氪|zeekr/i, "极氪"],
    [/小米汽车|小米su7|su7/i, "小米"],
    [/智己|im\s*motors/i, "智己"],
    [/零跑|leapmotor/i, "零跑"],
    [/深蓝|deepal/i, "深蓝"],
  ];
  for (const [re, b] of aliases) {
    if (re.test(t) && brands.includes(b)) return b;
  }
  return null;
}

/** 关键词兜底：车系名 → 品牌 */
function inferBrandKeyword(carModel, remark, brands) {
  const text = `${carModel} ${remark}`.toLowerCase();
  const modelHints = [
    [/g6|g9|p7|p7i|mona|m03|x9|小鹏/i, "小鹏"],
    [/model\s*3|model\s*y|model\s*s|特斯拉|tesla/i, "特斯拉"],
    [/汉ev|海豹|元plus|宋plus|唐|比亚迪|byd/i, "比亚迪"],
    [/理想l[6789]|理想one|理想mega/i, "理想"],
    [/et5|et7|es6|es8|蔚来|nio/i, "蔚来"],
    [/问界m[579]|aito/i, "问界"],
    [/极氪|007|001|zeekr/i, "极氪"],
    [/小米su7|小米汽车/i, "小米"],
    [/智己ls6|智己l6/i, "智己"],
    [/零跑c11|c10|c01/i, "零跑"],
    [/深蓝s07|sl03|deepal/i, "深蓝"],
  ];
  for (const [re, b] of modelHints) {
    if (re.test(text)) return { brand: b, source: "keyword" };
  }
  for (const b of brands) {
    if (text.includes(b.toLowerCase())) return { brand: b, source: "keyword" };
  }
  return { brand: null, source: "keyword" };
}

async function inferBrandWithLLM(client, model, temperature, carModel, remark) {
  const brands = listBrandsFromCatalog();
  const system = `你是汽车预约分流助手。根据用户填写的「意向车型」和「备注」，判断用户想试驾的车辆所属主机厂「品牌」。

必须从下列品牌中**恰好选一个**最匹配的（字符串完全一致）：${brands.join("、")}。
若信息严重不足，选可能性相对最大的一个，confidence 相应降低。

只输出一段 JSON：
{"brand":"品牌名","models":[],"confidence":0.35,"reason":"不超过40字"}`;

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: JSON.stringify({
          carModel: carModel || "",
          remark: remark || "",
        }),
      },
    ],
    temperature,
    response_format: { type: "json_object" },
  });
  const raw = completion.choices[0]?.message?.content?.trim() || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { brand: null, models: [], confidence: 0, reason: "parse_fail", source: "llm" };
  }
  const b = normalizeBrandName(parsed.brand, brands);
  return {
    brand: b,
    models: Array.isArray(parsed.models) ? parsed.models : [],
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    reason: String(parsed.reason || ""),
    source: "llm",
  };
}

function normCityToken(s) {
  return String(s || "")
    .trim()
    .replace(/特别行政区$/, "")
    .replace(/市$|省$|自治区$|州$|区$|县$/u, "")
    .toLowerCase();
}

function storesOfBrand(stores, brand) {
  return stores.filter(
    (s) => s.brand === brand && typeof s.lat === "number" && typeof s.lng === "number"
  );
}

/**
 * @param {object} opts
 * @param {object[]} opts.stores
 * @param {string} opts.brand
 * @param {number|undefined} opts.userLat
 * @param {number|undefined} opts.userLng
 * @param {string|undefined} opts.userCity
 */
function pickNearestStore({ stores, brand, userLat, userLng, userCity }) {
  const list = storesOfBrand(stores, brand);
  if (list.length === 0) {
    return { store: null, method: "no_store", distanceKm: null };
  }

  const hasGeo =
    typeof userLat === "number" &&
    typeof userLng === "number" &&
    !Number.isNaN(userLat) &&
    !Number.isNaN(userLng);

  if (hasGeo) {
    let best = null;
    let bestD = Infinity;
    for (const s of list) {
      const d = haversineKm(userLat, userLng, s.lat, s.lng);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return { store: best, method: "geo", distanceKm: Math.round(bestD * 10) / 10 };
  }

  if (userCity) {
    const u = normCityToken(userCity);
    const inCity = list.filter((s) => {
      const c = normCityToken(s.city);
      if (!u || !c) return false;
      return c === u || c.includes(u) || u.includes(c);
    });
    const pool = inCity.length ? inCity : list;
    const pick = pool[0];
    return { store: pick, method: inCity.length ? "city" : "fallback_city", distanceKm: null };
  }

  return { store: list[0], method: "brand_default", distanceKm: null };
}

module.exports = {
  listBrandsFromCatalog,
  haversineKm,
  inferBrandKeyword,
  inferBrandWithLLM,
  pickNearestStore,
  normalizeBrandName,
};
