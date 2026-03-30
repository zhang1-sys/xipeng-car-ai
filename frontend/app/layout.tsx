import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "小鹏购车智能顾问 | AI 选车、对比与试驾转化",
  description:
    "面向中国用户的小鹏购车智能顾问，支持车型推荐、配置选择、门店查询、试驾预约和购车决策辅助。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="app-mesh-bg font-sans min-h-screen">
        <Script
          id="xpeng-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html:
              "try{var k='xpeng_car_ai_theme',v=localStorage.getItem(k);document.documentElement.classList.toggle('dark',v==='dark');}catch(e){}",
          }}
        />
        {children}
      </body>
    </html>
  );
}
