const STABLE_ATTRS = ['id', 'name', 'data-testid'] as const;

function segment(el: Element): { seg: string; anchored: boolean } {
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;

  for (const a of STABLE_ATTRS) {
    const v = el.getAttribute(a);
    if (!v) continue;

    const candidateSeg = `${tag}[${a}=${v}]`;

    // Check whether other same-tag siblings produce the identical anchored segment.
    // If more than one sibling yields the same tag[attr=val], append a deterministic
    // 1-based ordinal among the colliding siblings.
    if (parent) {
      const sameTagSiblings = Array.from(parent.children).filter(
        (c) => c.tagName === el.tagName,
      );
      const colliders = sameTagSiblings.filter((sibling) => {
        for (const sa of STABLE_ATTRS) {
          const sv = sibling.getAttribute(sa);
          if (sv) return sa === a && sv === v;
        }
        return false;
      });
      if (colliders.length > 1) {
        const ordinal = colliders.indexOf(el) + 1;
        return { seg: `${candidateSeg}[${ordinal}]`, anchored: true };
      }
    }

    return { seg: candidateSeg, anchored: true };
  }

  // No anchor found – fall back to same-tag sibling ordinal.
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
