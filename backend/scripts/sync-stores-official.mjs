import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, "..");
const outputPath = path.join(backendDir, "stores.json");

const PAGE_URL = "https://www.xiaopeng.com/pengmetta.html";
const STORE_API_URL = "https://www.xiaopeng.com/api/store/queryAll";
const CITY_API_URL = "https://www.xiaopeng.com/api/city/queryAllProvinceAndCity";

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function normalizeRegionName(value) {
  return String(value || "")
    .trim()
    .replace(/特别行政区|自治区|自治州|地区|盟/g, "")
    .replace(/[省市区县]/g, "");
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeType(store) {
  const types = [];
  if (store?.isExperienceCenter) types.push("体验中心");
  if (store?.isServiceCenter) types.push("服务中心");
  if (store?.isDeliverCenter) types.push("交付中心");
  return types.length ? types.join(" / ") : "门店";
}

function normalizeServices(store) {
  const services = [];
  if (store?.isExperienceCenter) services.push("整车展示", "购车咨询");
  if (store?.reserveStatus) services.push("试驾预约");
  if (store?.isServiceCenter) services.push("售后服务");
  if (store?.isDeliverCenter) services.push("交付服务");
  return uniqueStrings(services);
}

function parseCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildHierarchy(raw) {
  const provinces = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
  return provinces
    .map((province) => {
      const provinceName = normalizeRegionName(province?.name);
      const cities = (Array.isArray(province?.sublist) ? province.sublist : [])
        .map((city) => ({
          name: normalizeRegionName(city?.name),
          cityCode: city?.cityCode ? String(city.cityCode) : null,
        }))
        .filter((city) => city.name);

      if (!provinceName || !cities.length) return null;
      return {
        province: provinceName,
        provinceCode: province?.cityCode ? String(province.cityCode) : null,
        cities,
      };
    })
    .filter(Boolean);
}

async function fetchPageContext() {
  const response = await fetch(PAGE_URL, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "user-agent": "Mozilla/5.0",
    },
  });

  if (!response.ok) {
    throw new Error(`failed to load store page: ${response.status}`);
  }

  const html = await response.text();
  const csrfMatch = html.match(/"csrf":"([^"]+)"/);
  if (!csrfMatch?.[1]) {
    throw new Error("failed to extract csrf token from store page");
  }

  const getSetCookie = response.headers.getSetCookie?.bind(response.headers);
  const cookies = typeof getSetCookie === "function"
    ? getSetCookie().map((value) => value.split(";")[0]).join("; ")
    : "";

  return {
    csrf: csrfMatch[1],
    cookies,
  };
}

async function postOfficialJson(url, body, context) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      "content-type": "application/json",
      origin: "https://www.xiaopeng.com",
      referer: PAGE_URL,
      "x-requested-with": "XMLHttpRequest",
      ...(context.cookies ? { cookie: context.cookies } : {}),
    },
    body: JSON.stringify({
      _csrf: context.csrf,
      ...body,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`request failed ${response.status}: ${text.slice(0, 240)}`);
  }

  const parsed = JSON.parse(text);
  if (parsed?.success === false) {
    throw new Error(parsed?.msg || "official api returned success=false");
  }
  return parsed;
}

function buildStoresPayload(storesResponse, hierarchy, fetchedAt) {
  const rawStores = Array.isArray(storesResponse?.data) ? storesResponse.data : [];
  const stores = rawStores
    .map((store) => {
      const province = normalizeRegionName(store?.provinceName);
      const city = normalizeRegionName(store?.cityName);
      const district = normalizeRegionName(store?.districtName);
      const lat = parseCoordinate(store?.lat);
      const lng = parseCoordinate(store?.lng);
      const storeName = String(store?.storeName || "").trim();
      const address = String(store?.address || "").trim();
      const phone = String(store?.mobile || store?.serviceMobile || "").trim();
      const servicePhone = String(store?.serviceMobile || "").trim();
      if (!storeName || !address) return null;

      return {
        id:
          String(store?.id || "").trim() ||
          `xp-${slugify(`${province}-${city}-${storeName}`)}`,
        brand: "小鹏",
        name: storeName,
        city,
        province,
        district: district || undefined,
        provinceCode: store?.provinceCode ? String(store.provinceCode) : null,
        cityCode: store?.cityCode ? String(store.cityCode) : null,
        districtCode: store?.districtCode ? String(store.districtCode) : null,
        type: normalizeType(store),
        address,
        phone: phone || undefined,
        servicePhone: servicePhone || undefined,
        hours: "请以门店实际接待时间为准",
        services: normalizeServices(store),
        mapQuery: `${storeName} ${address}`.trim(),
        lat: lat ?? undefined,
        lng: lng ?? undefined,
        reserveStatus: store?.reserveStatus ? String(store.reserveStatus) : undefined,
        source_url: PAGE_URL,
        fetched_at: fetchedAt,
        version: fetchedAt.slice(0, 10),
      };
    })
    .filter(Boolean);

  return {
    meta: {
      brand: "小鹏",
      version: fetchedAt.slice(0, 10),
      fetched_at: fetchedAt,
      source_url: PAGE_URL,
      disclaimer:
        "本数据同步自小鹏官网公开门店接口，用于就近门店匹配与预约演示。门店营业状态、电话和接待能力请以官网与门店最新信息为准。",
      officialLocator: PAGE_URL,
      officialAppointment: "https://www.xiaopeng.com/appointment.html",
      serviceHotline: "400-783-6688",
      locationHierarchy: hierarchy,
      counts: {
        provinces: hierarchy.length,
        cities: hierarchy.reduce((total, item) => total + item.cities.length, 0),
        stores: stores.length,
      },
      brandAppointmentLinks: {
        小鹏: "https://www.xiaopeng.com/appointment.html",
      },
    },
    stores,
  };
}

async function main() {
  const context = await fetchPageContext();
  const fetchedAt = new Date().toISOString();
  const [storesResponse, citiesResponse] = await Promise.all([
    postOfficialJson(STORE_API_URL, { lat: "", lng: "" }, context),
    postOfficialJson(CITY_API_URL, {}, context),
  ]);

  const hierarchy = buildHierarchy(citiesResponse);
  const payload = buildStoresPayload(storesResponse, hierarchy, fetchedAt);

  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(
    `[sync-stores-official] wrote ${payload.stores.length} stores across ${payload.meta.counts.cities} cities to ${outputPath}`
  );
}

main().catch((error) => {
  console.error("[sync-stores-official] failed:", error);
  process.exitCode = 1;
});
