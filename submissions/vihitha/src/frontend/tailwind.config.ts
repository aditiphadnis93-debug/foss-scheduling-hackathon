import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: '#0B2545', blue: { DEFAULT: '#1E5AA8', sel: '#E8F0FA' },
        teal: { DEFAULT: '#0F8B8D', light: '#E0F4F4', text: '#0B6E70' },
        bg: '#F6F9FC', line: '#DDE5EE', muted: '#52627A',
        green: { DEFAULT: '#2E8B57', text: '#1F6B41', bg: '#E6F3EC' },
        amber: { DEFAULT: '#D98E04', text: '#8A5A00', bg: '#FBF1DC' },
        red: { DEFAULT: '#C0392B', text: '#A12F22', bg: '#F9E5E2' },
        grey: { DEFAULT: '#7A8699', text: '#5A6678', bg: '#EEF1F5' },
        purple: { DEFAULT: '#7A5AA8', text: '#5B3F85', bg: '#F1ECF8' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        ml: ['"Noto Sans Malayalam"', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: { card: '12px', btn: '8px' },
    },
  },
} satisfies Config
