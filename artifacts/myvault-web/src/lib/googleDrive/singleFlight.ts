export function createSingleFlight<T>() {
  let active: Promise<T> | null = null;
  return (operation: () => Promise<T>) => {
    if (active) return active;
    active = operation();
    void active.finally(() => {
      active = null;
    }).catch(() => undefined);
    return active;
  };
}
