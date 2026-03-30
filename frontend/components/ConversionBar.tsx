"use client";

type Props = {
  carName?: string;
  onTestDrive: () => void;
  onStores: () => void;
  onOffer: () => void;
};

export function ConversionBar({ carName, onTestDrive, onStores, onOffer }: Props) {
  return (
    <div className="rounded-[24px] border border-[#dce7f5] bg-[linear-gradient(135deg,rgba(241,247,255,0.98),rgba(255,255,255,0.98))] p-4 shadow-inner-glow">
      <p className="text-xs font-semibold text-ink-600">
        {carName ? (
          <>
            围绕 <span className="text-brand-dark">{carName}</span> 继续往下走
          </>
        ) : (
          "下一步可以直接推进真实购车动作"
        )}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onTestDrive}
          className="rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:from-sky-500 hover:to-indigo-500"
        >
          预约试驾
        </button>
        <button
          type="button"
          onClick={onStores}
          className="rounded-xl border border-ink-200 bg-white px-4 py-2.5 text-sm font-semibold text-ink-800 transition hover:border-sky-300 hover:text-brand-dark"
        >
          查看门店
        </button>
        <button
          type="button"
          onClick={onOffer}
          className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900 transition hover:bg-amber-100"
        >
          查看当前权益
        </button>
      </div>
    </div>
  );
}
