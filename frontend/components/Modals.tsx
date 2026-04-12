"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchGeocodeCity, fetchRights, fetchStores, submitTestDrive } from "@/lib/api";
import type {
  CrmLeadPayload,
  CrmSyncState,
  RightsItem,
  RightsMeta,
  RoutedStore,
  StoreItem,
  StoreMeta,
  TestDriveRouting,
} from "@/lib/types";

function mapOpenUrl(store: StoreItem | RoutedStore): string {
  const query = encodeURIComponent(store.mapQuery || `${store.name} ${store.address}`);
  return `https://www.amap.com/search?query=${query}`;
}

type ProvinceCityPreset = {
  province: string;
  cities: string[];
};

type StoreMetaHierarchyCity = {
  name?: string | null;
  cityCode?: string | null;
};

type StoreMetaHierarchyProvince = {
  province?: string | null;
  name?: string | null;
  provinceCode?: string | null;
  cities?: StoreMetaHierarchyCity[] | null;
};

const LOCATION_PRESETS: ProvinceCityPreset[] = [
  { province: "北京", cities: ["北京"] },
  { province: "上海", cities: ["上海"] },
  { province: "天津", cities: ["天津"] },
  { province: "重庆", cities: ["重庆"] },
  { province: "广东", cities: ["广州", "深圳", "佛山", "东莞", "珠海", "中山", "惠州", "汕头"] },
  { province: "江苏", cities: ["南京", "苏州", "无锡", "常州", "南通", "徐州"] },
  { province: "浙江", cities: ["杭州", "宁波", "温州", "嘉兴", "绍兴", "金华"] },
  { province: "山东", cities: ["济南", "青岛", "烟台", "潍坊", "临沂", "淄博"] },
  { province: "四川", cities: ["成都", "绵阳", "德阳", "南充", "宜宾"] },
  { province: "湖北", cities: ["武汉", "襄阳", "宜昌", "黄石"] },
  { province: "陕西", cities: ["西安", "咸阳", "宝鸡", "榆林"] },
  { province: "河南", cities: ["郑州", "洛阳", "开封", "许昌"] },
  { province: "湖南", cities: ["长沙", "株洲", "湘潭", "岳阳"] },
  { province: "福建", cities: ["福州", "厦门", "泉州", "漳州"] },
  { province: "安徽", cities: ["合肥", "芜湖", "马鞍山", "阜阳"] },
  { province: "江西", cities: ["南昌", "赣州", "九江", "上饶"] },
  { province: "河北", cities: ["石家庄", "唐山", "保定", "廊坊"] },
  { province: "山西", cities: ["太原", "大同", "运城", "长治"] },
  { province: "辽宁", cities: ["沈阳", "大连", "鞍山", "营口"] },
  { province: "吉林", cities: ["长春", "吉林", "延边", "四平"] },
  { province: "黑龙江", cities: ["哈尔滨", "齐齐哈尔", "牡丹江", "大庆"] },
  { province: "广西", cities: ["南宁", "柳州", "桂林", "北海"] },
  { province: "云南", cities: ["昆明", "曲靖", "大理", "玉溪"] },
  { province: "贵州", cities: ["贵阳", "遵义", "六盘水", "安顺"] },
  { province: "海南", cities: ["海口", "三亚", "儋州"] },
  { province: "内蒙古", cities: ["呼和浩特", "包头", "鄂尔多斯", "赤峰"] },
  { province: "甘肃", cities: ["兰州", "天水", "酒泉", "嘉峪关"] },
  { province: "宁夏", cities: ["银川", "石嘴山", "吴忠"] },
  { province: "青海", cities: ["西宁", "海东"] },
  { province: "新疆", cities: ["乌鲁木齐", "克拉玛依", "库尔勒", "伊宁"] },
  { province: "西藏", cities: ["拉萨", "日喀则", "林芝"] },
  { province: "香港", cities: ["香港"] },
  { province: "澳门", cities: ["澳门"] },
  { province: "台湾", cities: ["台北", "新北", "台中", "高雄"] },
];

const PURCHASE_STAGES = ["首次购车", "换购升级", "家庭增购", "商务用途"];
const BUY_TIMELINES = ["一周内", "一个月内", "1 到 3 个月", "先了解一下"];

function normalizeCityNameSafe(raw: string | null | undefined): string {
  return String(raw || "")
    .trim()
    .replace(/Special Administrative Region|Autonomous Region|Autonomous Prefecture|Region|League/gi, "")
    .replace(/Municipal District/gi, "")
    .replace(/(City|District|County)$/gi, "")
    .replace(/(市|地区|盟|自治州|区|县)$/g, "");
}

function normalizeProvinceNameSafe(raw: string | null | undefined): string {
  return String(raw || "")
    .trim()
    .replace(/Special Administrative Region|Autonomous Region|Autonomous Prefecture|Region|League|Province/gi, "")
    .replace(/(省|市|自治区|特别行政区)$/g, "")
    .replace(/(省|市|自治区|特别行政区)$/g, "");
}

function normalizeDistrictNameSafe(raw: string | null | undefined): string {
  return String(raw || "")
    .trim()
    .replace(/(District|County)$/gi, "")
    .replace(/(区|县|市)$/g, "")
    .replace(/\s+/g, "");
}

function normalizeProvinceTokenSafe(raw: string | null | undefined): string {
  return normalizeProvinceNameSafe(raw).replace(/(省|市|自治区|特别行政区)$/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sortZh(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function normalizeMetaLocationHierarchy(
  raw: unknown
): ProvinceCityPreset[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => {
      const provinceItem = item as StoreMetaHierarchyProvince;
      const province = normalizeProvinceTokenSafe(provinceItem.province || provinceItem.name);
      const cities = sortZh(
        (Array.isArray(provinceItem.cities) ? provinceItem.cities : [])
          .map((city) => normalizeCityNameSafe(city?.name))
          .filter(Boolean)
      );

      if (!province || !cities.length) return null;
      return { province, cities };
    })
    .filter((item): item is ProvinceCityPreset => Boolean(item));
}

function extractDistrictFromAddress(
  address: string | null | undefined,
  province: string | null | undefined,
  city: string | null | undefined
): string | null {
  let remaining = String(address || "").trim();
  for (const segment of [province, city]) {
    const normalized = normalizeProvinceTokenSafe(segment);
    if (!normalized) continue;
    remaining = remaining.replace(new RegExp(escapeRegExp(normalized), "g"), "");
  }
  remaining = remaining.replace(/^[省市]/, "");
  const match = remaining.match(/([\u4e00-\u9fa5]{1,12}(?:自治县|自治州|新区|开发区|高新区|区|县|旗|市))/);
  if (!match) return null;
  const district = normalizeDistrictNameSafe(match[1]);
  if (!district || district === normalizeDistrictNameSafe(city) || district === normalizeDistrictNameSafe(province)) {
    return null;
  }
  return district;
}

function useEscape(close: () => void, open: boolean) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);
}

function leadStageLabel(stage: string | undefined) {
  if (stage === "handoff_ready") return "演示待处理";
  if (stage === "qualified") return "演示信息已完善";
  if (stage === "captured") return "演示已记录";
  return "演示处理中";
}

function priorityLabel(priority: string | undefined) {
  if (priority === "hot") return "高意向";
  if (priority === "warm") return "中意向";
  if (priority === "nurture") return "持续跟进";
  return "待确认";
}

function priorityTone(priority: string | undefined) {
  if (priority === "hot") return "border-rose-200 bg-rose-50 text-rose-900";
  if (priority === "warm") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-sky-200 bg-sky-50 text-sky-900";
}

function channelLabel(channel: string | undefined) {
  if (channel === "phone") return "电话";
  if (channel === "wechat") return "企业微信";
  return channel || "待确认";
}

function formatDistance(method: string, distanceKm: number | null | undefined) {
  if (distanceKm == null) return null;
  return method === "amap_driving" ? `驾车约 ${distanceKm} 公里` : `直线距离约 ${distanceKm} 公里`;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatGeoCoordinateLabel(lat: number, lng: number) {
  return `定位坐标：${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function pickNearestStoreByCoords(stores: StoreItem[], lat: number, lng: number): StoreItem | null {
  let nearest: StoreItem | null = null;
  let minDistance = Number.POSITIVE_INFINITY;

  for (const store of stores) {
    if (store.lat == null || store.lng == null) continue;
    const distance = haversineKm(lat, lng, store.lat, store.lng);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = store;
    }
  }

  return nearest;
}

function routingMethodLabel(method: string | undefined, hasGeo: boolean) {
  if (method === "amap_driving") return "已按驾车时间匹配最近门店";
  if (method === "geo") return "已按定位直线距离匹配最近门店";
  if (method === "city") return "已按城市优先匹配门店";
  if (method === "fallback_city") return "当前城市暂无精确门店，已回退到同品牌门店";
  if (method === "manual") return "已按你手动选择的门店提交";
  if (hasGeo) return "提交后会按定位匹配最近门店";
  return "提交后会按城市优先匹配门店";
}

function maskPhone(phone: string) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length !== 11) return phone || "--";
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}

function crmSyncLabel(crmSync: CrmSyncState | null) {
  if (!crmSync) return "未排队";
  if (!crmSync.syncEnabled) return "演示已记录";
  if (crmSync.status === "synced") return "演示已同步(mock)";
  if (crmSync.status === "acknowledged") return "演示已回执";
  if (crmSync.status === "sent") return "演示已发送";
  if (crmSync.status === "dead_letter") return "死信";
  if (crmSync.status === "failed") return "演示同步失败";
  if (crmSync.status === "pending") return "待同步";
  return "演示处理中";
}

function crmSyncTone(crmSync: CrmSyncState | null) {
  if (!crmSync) return "border-ink-200 bg-white text-ink-700";
  if (!crmSync.syncEnabled) return "border-sky-200 bg-sky-50 text-sky-900";
  if (crmSync.status === "synced") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (crmSync.status === "acknowledged") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (crmSync.status === "sent") return "border-sky-200 bg-sky-50 text-sky-900";
  if (crmSync.status === "dead_letter") return "border-rose-200 bg-rose-50 text-rose-900";
  if (crmSync.status === "failed") return "border-rose-200 bg-rose-50 text-rose-900";
  return "border-sky-200 bg-sky-50 text-sky-900";
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${tone || "border-ink-200 bg-white text-ink-800"}`}>
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-current/70">{label}</p>
      <p className="mt-1 text-sm font-semibold text-current">{value}</p>
    </div>
  );
}

export function TestDriveModal({
  open,
  onClose,
  carName,
  intent = "test_drive",
}: {
  open: boolean;
  onClose: () => void;
  carName?: string;
  intent?: "test_drive" | "advisor_followup";
}) {
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [meta, setMeta] = useState<StoreMeta | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [storeId, setStoreId] = useState("");
  const [storeSelectionTouched, setStoreSelectionTouched] = useState(false);
  const [remark, setRemark] = useState("");
  const [carModel, setCarModel] = useState("");
  const [purchaseStage, setPurchaseStage] = useState("");
  const [buyTimeline, setBuyTimeline] = useState("");
  const [privacyConsent, setPrivacyConsent] = useState(true);
  const [contactConsent, setContactConsent] = useState(true);
  const [selectedProvince, setSelectedProvince] = useState("");
  const [selectedCity, setSelectedCity] = useState("");
  const [selectedDistrict, setSelectedDistrict] = useState("");
  const [locationDetail, setLocationDetail] = useState("");
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [geoHint, setGeoHint] = useState<string | null>(null);
  const [geoLocation, setGeoLocation] = useState<{
    city: string | null;
    district?: string | null;
    province?: string | null;
    formattedAddress?: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routing, setRouting] = useState<TestDriveRouting | null>(null);
  const [crm, setCrm] = useState<CrmLeadPayload | null>(null);
  const [crmSync, setCrmSync] = useState<CrmSyncState | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const isAdvisorFollowup = intent === "advisor_followup";
  const modalTitle = isAdvisorFollowup ? "顾问跟进" : "预约试驾";
  const modalDescription = isAdvisorFollowup
    ? "留下联系方式后，系统会按你当前车型和城市优先分配顾问，继续跟进这套配置。"
    : "填写联系信息后，我们会结合城市与门店信息，为你生成更顺手的试驾路径。";
  const successTitle = isAdvisorFollowup ? "Demo 顾问跟进需求已记录" : "Demo 预约信息已记录";
  const submitLabel = isAdvisorFollowup ? "提交顾问跟进" : "提交预约";
  const officialActionLabel = isAdvisorFollowup ? "打开官方留资页" : "打开官方预约页";
  const stageLabel = isAdvisorFollowup ? "线索状态" : "预约状态";
  const fallbackDoneMessage = isAdvisorFollowup
    ? "当前仅演示 mock 跟进流程，不会触发真实顾问接单。你可以继续查看门店和权益，或前往官方页面留下正式线索。"
    : "当前仅演示 mock 流程，不会触发真实顾问接单。你可以继续查看门店和权益，或直接前往官方预约页完成真实预约。";

  useEscape(onClose, open);

  useEffect(() => {
    if (!open) return;
    setDone(false);
    setError(null);
    setRouting(null);
    setCrm(null);
    setCrmSync(null);
    setSubmitMessage(null);
    setGeoHint(null);
    setGeoLocation(null);
    setUserLat(null);
    setUserLng(null);
    setStoreSelectionTouched(false);
    setSelectedProvince("");
    setSelectedCity("");
    setSelectedDistrict("");
    setLocationDetail("");
    setPurchaseStage("");
    setBuyTimeline("");
    setPrivacyConsent(true);
    setContactConsent(true);
    setCarModel(carName || "");
  }, [open, carName, intent]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchStores();
        if (cancelled) return;
        setStores(data.stores);
        setMeta(data.meta);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "加载门店列表失败，请稍后重试。");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const resetAndClose = useCallback(() => {
    setName("");
    setPhone("");
    setPreferredTime("");
    setStoreId("");
    setRemark("");
    setCarModel("");
    setStoreSelectionTouched(false);
    setSelectedProvince("");
    setSelectedCity("");
    setSelectedDistrict("");
    setLocationDetail("");
    setPurchaseStage("");
    setBuyTimeline("");
    setPrivacyConsent(true);
    setContactConsent(true);
    setUserLat(null);
    setUserLng(null);
    setGeoHint(null);
    setGeoLocation(null);
    setDone(false);
    setError(null);
    setRouting(null);
    setCrm(null);
    setCrmSync(null);
    setSubmitMessage(null);
    onClose();
  }, [onClose]);

  const locationHierarchy = useMemo(() => {
    const provinceMap = new Map<string, Set<string>>();
    const metaHierarchy = normalizeMetaLocationHierarchy(
      (meta as (StoreMeta & { locationHierarchy?: unknown[] }) | null)?.locationHierarchy
    );

    const append = (provinceRaw: string | null | undefined, cityRaw: string | null | undefined) => {
      const province = normalizeProvinceTokenSafe(provinceRaw || cityRaw);
      const city = normalizeCityNameSafe(cityRaw);
      if (!province) return;
      if (!provinceMap.has(province)) {
        provinceMap.set(province, new Set());
      }
      if (city) {
        provinceMap.get(province)?.add(city);
      }
    };

    if (metaHierarchy.length) {
      metaHierarchy.forEach((item) => {
        item.cities.forEach((city) => append(item.province, city));
      });
    } else {
      LOCATION_PRESETS.forEach((item) => {
        item.cities.forEach((city) => append(item.province, city));
      });
    }
    stores.forEach((store) => append(store.province || store.city, store.city));
    append(geoLocation?.province, geoLocation?.city);

    return sortZh(Array.from(provinceMap.keys())).map((province) => ({
      province,
      cities: sortZh(Array.from(provinceMap.get(province) || [])),
    }));
  }, [meta, stores, geoLocation?.province, geoLocation?.city]);

  const provinceOptions = useMemo(
    () => locationHierarchy.map((item) => item.province),
    [locationHierarchy]
  );

  const cityOptions = useMemo(() => {
    if (!selectedProvince) return [];
    return locationHierarchy.find((item) => item.province === selectedProvince)?.cities || [];
  }, [locationHierarchy, selectedProvince]);

  const districtOptions = useMemo(() => {
    const districts = new Set<string>();

    stores.forEach((store) => {
      const storeProvince = normalizeProvinceTokenSafe(store.province || store.city);
      const storeCity = normalizeCityNameSafe(store.city);
      if (selectedProvince && storeProvince !== selectedProvince) return;
      if (selectedCity && storeCity !== selectedCity) return;
      const district = extractDistrictFromAddress(store.address, store.province || store.city, store.city);
      if (district) {
        districts.add(district);
      }
    });

    const geoProvince = normalizeProvinceTokenSafe(geoLocation?.province);
    const geoCity = normalizeCityNameSafe(geoLocation?.city);
    const geoDistrict = normalizeDistrictNameSafe(geoLocation?.district);
    if (
      geoDistrict &&
      (!selectedProvince || geoProvince === selectedProvince) &&
      (!selectedCity || geoCity === selectedCity)
    ) {
      districts.add(geoDistrict);
    }

    return sortZh(Array.from(districts));
  }, [stores, selectedProvince, selectedCity, geoLocation?.province, geoLocation?.city, geoLocation?.district]);

  useEffect(() => {
    if (!selectedProvince) return;
    if (provinceOptions.includes(selectedProvince)) return;
    setSelectedProvince("");
  }, [provinceOptions, selectedProvince]);

  useEffect(() => {
    if (!selectedCity) return;
    if (cityOptions.includes(selectedCity)) return;
    setSelectedCity("");
    setSelectedDistrict("");
  }, [cityOptions, selectedCity]);

  useEffect(() => {
    if (!selectedDistrict || districtOptions.length === 0) return;
    if (districtOptions.includes(selectedDistrict)) return;
    setSelectedDistrict("");
  }, [districtOptions, selectedDistrict]);

  const resolvedProvince = selectedProvince.trim() || normalizeProvinceTokenSafe(geoLocation?.province);
  const resolvedCity = selectedCity.trim() || normalizeCityNameSafe(geoLocation?.city);
  const resolvedDistrict = selectedDistrict.trim() || normalizeDistrictNameSafe(geoLocation?.district);
  const resolvedLocationDetail = locationDetail.trim() || geoLocation?.formattedAddress?.trim() || "";
  const hasGeo = userLat != null && userLng != null;
  const officialAppointmentUrl =
    routing?.officialAppointmentUrl || meta?.officialAppointment || "https://www.xiaopeng.com/appointment.html";
  const nextActions = routing?.nextBestActions?.length ? routing.nextBestActions : crm?.nextBestActions || [];
  const submittedCity =
    resolvedCity || resolvedProvince || routing?.assignedStore?.city || "待确认";
  const locationSummary = [resolvedProvince, resolvedCity, resolvedDistrict].filter(Boolean).join(" / ");
  const approxStoreDistanceKm = useCallback(
    (store: StoreItem) => {
      if (userLat == null || userLng == null || store.lat == null || store.lng == null) return null;
      return Math.round(haversineKm(userLat, userLng, store.lat, store.lng) * 10) / 10;
    },
    [userLat, userLng]
  );

  const matchedStoreCount = useMemo(() => {
    return stores.filter((store) => {
      const storeProvince = normalizeProvinceTokenSafe(store.province || store.city);
      const storeCity = normalizeCityNameSafe(store.city);
      if (resolvedProvince && storeProvince !== resolvedProvince) return false;
      if (resolvedCity && storeCity !== resolvedCity) return false;
      return true;
    }).length;
  }, [stores, resolvedProvince, resolvedCity]);

  const prioritizedStores = useMemo(() => {
    if (!resolvedProvince && !resolvedCity) {
      if (!hasGeo) return stores;
      return [...stores].sort((a, b) => {
        const aDistanceKm = approxStoreDistanceKm(a);
        const bDistanceKm = approxStoreDistanceKm(b);
        if (aDistanceKm == null && bDistanceKm == null) return 0;
        if (aDistanceKm == null) return 1;
        if (bDistanceKm == null) return -1;
        return aDistanceKm - bDistanceKm;
      });
    }
    const matched: Array<{ store: StoreItem; distanceKm: number | null }> = [];
    const others: StoreItem[] = [];
    stores.forEach((store) => {
      const storeProvince = normalizeProvinceTokenSafe(store.province || store.city);
      const storeCity = normalizeCityNameSafe(store.city);
      const fitsProvince = !resolvedProvince || storeProvince === resolvedProvince;
      const fitsCity = !resolvedCity || storeCity === resolvedCity;
      if (fitsProvince && fitsCity) {
        matched.push({
          store,
          distanceKm: approxStoreDistanceKm(store),
        });
      } else {
        others.push(store);
      }
    });
    matched.sort((a, b) => {
      if (a.distanceKm == null && b.distanceKm == null) return 0;
      if (a.distanceKm == null) return 1;
      if (b.distanceKm == null) return -1;
      return a.distanceKm - b.distanceKm;
    });
    return [...matched.map((item) => item.store), ...others];
  }, [stores, resolvedProvince, resolvedCity, approxStoreDistanceKm, hasGeo]);
  const recommendedStore = prioritizedStores[0] || null;

  useEffect(() => {
    if (!recommendedStore) return;
    if (storeSelectionTouched) return;
    if (!resolvedCity && !hasGeo) return;
    if (storeId === recommendedStore.id) return;
    setStoreId(recommendedStore.id);
  }, [recommendedStore, storeId, resolvedCity, hasGeo, storeSelectionTouched]);

  const requestGeo = () => {
    if (!navigator.geolocation) {
      setGeoHint("当前浏览器不支持定位。");
      return;
    }
    const host = typeof window !== "undefined" ? window.location.hostname : "";
    const isLocal = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
    if (typeof window !== "undefined" && !window.isSecureContext && !isLocal) {
      setGeoHint("除本机环境外，定位功能需要在 HTTPS 下使用。");
      return;
    }
    setGeoHint("正在获取你的位置...");
    setGeoLocation(null);
    setStoreSelectionTouched(false);
    setStoreId("");
    setSelectedProvince("");
    setSelectedCity("");
    setSelectedDistrict("");
    setLocationDetail("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const coordinateLabel = formatGeoCoordinateLabel(lat, lng);
        const nearestStore = pickNearestStoreByCoords(stores, lat, lng);
        const fallbackProvince = normalizeProvinceTokenSafe(nearestStore?.province || nearestStore?.city);
        const fallbackCity = normalizeCityNameSafe(nearestStore?.city);
        const fallbackDistrict = normalizeDistrictNameSafe(
          nearestStore?.district ||
            extractDistrictFromAddress(
              nearestStore?.address,
              nearestStore?.province || nearestStore?.city,
              nearestStore?.city
            )
        );
        setUserLat(lat);
        setUserLng(lng);
        setLocationDetail(coordinateLabel);
        setGeoLocation({
          province: fallbackProvince || null,
          city: fallbackCity || null,
          district: fallbackDistrict || null,
          formattedAddress: coordinateLabel,
        });
        setGeoHint("已获取定位，正在识别城市...");
        fetchGeocodeCity(lat, lng)
          .then((geo) => {
            const provinceName = Array.isArray(geo.province)
              ? null
              : typeof geo.province === "string"
                ? normalizeProvinceTokenSafe(geo.province)
                : null;
            const rawCity =
              typeof geo.city === "string" && geo.city.trim()
                ? geo.city
                : typeof geo.province === "string" && geo.province.trim()
                  ? geo.province
                  : null;
            const raw = rawCity || null;
            const cityName = Array.isArray(raw)
              ? null
              : typeof raw === "string"
                ? normalizeCityNameSafe(raw)
                : null;
            const districtName = Array.isArray(geo.district)
              ? null
              : typeof geo.district === "string"
                ? normalizeDistrictNameSafe(geo.district)
                : null;
            const effectiveProvince = provinceName || fallbackProvince || null;
            const effectiveCity = cityName || fallbackCity || null;
            const effectiveDistrict = districtName || fallbackDistrict || null;
            const detail =
              geo.formattedAddress ||
              [provinceName, cityName, districtName].filter(Boolean).join(" ") ||
              coordinateLabel;
            setGeoLocation({
              ...geo,
              province: effectiveProvince,
              city: effectiveCity,
              district: effectiveDistrict,
              formattedAddress: detail || coordinateLabel,
            });
            if (cityName) {
              if (effectiveProvince) setSelectedProvince(effectiveProvince);
              if (effectiveCity) setSelectedCity(effectiveCity);
              if (effectiveDistrict) setSelectedDistrict(effectiveDistrict);
              if (detail) setLocationDetail(detail);
              setGeoHint(detail ? `已识别位置：${detail}` : `已识别城市：${cityName}`);
            } else {
              if (effectiveProvince) setSelectedProvince(effectiveProvince);
              if (effectiveCity) setSelectedCity(effectiveCity);
              if (effectiveDistrict) setSelectedDistrict(effectiveDistrict);
              if (detail) setLocationDetail(detail);
              setGeoHint(
                effectiveCity
                  ? `已获取定位，暂未识别精确城市，已按最近门店所在城市 ${effectiveCity} 优先匹配。`
                  : "已获取定位，但暂时未能识别城市。"
              );
            }
          })
          .catch(() => {
            setGeoLocation({
              province: fallbackProvince || null,
              city: fallbackCity || null,
              district: fallbackDistrict || null,
              formattedAddress: coordinateLabel,
            });
            if (fallbackProvince) setSelectedProvince(fallbackProvince);
            if (fallbackCity) setSelectedCity(fallbackCity);
            if (fallbackDistrict) setSelectedDistrict(fallbackDistrict);
            setLocationDetail(coordinateLabel);
            setGeoHint(
              fallbackCity
                ? `已获取定位，地址解析失败，已按最近门店所在城市 ${fallbackCity} 优先匹配。`
                : "已获取定位，但地址解析失败。"
            );
          });
      },
      (err) => {
        const messages: Record<number, string> = {
          1: "你拒绝了定位权限。",
          2: "定位服务暂时不可用。",
          3: "定位请求超时，请稍后重试。",
        };
        setGeoLocation(null);
        setGeoHint(messages[err.code] || `定位失败（${err.code}）。`);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-ink-900/50 backdrop-blur-[2px]"
        aria-label="关闭"
        onClick={resetAndClose}
      />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-white/20 bg-white shadow-[0_-20px_60px_-20px_rgba(15,23,42,0.35)] dark:border-slate-600/60 dark:bg-slate-900 sm:rounded-3xl sm:shadow-float">
        <div className="shrink-0 bg-gradient-to-r from-sky-600 to-indigo-600 px-6 py-5 text-white">
          <h2 className="text-lg font-semibold tracking-tight">{modalTitle}</h2>
          <p className="mt-1 text-sm text-white/85">{modalDescription}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {isAdvisorFollowup ? (
            <div className="mb-4 rounded-2xl border border-sky-200 bg-sky-50/80 px-4 py-4 text-sm text-sky-950">
              <p className="font-semibold">顾问跟进</p>
              <p className="mt-2 leading-relaxed">
                会基于你当前车型和配置继续分配顾问，不需要先完成试驾预约。
              </p>
            </div>
          ) : null}
          {done ? (
            <div className="space-y-4 text-sm text-ink-800">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-4">
                <p className="font-semibold text-emerald-950">{successTitle}</p>
                <p className="mt-2 leading-relaxed text-emerald-900/90">
                  {submitMessage || fallbackDoneMessage}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <Metric
                  label={stageLabel}
                  value={leadStageLabel(routing?.leadStage || crm?.stage)}
                  tone="border-sky-200 bg-sky-50 text-sky-900"
                />
                <Metric
                  label="跟进进度"
                  value={crmSyncLabel(crmSync)}
                  tone={crmSyncTone(crmSync)}
                />
                <Metric
                  label="到店安排"
                  value={routing?.assignedStore ? "已推荐门店" : "建议前往官方预约"}
                  tone={priorityTone(routing?.leadPriority || crm?.priority)}
                />
              </div>
              {!isAdvisorFollowup && nextActions.length ? (
                <section className="hidden rounded-2xl border border-ink-100 bg-white/80 p-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-500">
                    建议下一步
                  </p>
                  <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-700">
                    {nextActions.map((item) => (
                      <li key={item} className="rounded-xl bg-ink-50/80 px-3 py-2">
                        {item}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <div className="grid gap-4 lg:grid-cols-2">
                <section className="rounded-2xl border border-ink-100 bg-white/80 p-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-500">
                    演示分配（mock）
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-ink-500">
                    下面信息仅用于展示演示链路，不代表真实顾问已接单或已接入内部 CRM。
                  </p>
                  {routing?.advisor ? (
                    <div className="mt-3 space-y-3">
                      <div>
                        <p className="text-base font-semibold text-ink-900">
                          {routing.advisor.name}
                          <span className="ml-2 text-sm font-medium text-ink-500">{routing.advisor.title}</span>
                        </p>
                        <p className="mt-1 text-sm text-ink-600">
                          {routing.advisor.team} · {routing.advisor.city || "待确认"} ·{" "}
                          {routing.advisor.brand || routing.inferredBrand}
                        </p>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Metric
                          label="联系渠道"
                          value={channelLabel(routing.advisor.channel)}
                          tone="border-ink-200 bg-ink-50 text-ink-900"
                        />
                        <Metric
                          label="服务城市"
                          value={routing.advisor.city || "待确认"}
                          tone="border-ink-200 bg-ink-50 text-ink-900"
                        />
                      </div>
                      {routing.advisor.phone ? (
                        <a
                          href={`tel:${routing.advisor.phone.replace(/\s|-/g, "")}`}
                          className="inline-flex rounded-xl bg-ink-900 px-3 py-2 text-xs font-semibold text-white"
                        >
                          查看演示顾问信息 {routing.advisor.phone}
                        </a>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm leading-relaxed text-ink-600">
                      当前未匹配到演示顾问信息。真实预约请直接前往官方预约页。
                    </p>
                  )}
                </section>
                <section className="rounded-2xl border border-ink-100 bg-white/80 p-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-500">
                    推荐门店
                  </p>
                  {routing?.assignedStore ? (
                    <div className="mt-3 space-y-3">
                      <div className="rounded-xl border border-sky-100 bg-sky-50/80 px-3 py-2 text-[11px] leading-5 text-sky-900">
                        {routingMethodLabel(routing.method, userLat != null && userLng != null)}
                      </div>
                      <div>
                        <p className="text-base font-semibold text-ink-900">
                          {routing.assignedStore.brand ? `${routing.assignedStore.brand} · ` : ""}
                          {routing.assignedStore.name}
                        </p>
                        <p className="mt-1 text-sm text-ink-600">{routing.assignedStore.address}</p>
                        <p className="mt-2 text-xs text-ink-500">
                          {formatDistance(routing.method, routing.distanceKm) || "已生成到店路线建议"}
                          {routing.drivingDurationMin != null ? ` · 预计 ${routing.drivingDurationMin} 分钟车程` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {routing.assignedStore.phone ? (
                          <a
                            href={`tel:${routing.assignedStore.phone.replace(/\s|-/g, "")}`}
                            className="inline-flex rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
                          >
                            联系门店
                          </a>
                        ) : null}
                        <a
                          href={mapOpenUrl(routing.assignedStore)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex rounded-xl bg-ink-900 px-3 py-2 text-xs font-semibold text-white"
                        >
                          打开地图
                        </a>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm leading-relaxed text-ink-600">
                      暂时还没有匹配到具体门店，你可以继续在官方预约页完成试驾登记。
                    </p>
                  )}
                </section>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <section className="rounded-2xl border border-ink-100 bg-white/80 p-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-500">权益信息</p>
                  <p className="mt-3 text-sm leading-relaxed text-ink-700">
                    {false && routing?.matchedRightsTitle
                      ? `当前匹配权益：${routing?.matchedRightsTitle}`
                      : "暂时没有匹配到具体权益，建议以官方页面和门店实际信息为准。"}
                  </p>
                </section>
                <section className="rounded-2xl border border-ink-100 bg-white/80 p-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-500">你提交的信息</p>
                  <div className="mt-3 space-y-1.5 text-sm text-ink-700">
                    <p>
                      <span className="font-semibold text-ink-900">姓名：</span>
                      {name || "--"}
                    </p>
                    <p>
                      <span className="font-semibold text-ink-900">手机号：</span>
                      {maskPhone(phone)}
                    </p>
                    <p>
                      <span className="font-semibold text-ink-900">所在城市：</span>
                      {submittedCity}
                    </p>
                    <p>
                      <span className="font-semibold text-ink-900">意向车型：</span>
                      {carModel || carName || "待确认"}
                    </p>
                    <p>
                      <span className="font-semibold text-ink-900">方便到店时间：</span>
                      {preferredTime || "待补充"}
                    </p>
                    {remark ? (
                      <p>
                        <span className="font-semibold text-ink-900">补充说明：</span>
                        {remark}
                      </p>
                    ) : null}
                  </div>
                  {crm ? (
                    <div className="mt-3 space-y-1.5 text-sm text-ink-700">
                      <p>
                        <span className="font-semibold text-ink-900">演示编号：</span>
                        {crm.externalLeadId}
                      </p>
                      {crmSync ? (
                        <p>
                          <span className="font-semibold text-ink-900">演示同步状态：</span>
                          {crmSyncLabel(crmSync)}
                          {crmSync.lastHttpStatus != null ? ` (${crmSync.lastHttpStatus})` : ""}
                        </p>
                      ) : null}
                      {crmSync?.lastError ? (
                        <p>
                          <span className="font-semibold text-ink-900">最近异常：</span>
                          {crmSync.lastError}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <a
                  href={officialAppointmentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-1 items-center justify-center rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  {officialActionLabel}
                </a>
                <button
                  type="button"
                  onClick={resetAndClose}
                  className="flex flex-1 items-center justify-center rounded-xl border border-emerald-300 py-3 text-sm font-medium text-emerald-900 hover:bg-white/60"
                >
                  关闭
                </button>
              </div>
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={async (event) => {
                event.preventDefault();
                setError(null);
                if (!storeId && !hasGeo && !resolvedCity) {
                  setError("请选择城市，或直接使用定位。");
                  return;
                }
                if (!privacyConsent) {
                  setError("请先勾选隐私授权后再提交。");
                  return;
                }
                setLoading(true);
                try {
                  const result = await submitTestDrive({
                    name,
                    phone,
                    preferredTime,
                    carModel: carModel || carName,
                    storeId: storeId || undefined,
                    remark: [isAdvisorFollowup ? "意图：顾问跟进" : "", remark].filter(Boolean).join("；"),
                    purchaseStage: purchaseStage || undefined,
                    buyTimeline: buyTimeline || undefined,
                    privacyConsent,
                    contactConsent,
                    userCity: resolvedCity || undefined,
                    userLat: hasGeo ? userLat ?? undefined : undefined,
                    userLng: hasGeo ? userLng ?? undefined : undefined,
                  });
                  setRouting(result.routing || null);
                  setCrm(result.crm || null);
                  setCrmSync(result.crmSync || null);
                  setSubmitMessage(result.message || null);
                  setDone(true);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "提交失败，请稍后再试。");
                } finally {
                  setLoading(false);
                }
              }}
            >
              {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
              <div>
                <label className="text-xs font-semibold text-ink-500">姓名</label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  placeholder="请输入你的姓名"
                  maxLength={50}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-ink-500">手机号</label>
                <input
                  required
                  type="tel"
                  inputMode="numeric"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
                  className="mt-1.5 w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  placeholder="请输入 11 位手机号"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-ink-500">意向车型</label>
                <input
                  value={carModel}
                  onChange={(e) => setCarModel(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  placeholder="例如：小鹏 G6 / 小鹏 G9"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-ink-500">购车阶段</label>
                  <select
                    value={purchaseStage}
                    onChange={(e) => setPurchaseStage(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  >
                    <option value="">请选择</option>
                    {PURCHASE_STAGES.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink-500">预计购车时间</label>
                  <select
                    value={buyTimeline}
                    onChange={(e) => setBuyTimeline(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  >
                    <option value="">请选择</option>
                    {BUY_TIMELINES.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="overflow-hidden rounded-2xl border border-sky-200/70 bg-[radial-gradient(circle_at_top_left,_rgba(125,211,252,0.22),_transparent_38%),linear-gradient(135deg,rgba(240,249,255,0.95),rgba(255,255,255,0.96))]">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-sky-100/80 px-4 py-3">
                  <div>
                    <p className="text-xs font-semibold text-ink-700">城市与定位</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
                      按省 / 市 / 区 / 具体位置补全信息，定位成功后会直接写入这块选择区。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={requestGeo}
                    className="inline-flex items-center rounded-xl border border-sky-300 bg-white px-3 py-2 text-xs font-semibold text-sky-800 shadow-sm transition hover:-translate-y-0.5 hover:bg-sky-50"
                  >
                    使用定位
                  </button>
                </div>
                <div className="grid gap-3 px-4 py-4 lg:grid-cols-[1.35fr_0.95fr]">
                  <div className="space-y-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-500">
                          省份
                        </label>
                        <select
                          value={selectedProvince}
                          onChange={(e) => {
                            setSelectedProvince(e.target.value);
                            setSelectedCity("");
                            setSelectedDistrict("");
                            setStoreSelectionTouched(false);
                            setStoreId("");
                          }}
                          className="mt-1.5 w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                        >
                          <option value="">请选择省份</option>
                          {provinceOptions.map((province) => (
                            <option key={province} value={province}>
                              {province}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-500">
                          城市
                        </label>
                        <select
                          value={selectedCity}
                          onChange={(e) => {
                            setSelectedCity(e.target.value);
                            setSelectedDistrict("");
                            setStoreSelectionTouched(false);
                            setStoreId("");
                          }}
                          disabled={!selectedProvince}
                          className="mt-1.5 w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-400"
                        >
                          <option value="">{selectedProvince ? "请选择城市" : "请先选择省份"}</option>
                          {cityOptions.map((city) => (
                            <option key={city} value={city}>
                              {city}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-500">
                          区 / 县
                        </label>
                        {districtOptions.length ? (
                          <select
                            value={selectedDistrict}
                            onChange={(e) => setSelectedDistrict(e.target.value)}
                            className="mt-1.5 w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                          >
                            <option value="">请选择区县</option>
                            {districtOptions.map((district) => (
                              <option key={district} value={district}>
                                {district}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            value={selectedDistrict}
                            onChange={(e) => setSelectedDistrict(e.target.value)}
                            className="mt-1.5 w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                            placeholder="例如：天河区 / 朝阳区"
                          />
                        )}
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-500">
                          具体位置
                        </label>
                        <input
                          value={locationDetail}
                          onChange={(e) => setLocationDetail(e.target.value)}
                          className="mt-1.5 w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                          placeholder="例如：珠江新城附近 / 公司楼下"
                        />
                      </div>
                    </div>
                    {geoHint ? <p className="text-[11px] text-sky-800/90">{geoHint}</p> : null}
                  </div>
                  <div className="rounded-2xl border border-white/80 bg-white/90 p-4 shadow-[0_16px_40px_-24px_rgba(14,116,144,0.35)] backdrop-blur">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink-500">
                        当前选择
                      </p>
                      {geoLocation ? (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-semibold text-emerald-800">
                          已同步定位
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm font-semibold leading-relaxed text-ink-900">
                      {locationSummary || "请选择省 / 市 / 区"}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-ink-500">
                      {resolvedLocationDetail || "定位成功后，这里会直接显示你的详细位置，并用于优先匹配附近门店。"}
                    </p>
                    <div className="mt-3 rounded-xl border border-sky-100 bg-sky-50/80 px-3 py-2 text-[11px] leading-5 text-sky-900">
                      {routingMethodLabel(undefined, hasGeo)}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-medium text-sky-800">
                        {matchedStoreCount} 家可参考门店
                      </span>
                      {resolvedCity ? (
                        <span className="rounded-full bg-ink-100 px-2.5 py-1 text-[11px] font-medium text-ink-700">
                          {resolvedCity}
                        </span>
                      ) : null}
                      {resolvedDistrict ? (
                        <span className="rounded-full bg-ink-100 px-2.5 py-1 text-[11px] font-medium text-ink-700">
                          {resolvedDistrict}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs font-semibold text-ink-500">意向门店（选填）</label>
                  {(resolvedProvince || resolvedCity) && matchedStoreCount > 0 ? (
                    <span className="text-[11px] font-medium text-sky-700">已按你的位置优先排序</span>
                  ) : null}
                </div>
                {recommendedStore ? (
                  <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50/80 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-sky-700">
                          系统优先分配门店
                        </p>
                        <p className="mt-2 text-base font-semibold text-ink-900">
                          {recommendedStore.brand ? `${recommendedStore.brand} · ` : ""}
                          {recommendedStore.name}
                        </p>
                        <p className="mt-1 text-sm leading-6 text-ink-600">{recommendedStore.address}</p>
                      </div>
                      <div className="rounded-xl border border-white/70 bg-white/90 px-3 py-2 text-right">
                        <p className="text-[11px] font-semibold text-sky-700">
                          {hasGeo ? "按定位优先匹配" : "按城市优先匹配"}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-ink-900">
                          {approxStoreDistanceKm(recommendedStore) != null
                            ? `约 ${approxStoreDistanceKm(recommendedStore)} km`
                            : recommendedStore.city}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-sky-900">
                      <span className="rounded-full bg-white px-3 py-1.5">
                        {routingMethodLabel(undefined, hasGeo)}
                      </span>
                      {recommendedStore.phone ? (
                        <a
                          href={`tel:${recommendedStore.phone.replace(/\s|-/g, "")}`}
                          className="rounded-full bg-white px-3 py-1.5 font-semibold text-sky-800"
                        >
                          {recommendedStore.phone}
                        </a>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <select
                  value={storeId}
                  onChange={(e) => {
                    const nextStoreId = e.target.value;
                    setStoreId(nextStoreId);
                    setStoreSelectionTouched(Boolean(nextStoreId));
                  }}
                  className="mt-1.5 w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                >
                  <option value="">让系统为我推荐门店</option>
                  {prioritizedStores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.brand ? `${store.brand} · ` : ""}
                      {store.province ? `${store.province} · ` : ""}
                      {store.city} · {store.name}
                      {approxStoreDistanceKm(store) != null ? ` · 约 ${approxStoreDistanceKm(store)}km` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-ink-500">方便到店时间</label>
                <input
                  value={preferredTime}
                  onChange={(e) => setPreferredTime(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  placeholder="例如：周六下午 / 工作日晚上"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-ink-500">补充说明</label>
                <textarea
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  rows={2}
                  className="mt-1.5 w-full resize-none rounded-xl border border-ink-200 px-3 py-2.5 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  placeholder="例如：是否置换、是否家充、最想体验哪些功能"
                  maxLength={500}
                />
              </div>
              <div className="rounded-xl border border-ink-100 bg-ink-50/70 p-3">
                <label className="flex items-start gap-2 text-xs leading-relaxed text-ink-700">
                  <input
                    type="checkbox"
                    checked={privacyConsent}
                    onChange={(e) => setPrivacyConsent(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-ink-300 text-sky-600 focus:ring-sky-500"
                  />
                  <span>我同意将以上信息用于试驾预约、顾问联系和后续服务沟通。</span>
                </label>
                <label className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-ink-600">
                  <input
                    type="checkbox"
                    checked={contactConsent}
                    onChange={(e) => setContactConsent(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-ink-300 text-sky-600 focus:ring-sky-500"
                  />
                  <span>我同意通过电话或短信接收后续联系。</span>
                </label>
              </div>
              <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={resetAndClose}
                  className="rounded-xl border border-ink-200 px-4 py-2.5 text-sm font-medium text-ink-600 hover:bg-ink-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-xl bg-ink-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-ink-800 disabled:opacity-50"
                >
                  {loading ? "提交中..." : submitLabel}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export function StoreModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [meta, setMeta] = useState<StoreMeta | null>(null);
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [city, setCity] = useState("");

  useEscape(onClose, open);
  useEffect(() => {
    if (!open) return;
    setSearch("");
    setCity("");
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const data = await fetchStores();
        if (cancelled) return;
        setMeta(data.meta);
        setStores(data.stores);
      } catch (error) {
        if (!cancelled) {
          setErr(error instanceof Error ? error.message : "门店信息加载失败，请稍后再试。");
          setStores([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const cities = useMemo(() => {
    const set = new Set(stores.map((store) => store.city).filter(Boolean));
    return Array.from(set).sort();
  }, [stores]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return stores.filter((store) => {
      if (city && store.city !== city) return false;
      if (!q) return true;
      const blob = [
        store.brand,
        store.name,
        store.city,
        store.province,
        store.address,
        store.type,
        ...(store.services || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [stores, search, city]);

  if (!open) return null;

  const hotline = meta?.serviceHotline || "400-783-6688";
  const locator = meta?.officialLocator || "https://www.xiaopeng.com/";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-ink-900/50 backdrop-blur-[2px]"
        aria-label="关闭"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-white/20 bg-white shadow-float dark:border-slate-600/60 dark:bg-slate-900 sm:rounded-3xl">
        <div className="shrink-0 border-b border-ink-100 bg-gradient-to-br from-slate-50 to-white px-6 py-5">
          <h2 className="text-lg font-semibold text-ink-900">门店与体验中心</h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-500">
            {meta?.disclaimer || "门店信息仅作咨询与预约参考，请以官方页面和门店实际接待情况为准。"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={locator}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700"
            >
              官方门店入口
            </a>
            <a
              href={`tel:${hotline.replace(/-/g, "")}`}
              className="inline-flex items-center rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-800 hover:bg-ink-50"
            >
              服务热线 {hotline}
            </a>
          </div>
        </div>
        <div className="shrink-0 space-y-3 border-b border-ink-100 px-6 py-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索城市、门店名称、地址或服务类型"
            className="w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
          />
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setCity("")}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                !city ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-600 hover:bg-ink-200"
              }`}
            >
              全部
            </button>
            {cities.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setCity(item === city ? "" : item)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  city === item
                    ? "bg-ink-900 text-white"
                    : "bg-ink-100 text-ink-600 hover:bg-ink-200"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <p className="py-12 text-center text-sm text-ink-500">门店信息加载中...</p>
          ) : err ? (
            <p className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{err}</p>
          ) : filtered.length === 0 ? (
            <p className="py-12 text-center text-sm text-ink-500">没有找到匹配的门店。</p>
          ) : (
            <ul className="space-y-3">
              {filtered.map((store) => (
                <li
                  key={store.id}
                  className="rounded-2xl border border-ink-100 bg-ink-50/40 p-4 transition hover:border-sky-200 hover:bg-sky-50/30"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        {store.brand ? (
                          <span className="rounded-md bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-800">
                            {store.brand}
                          </span>
                        ) : null}
                        <p className="font-semibold text-ink-900">{store.name}</p>
                      </div>
                      <p className="mt-0.5 text-xs text-ink-500">
                        {store.province ? `${store.province} · ` : ""}
                        {store.city}
                        {store.type ? ` · ${store.type}` : ""}
                      </p>
                    </div>
                    {store.phone ? (
                      <a
                        href={`tel:${store.phone.replace(/\s|-/g, "")}`}
                        className="shrink-0 rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-sky-700 ring-1 ring-sky-200 hover:bg-sky-50"
                      >
                        致电门店
                      </a>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-ink-700">{store.address}</p>
                  {store.hours ? <p className="mt-1 text-xs text-ink-500">营业时间：{store.hours}</p> : null}
                  {store.services?.length ? (
                    <p className="mt-2 text-[11px] text-ink-500">{store.services.join(" · ")}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a
                      href={mapOpenUrl(store)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink-800"
                    >
                      打开地图
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="shrink-0 border-t border-ink-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl bg-ink-100 py-2.5 text-sm font-semibold text-ink-800 hover:bg-ink-200"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

export function OfferModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [meta, setMeta] = useState<RightsMeta | null>(null);
  const [items, setItems] = useState<RightsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEscape(onClose, open);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const data = await fetchRights();
        if (cancelled) return;
        setMeta(data.meta || null);
        setItems(Array.isArray(data.items) ? data.items : []);
      } catch (error) {
        if (!cancelled) {
          setErr(error instanceof Error ? error.message : "权益信息加载失败，请稍后再试。"
          );
          setMeta(null);
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const sourceUrl = meta?.source_url || "https://www.xiaopeng.com/";
  const snapshotMeta = [meta?.version ? `版本 ${meta.version}` : null, meta?.fetched_at ? `快照 ${meta.fetched_at.slice(0, 10)}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-ink-900/50 backdrop-blur-[2px]"
        aria-label="关闭"
        onClick={onClose}
      />
      <div className="relative z-10 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl border border-amber-200/80 bg-gradient-to-br from-amber-50 via-white to-orange-50/50 p-6 shadow-float dark:border-amber-800/50 dark:from-amber-950/40 dark:via-slate-900 dark:to-orange-950/30">
        <h2 className="text-lg font-semibold text-amber-950">购车权益与活动（公开快照）</h2>
        <p className="mt-3 text-sm leading-relaxed text-amber-950/85">
          {meta?.disclaimer ||
            "金融方案、置换补贴和阶段性活动变化较快。本 demo 展示的是公开网页抓取快照整理，实际以官方页面和门店政策为准。"}
        </p>
        {snapshotMeta ? <p className="mt-2 text-xs text-amber-900/80">{snapshotMeta}</p> : null}

        <div className="mt-5 space-y-3">
          {loading ? (
            <p className="rounded-2xl border border-amber-200 bg-white/80 px-4 py-4 text-sm text-amber-900">
              权益信息加载中...
            </p>
          ) : err ? (
            <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-900">
              {err}
            </p>
          ) : items.length ? (
            <ul className="space-y-2">
              {items.slice(0, 6).map((item) => (
                <li key={item.id} className="rounded-2xl border border-amber-200/70 bg-white/85 px-4 py-3">
                  <p className="text-sm font-semibold text-amber-950">{item.title}</p>
                  {item.summary ? <p className="mt-1 text-xs leading-relaxed text-amber-950/80">{item.summary}</p> : null}
                  <p className="mt-2 text-[11px] text-amber-900/70">
                    {(item.validFrom || item.validTo) ? `有效期：${item.validFrom || "--"} ~ ${item.validTo || "--"}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-2xl border border-amber-200 bg-white/80 px-4 py-4 text-sm text-amber-900">
              暂无可展示的权益快照。
            </p>
          )}
        </div>

        <div className="mt-5 flex flex-col gap-2">
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center rounded-xl bg-amber-500 py-3 text-sm font-semibold text-white hover:bg-amber-600"
          >
            打开来源页面
          </a>
          <a
            href="https://www.xiaopeng.com/appointment.html"
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center rounded-xl border border-amber-300 bg-white py-3 text-sm font-semibold text-amber-900 hover:bg-amber-50"
          >
            官方试驾预约页
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl py-2.5 text-sm font-medium text-amber-900/70 hover:text-amber-950"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
