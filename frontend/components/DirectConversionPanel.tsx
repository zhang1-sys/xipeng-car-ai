"use client";

type Props = {
  carName?: string;
  showTestDrive?: boolean;
  showAdvisorFollowup?: boolean;
  onTestDrive: (carName?: string) => void;
  onAdvisorFollowup: (carName?: string) => void;
};

export function DirectConversionPanel({
  carName,
  showTestDrive = false,
  showAdvisorFollowup = false,
  onTestDrive,
  onAdvisorFollowup,
}: Props) {
  if (!showTestDrive && !showAdvisorFollowup) return null;

  return (
    <div className="overflow-hidden rounded-[28px] border border-[#d8e5fb] bg-[linear-gradient(135deg,rgba(244,248,255,0.98),rgba(255,255,255,0.98))] shadow-[0_24px_60px_-32px_rgba(59,130,246,0.24)]">
      <div className="border-b border-[#e6eefc] px-5 py-4">
        <p className="text-[11px] font-bold tracking-[0.16em] text-[#4770a7]">线下转化动作</p>
        <p className="mt-2 text-sm leading-7 text-ink-800">
          {carName
            ? `当前会继续围绕 ${carName} 往下推进。`
            : "当前可以直接进入试驾预约或顾问跟进。"}
        </p>
      </div>

      <div className="grid gap-3 px-5 py-5 md:grid-cols-2">
        {showTestDrive ? (
          <button
            type="button"
            onClick={() => onTestDrive(carName)}
            className="flex min-h-[132px] flex-col items-start rounded-[24px] bg-gradient-to-r from-sky-600 to-indigo-600 px-5 py-4 text-left text-sm font-semibold text-white transition hover:from-sky-500 hover:to-indigo-500"
          >
            预约试驾
            <span className="mt-2 block text-[11px] font-medium text-white/82">
              {carName ? `意向车型：${carName}` : "未锁定车型时也可先提交意向"}
            </span>
            <span className="mt-4 block text-xs leading-6 text-white/74">
              打开表单后可继续定位，系统会优先匹配离你更近的真实门店。
            </span>
          </button>
        ) : null}

        {showAdvisorFollowup ? (
          <button
            type="button"
            onClick={() => onAdvisorFollowup(carName)}
            className="flex min-h-[132px] flex-col items-start rounded-[24px] border border-[#f3c9a8] bg-[linear-gradient(135deg,rgba(255,245,236,0.98),rgba(255,255,255,0.98))] px-5 py-4 text-left text-sm font-semibold text-[#9a4d20] transition hover:border-[#eb5b2a] hover:bg-[#fff2e7]"
          >
            让顾问跟进
            <span className="mt-2 block text-[11px] font-medium text-[#9a4d20]/80">
              {carName ? `会默认带上 ${carName} 的上下文` : "会把当前意向直接交给顾问"}
            </span>
            <span className="mt-4 block text-xs leading-6 text-[#9a4d20]/76">
              提交后可继续按城市和门店做承接，不需要每次重新解释背景。
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
