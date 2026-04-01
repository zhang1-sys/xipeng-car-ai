"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body
        style={{
          fontFamily:
            '"PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif',
          background: "#f6efe7",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          padding: "2rem",
        }}
      >
        <div
          style={{
            maxWidth: 420,
            textAlign: "center",
            background: "#fff",
            borderRadius: 24,
            padding: "2.5rem 2rem",
            boxShadow: "0 4px 24px -4px rgba(15, 23, 42, 0.08)",
          }}
        >
          <p style={{ fontSize: 14, fontWeight: 700, color: "#b84d24" }}>
            页面出现异常
          </p>
          <p
            style={{
              marginTop: 12,
              fontSize: 13,
              color: "#6b7a92",
              lineHeight: 1.8,
            }}
          >
            {error?.message || "发生了未知错误，请刷新页面重试。"}
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 20,
              padding: "10px 24px",
              borderRadius: 999,
              border: "none",
              background: "linear-gradient(to right, #eb5b2a, #ff7a32)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            重新加载
          </button>
        </div>
      </body>
    </html>
  );
}
