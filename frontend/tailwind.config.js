/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Custom dark theme colors
        'dark': {
          950: '#0a0a0f',
          900: '#0f0f17',
          800: '#151520',
          700: '#1a1a27',
          600: '#22222f',
        },
        'terminal': {
          green: '#00ff88',
          dim: '#4a9d6e',
          yellow: '#ffcc00',
          red: '#ff4444',
          blue: '#00aaff',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Monaco', 'Consolas', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'blink': 'blink 1s step-end infinite',
      },
      keyframes: {
        blink: {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0 },
        }
      }
    },
  },
  plugins: [],
}
