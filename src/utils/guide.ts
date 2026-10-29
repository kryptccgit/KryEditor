export const TUTORIAL_URL = 'https://www.youtube.com/watch?v=CrpPmKf1r0Q';

export const ONBOARD_KEY = 'krypt-onboarded';

export const SHOW_GUIDE_EVENT = 'krypt:show-guide';

export function replayOnboarding(): void {
  localStorage.removeItem(ONBOARD_KEY);
  window.dispatchEvent(new CustomEvent(SHOW_GUIDE_EVENT));
}
