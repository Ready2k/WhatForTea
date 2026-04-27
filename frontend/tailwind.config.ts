import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: 'class',
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#12382B',   // Forest Green
          'primary-hover': '#1E5A43',
          secondary: '#6F9F7B', // Sage Green
          accent: '#D8A63A',    // Warm Gold
          'accent-soft': '#F3D98B',
          background: '#F7F1E6', // Oat Cream
          deep: '#0B1F18',      // Deep Dark Green
          card: '#FFFDF7',      // Warm White
          ink: '#18231D',       // Deep Ink
          muted: '#6F766F',     // Muted Green-Gray
          linen: '#E6DCCB',     // Soft Linen
          tomato: '#C6533A',    // Danger
          herb: '#3F8F5D',      // Success
        }
      },
      fontFamily: {
        sans: ['var(--font-jakarta)', 'system-ui', 'sans-serif'],
      },
      animation: {
        'bounce-slow': 'bounce 2s infinite',
      },
    },
  },
  plugins: [],
};

export default config;
