import type { AurumDesktopApi } from "../preload/index";

declare global {
  interface Window {
    aurumDesktop: AurumDesktopApi;
  }
}

export {};
