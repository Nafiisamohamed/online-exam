import type { Config } from 'tailwindcss';

/** Design tokens: dark green primary, white background, black/dark-gray text, neutral grays. */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#ecf8f1',
          100: '#d1eedd',
          200: '#a5dcbc',
          300: '#6fc394',
          400: '#3da56d',
          500: '#1f8a52',
          600: '#146f41',
          700: '#0f5a35',
          800: '#0c472b',
          900: '#093a23',
          950: '#052214',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16, 24, 40, 0.05), 0 1px 3px rgba(16, 24, 40, 0.06)',
      },
    },
  },
  plugins: [],
};
export default config;
