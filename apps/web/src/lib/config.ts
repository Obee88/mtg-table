declare global {
  interface Window {
    __APP_CONFIG__?: { apiUrl?: string };
  }
}

export const config = {
  apiUrl: (window.__APP_CONFIG__?.apiUrl ?? 'http://localhost:3000').replace(/\/$/, ''),
};
