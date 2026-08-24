import { useCallback, useEffect, useRef, useState } from 'react';

export function useBrowserFullscreen() {
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    const sync = () => setActive(
      document.fullscreenElement === document.documentElement);
    sync();
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggle = useCallback(async () => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      if (document.fullscreenElement === document.documentElement) {
        await document.exitFullscreen();
      } else if (document.fullscreenElement === null) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      } else {
        setError('另一个窗口正在全屏，请先退出后再试。');
        return false;
      }
      return true;
    } catch {
      setError('浏览器拒绝进入全屏，请检查权限或改用画布专注模式。');
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      void toggle();
    };
    window.addEventListener('keydown', exitOnEscape);
    return () => window.removeEventListener('keydown', exitOnEscape);
  }, [active, toggle]);

  return { active, busy, error, toggle };
}
