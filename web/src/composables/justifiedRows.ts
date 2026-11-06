import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";

/**
 * Justified contact-sheet rows.
 *
 * Frames keep their own aspect ratio; the packer scales each row so its cards
 * span the container exactly. Cards therefore get wider or narrower with the
 * picture instead of sitting in fixed columns with dead space beneath them.
 */

/** A frame tile spends 8px of padding on each side plus a 1px column rule. */
export const TILE_CHROME = 17;
/** Nothing is packed narrower than this, otherwise a burst of panoramas yields slivers. */
const MIN_IMAGE_WIDTH = 44;
const MIN_ROW_HEIGHT = 56;

export interface JustifiedEntry<T> {
  item: T;
  /** Position in the source list, for frame numbering. */
  index: number;
  /** Outer width of the tile in px, chrome included. */
  width: number;
}

export interface JustifiedRow<T> {
  key: number;
  items: JustifiedEntry<T>[];
}

export function useJustifiedRows<T>(options: {
  items: Ref<T[]>;
  /** Aspect ratio (width / height) of the frame. */
  ratio: (item: T) => number;
  /** Height the packer aims for at a given container width. */
  targetHeight: (containerWidth: number) => number;
}) {
  const container = ref<HTMLElement | null>(null);
  const width = ref(0);
  let observer: ResizeObserver | null = null;

  watch(container, (element, previous) => {
    if (previous && observer) observer.unobserve(previous);
    if (!element) return;
    width.value = element.clientWidth;
    if (!observer) {
      observer = new ResizeObserver(([entry]) => {
        const next = Math.round(entry.contentRect.width);
        if (next !== width.value) width.value = next;
      });
    }
    observer.observe(element);
  });

  onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
  });

  const rows = computed<JustifiedRow<T>[]>(() => {
    const items = options.items.value;
    const total = width.value;
    if (!total || !items.length) return [];

    const target = Math.max(MIN_ROW_HEIGHT, options.targetHeight(total));
    const out: JustifiedRow<T>[] = [];
    let pending: T[] = [];
    let pendingStart = 0;
    let ratioSum = 0;

    const commit = (batch: T[], start: number, stretch: boolean) => {
      if (!batch.length) return;
      const imageRoom = total - TILE_CHROME * batch.length;
      const sum = batch.reduce((acc, item) => acc + options.ratio(item), 0);
      const height = stretch ? Math.max(MIN_ROW_HEIGHT, imageRoom / sum) : target;

      const imageWidths = batch.map((item) => Math.max(MIN_IMAGE_WIDTH, options.ratio(item) * height));
      // Sub-pixel widths keep every frame in the row on the same baseline; the
      // browser rounds them out, so the row still lands flush on the rule.
      const scale = stretch ? imageRoom / imageWidths.reduce((acc, value) => acc + value, 0) : 1;

      out.push({
        key: out.length,
        items: batch.map((item, i) => ({
          item,
          index: start + i,
          width: imageWidths[i] * scale + TILE_CHROME,
        })),
      });
    };

    items.forEach((item, index) => {
      if (!pending.length) pendingStart = index;
      pending.push(item);
      ratioSum += options.ratio(item);
      const projected = (total - TILE_CHROME * pending.length) / ratioSum;
      if (projected <= target) {
        commit(pending, pendingStart, true);
        pending = [];
        ratioSum = 0;
      }
    });
    // The tail keeps the target height instead of stretching a couple of frames
    // across the whole width.
    commit(pending, pendingStart, false);

    return out;
  });

  return { container, rows, width };
}
