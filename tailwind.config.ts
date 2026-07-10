import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // 목동유쌤영어 로고 네이비-블루 톤
        brand: {
          DEFAULT: "#2b52a0",
          light: "#e9effb",
          dark: "#1e3a75",
        },
      },
    },
  },
  plugins: [],
};

export default config;
