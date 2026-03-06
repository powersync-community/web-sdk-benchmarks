import { useEffect, useState } from "react";

/**
 * Hook that creates a flash effect when dependencies change.
 * Returns a boolean that is true for 300ms after deps change.
 *
 * @param deps - Dependencies to watch for changes
 * @returns boolean indicating if flash should be active
 */
export function useFlashEffect(deps: any[]): boolean {
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 300);
    return () => clearTimeout(timer);
  }, deps);

  return flash;
}
