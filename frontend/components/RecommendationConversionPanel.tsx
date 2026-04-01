"use client";

import { useEffect, useState } from "react";

type Props = {
  carNames: string[];
  onTestDrive: (carName?: string) => void;
  onConfigurator: (carName?: string) => void;
};

export function RecommendationConversionPanel({
  carNames,
  onTestDrive,
  onConfigurator,
}: Props) {
  const options = carNames.filter(Boolean);
  const [selectedCar, setSelectedCar] = useState<string>(options[0] || "");

  useEffect(() => {
    if (!options.length) {
      setSelectedCar("");
      return;
    }
    if (!options.includes(selectedCar)) {
      setSelectedCar(options[0]);
    }
  }, [options, selectedCar]);

  if (!options.length) return null;

  return (
    <div className="overflow-hidden rounded-[28px] border border-[#d8e5fb] bg-[linear-gradient(135deg,rgba(244,248,255,0.98),rgba(255,255,255,0.98))] shadow-[0_24px_60px_-32px_rgba(59,130,246,0.24)]">
      <div className="border-b border-[#e6eefc] px-5 py-4">
        <p className="text-[11px] font-bold tracking-[0.16em] text-[#4770a7]">统一预约试驾</p>
        <p className="mt-2 text-sm leading-7 text-ink-800">
          推荐结果先收敛到一台重点车型，再从这里统一进入预约试驾。提交后会优先按定位或城市匹配离你更近的门店。
        </p>
      </div>

      <div className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-end">
        <div className="min-w-0">
          <p className="text-[11px] font-bold tracking-[0.14em] text-ink-500">选择重点车型</p>
          <div className="mt-3 rounded-[22px] border border-[#dbe6f7] bg-white/90 p-3">
            <select
              value={selectedCar}
              onChange={(event) => setSelectedCar(event.target.value)}
              className="w-full rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm font-semibold text-ink-900 outline-none transition focus:border-[#eb5b2a] focus:ring-4 focus:ring-[#fff1e6]"
            >
              {options.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <p className="mt-3 text-xs leading-6 text-ink-500">
              这里只保留一个统一入口，不再在每张车型卡下面重复挂载预约、门店和权益按钮。
            </p>
          </div>
        </div>

        <div className="min-w-0">
          <button
            type="button"
            onClick={() => onConfigurator(selectedCar || undefined)}
            className="flex w-full flex-col items-start rounded-[24px] bg-gradient-to-r from-[#eb5b2a] to-[#ff7b36] px-5 py-4 text-left text-sm font-semibold text-white transition hover:from-[#d84e1f] hover:to-[#f16a26]"
          >
            继续配置
            <span className="mt-1 block text-[11px] font-medium text-white/82">
              {selectedCar ? `直接进入 ${selectedCar} 配置器` : "选择车型后进入配置器"}
            </span>
            <span className="mt-4 block text-xs leading-6 text-white/74">
              先把目标车型收敛，再进入多步配置流程；配置完成后再推进试驾和门店动作。
            </span>
          </button>

          <button
            type="button"
            onClick={() => onTestDrive(selectedCar || undefined)}
            className="mt-3 flex w-full flex-col items-start rounded-[24px] bg-gradient-to-r from-sky-600 to-indigo-600 px-5 py-4 text-left text-sm font-semibold text-white transition hover:from-sky-500 hover:to-indigo-500"
          >
            预约试驾
            <span className="mt-1 block text-[11px] font-medium text-white/82">
              {selectedCar ? `当前车型：${selectedCar}` : "选择车型后提交"}
            </span>
            <span className="mt-4 block text-xs leading-6 text-white/74">
              打开预约弹窗后，可继续使用定位，系统会优先分配最近门店。
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
