const STABLE_ATTRS = ['id', 'name', 'data-testid'] as const;

function segment(el: Element): { seg: string; anchored: boolean } {
  const tag = el.tagName.toLowerCase();
  for (const a of STABLE_ATTRS) {
    const v = el.getAttribute(a);
    if (v) return { seg: `${tag}[${a}=${v}]`, anchored: true };
  }
  const parent = el.parentElement;
  if (!parent) return { seg: tag, anchored: true };
  const sameTag = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
  if (sameTag.length === 1) return { seg: tag, anchored: true };
  const idx = sameTag.indexOf(el) + 1;
  return { seg: `${tag}[${idx}]`, anchored: false };
}

export function stablePath(el: Element): { path: string; indexOnly: boolean } {
  const segs: string[] = [];
  let indexOnly = false;
  let cur: Element | null = el;
  while (cur && cur.tagName.toLowerCase() !== 'html') {
    const { seg, anchored } = segment(cur);
    segs.unshift(seg);
    if (!anchored) indexOnly = true;
    cur = cur.parentElement;
  }
  return { path: segs.join('>'), indexOnly };
}
