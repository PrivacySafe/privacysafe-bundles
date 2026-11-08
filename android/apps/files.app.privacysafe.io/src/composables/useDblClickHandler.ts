export function useDblClickHandler(
  onClick: (ev: MouseEvent) => void,
  onDblClick: (ev: MouseEvent) => void,
  delay = 250,
) {
  let expandTimes = 0;
  let expandTimer: NodeJS.Timeout | null = null;

  function handleDblClick(ev: MouseEvent) {
    expandTimes++;

    if (expandTimer) {
      clearTimeout(expandTimer);
    }

    expandTimer = setTimeout(() => {
      if (expandTimes === 1) {
        onClick(ev);
      } else {
        onDblClick(ev);
      }
      expandTimer = null;
      expandTimes = 0;
    }, delay);
  }

  return {
    handleDblClick,
  };
}
