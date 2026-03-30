import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "PingFang SC",
          "Microsoft YaHei UI",
          "system-ui",
          "sans-serif",
        ],
        display: [
          "var(--font-display)",
          "STZhongsong",
          "Songti SC",
          "serif",
        ],
      },
      colors: {
        ink: {
          50: "#f7f8fa",
          100: "#eef0f4",
          200: "#d8dde6",
          300: "#b4bdcc",
          400: "#8b98ad",
          500: "#6b7a92",
          600: "#556175",
          700: "#454e5f",
          800: "#3a414f",
          900: "#1a1f2e",
        },
        brand: {
          DEFAULT: "#0ea5e9",
          dark: "#0284c7",
          glow: "#38bdf8",
        },
      },
      boxShadow: {
        card: "0 4px 24px -4px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(15, 23, 42, 0.04)",
        float: "0 12px 40px -12px rgba(14, 165, 233, 0.25)",
        glow: "0 0 60px -12px rgba(14, 165, 233, 0.45)",
        "inner-glow":
          "inset 0 1px 0 0 rgba(255,255,255,0.6), 0 1px 2px rgba(15,23,42,0.06)",
      },
      backgroundImage: {
        "mesh-page":
          "radial-gradient(at 0% 0%, rgba(14,165,233,0.14) 0, transparent 50%), radial-gradient(at 100% 0%, rgba(99,102,241,0.12) 0, transparent 45%), radial-gradient(at 100% 100%, rgba(14,165,233,0.08) 0, transparent 40%), radial-gradient(at 0% 100%, rgba(167,139,250,0.1) 0, transparent 45%)",
        "hero-shine":
          "linear-gradient(105deg, rgba(255,255,255,0) 40%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0) 60%)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.65" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "cfg-slide-up": {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "cfg-scale": {
          "0%": { opacity: "0", transform: "scale(0.94)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.45s ease-out forwards",
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
        shimmer: "shimmer 1.5s ease-in-out infinite",
        "cfg-slide-up": "cfg-slide-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "cfg-scale": "cfg-scale 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
      },
    },
  },
  plugins: [],
};

export default config;
