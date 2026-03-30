/**
 * 高德 Web 服务 - 驾车路径规划 v3
 * 文档：https://lbs.amap.com/api/webservice/guide/api/direction
 * origin/destination：经度,纬度（GCJ-02）
 */

const DRIVING_URL = "https://restapi.amap.com/v3/direction/driving";

/**
 * @returns {Promise<{ ok: true, distanceM: number, durationS: number } | { ok: false, error: string }>}
 */
async function amapDrivingMetrics(
  originLng,
  originLat,
  destLng,
  destLat,
  key
) {
  if (!key) return { ok: false, error: "no_key" };
  const origin = `${originLng},${originLat}`;
  const destination = `${destLng},${destLat}`;
  const params = new URLSearchParams({
    origin,
    destination,
    key,
    extensions: "base",
  });
  try {
    const res = await fetch(`${DRIVING_URL}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const data = await res.json();
    if (String(data.status) !== "1") {
      return {
        ok: false,
        error: data.info || `status=${data.status}`,
      };
    }
    const path = data.route?.paths?.[0];
    if (!path) {
      return { ok: false, error: "no_paths" };
    }
    const distanceM = Number(path.distance);
    const durationS = Number(path.duration);
    if (!Number.isFinite(distanceM) || !Number.isFinite(durationS)) {
      return { ok: false, error: "invalid_metrics" };
    }
    return { ok: true, distanceM, durationS };
  } catch (e) {
    return { ok: false, error: e.message || "fetch_fail" };
  }
}

/**
 * 在用户与各候选门店之间批量请求驾车时间，取耗时最短（路网）。
 * @param {string} key AMAP_REST_KEY
 * @param {number} userLat
 * @param {number} userLng
 * @param {Array<{ id: string, lat: number, lng: number, [k: string]: unknown }>} candidates
 */
async function pickNearestByDrivingTime(key, userLat, userLng, candidates) {
  if (!candidates.length) return null;

  const tasks = candidates.map(async (s) => {
    const m = await amapDrivingMetrics(userLng, userLat, s.lng, s.lat, key);
    return { store: s, ...m };
  });
  const results = await Promise.all(tasks);
  const ok = results.filter((r) => r.ok);
  if (!ok.length) {
    return { error: "all_routes_failed", samples: results.slice(0, 3) };
  }
  ok.sort((a, b) => a.durationS - b.durationS);
  const best = ok[0];
  return {
    store: best.store,
    distanceKm: Math.round((best.distanceM / 1000) * 10) / 10,
    durationMin: Math.max(1, Math.round(best.durationS / 60)),
    method: "amap_driving",
  };
}

module.exports = {
  amapDrivingMetrics,
  pickNearestByDrivingTime,
};
