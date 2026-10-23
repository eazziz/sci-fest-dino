/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        'press-start': ['"Press Start 2P"', 'cursive'],
      },
      colors: {
        game: {
          bg: '#f7f7f7',
          canvas: '#ffffff',
          text: '#535353',
          accent: '#ff5252',
        },
      },
    },
  },
  plugins: [],
};
