/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"IBM Plex Sans Arabic"', 'system-ui', 'Segoe UI', 'Tahoma', 'sans-serif'] },
      colors: {
        ink: '#16222c', paper: '#f2f4f6', line: '#d9dfe5', mute: '#5b6b78',
        brand: { DEFAULT: '#0e6b6e', soft: '#dff0f0', dark: '#0a4f52' },
        warn: { DEFAULT: '#8a4f08', soft: '#fbefd9' },
        bad: { DEFAULT: '#a8321f', soft: '#f9e3df' },
        good: { DEFAULT: '#256b40', soft: '#dff1e5' },
      },
    },
  },
  plugins: [],
};
