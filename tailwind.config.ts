import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0E1B2B",
        board: "#EDF0F3",
        panel: "#FFFFFF",
        line: "#D3D9E0",
        muted: "#5A6878",
        signal: "#0B6B8A",
        gold: "#F0B429",
        goldsoft: "#FFF4D6",
        danger: "#B42318",
        ok: "#177245",
      },
      fontFamily: {
        sans: ['ui-sans-serif', '"Segoe UI"', "Roboto", '"Helvetica Neue"', "Arial", "sans-serif"],
        display: ['"Iowan Old Style"', '"Palatino Linotype"', "Palatino", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
