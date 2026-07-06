import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#e8fafa",
          100: "#d3f5f4",
          200: "#a7ebe9",
          300: "#7ae1de",
          400: "#4dd7d3",
          500: "#0fc6c2",
          600: "#0bada9",
          700: "#088d8a",
          800: "#066d6b",
          900: "#044e4d",
          DEFAULT: "#0fc6c2"
        },
        ink: {
          900: "#1d2129",
          700: "#4e5969",
          500: "#86909c"
        },
        canvas: {
          50: "#f7f8fa"
        }
      },
      borderRadius: {
        xl: "12px"
      },
      boxShadow: {
        card: "0 2px 20px rgba(0,0,0,.06)"
      }
    }
  },
  plugins: []
} satisfies Config;

