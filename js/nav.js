// Navigation history shared by the router and views.
export const stack = [];
export const navState = { lastTab: 'shows' };

/** Back navigation that works whether or not there's in-app history. */
export function goBack(fallback) {
  if (stack.length > 1) history.back();
  else location.hash = fallback || `#/${navState.lastTab}`;
}
