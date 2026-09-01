/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        theme: {
          bg: 'var(--bg-dark)',
          sidebar: 'var(--bg-sidebar)',
          card: 'var(--bg-card)',
          input: 'var(--bg-input)',
          bubble: 'var(--bg-user-bubble)',
          modal: 'var(--bg-modal)',
          hover: 'var(--bg-hover)',
          border: 'var(--border-color)',
          'border-input': 'var(--border-input)',
          accent: 'var(--accent-primary)',
          'accent-hover': 'var(--accent-hover)',
          'accent-subtle': 'var(--accent-subtle)',
          'text-main': 'var(--text-main)',
          'text-muted': 'var(--text-muted)',
          'text-dark': 'var(--text-dark)',
          emerald: 'var(--accent-emerald)',
          blue: 'var(--accent-blue)',
        }
      },
      fontFamily: {
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'Inter', 'sans-serif'],
        mono: ['var(--font-code)', 'monospace'],
      },
      boxShadow: {
        card: '0 8px 30px rgba(0, 0, 0, 0.35)',
        glow: '0 0 20px rgba(218, 119, 86, 0.25)',
      }
    },
  },
  plugins: [],
}
