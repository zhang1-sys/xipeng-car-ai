"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="app-mesh-bg flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-[28px] border border-white/80 bg-white/92 p-8 text-center shadow-card">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#fff3e8]">
          <svg className="h-6 w-6 text-[#eb5b2a]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <p className="text-base font-semibold text-ink-900">页面出现异常</p>
        <p className="mt-3 text-sm leading-7 text-ink-600">
          {error?.message || "发生了未知错误，请刷新页面重试。"}
        </p>
        <button
          onClick={reset}
          className="mt-5 rounded-full bg-gradient-to-r from-[#eb5b2a] to-[#ff7a32] px-6 py-2.5 text-sm font-semibold text-white transition hover:from-[#da4f20] hover:to-[#f56d27]"
        >
          重新加载
        </button>
      </div>
    </div>
  );
}
