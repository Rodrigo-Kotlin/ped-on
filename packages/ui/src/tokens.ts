export const pedonTokens = {
  colors: {
    navy: '#081B2E',
    orange: '#FB5904',
    'orange-secondary': '#FD8317',
    surface: '#F5F7F9',
    text: '#101827',
  },
} as const;

export type PedonColorToken = keyof (typeof pedonTokens)['colors'];
