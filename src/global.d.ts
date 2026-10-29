/// <reference types="vite/client" />
import type { KryptApi } from '@shared/types';

declare global {
  interface Window {
    krypt: KryptApi;
  }
}

declare module '*?url' {
  const url: string;
  export default url;
}

export {};
