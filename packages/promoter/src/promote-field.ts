import type { L1Node, L1Graph, TriBool } from '@sb/ir-schema';

const UNCERTAIN_CONFIDENCE = 0.5;

export function resolveLabel(
  field: L1Node,
  l1: L1Graph,
): { label: string | null; confidence: number; ambiguous: boolean } {
  // <label for=id> wins (0.95)
  const id = field.attributes['id'];
  if (id) {
    const label = Object.values(l1.nodes).find(
      (x) => x.tag.toLowerCase() === 'label' && x.attributes['for'] === id,
    );
    if (label?.text) return { label: label.text, confidence: 0.95, ambiguous: false };
  }
  // aria-label (0.9)
  const aria = field.attributes['aria-label'];
  if (aria) return { label: aria, confidence: 0.9, ambiguous: false };
  // aria-labelledby → referenced node text (0.9, multiple IDs supported)
  const labelledby = field.attributes['aria-labelledby'];
  if (labelledby) {
    const ids = labelledby.split(/\s+/).filter(Boolean);
    const texts: string[] = [];
    for (const id of ids) {
      const ref = Object.values(l1.nodes).find((x) => x.attributes['id'] === id);
      if (ref?.text) texts.push(ref.text);
    }
    if (texts.length > 0) {
      return { label: texts.join(' '), confidence: 0.9, ambiguous: false };
    }
    // aria-labelledby present but dangling → ambiguous, not confirmed absent
    return { label: null, confidence: 0.6, ambiguous: true };
  }
  // confirmed absent — null + known (0.95)
  return { label: null, confidence: 0.95, ambiguous: false };
}

export function resolveRequired(
  field: L1Node,
  label: string | null,
): { required: TriBool; confidence: number; ambiguous: boolean } {
  if ('required' in field.attributes || field.attributes['aria-required'] === 'true') {
    return { required: true, confidence: 0.95, ambiguous: false };
  }
  if (label && (label.includes('*') || label.includes('필수'))) {
    return { required: true, confidence: 0.7, ambiguous: false };
  }
  // no signal — NEVER assert false (P6)
  return { required: 'unknown', confidence: UNCERTAIN_CONFIDENCE, ambiguous: true };
}

const TYPE_MAP: Record<string, string> = {
  number: 'number', range: 'number',
  date: 'date', 'datetime-local': 'date', month: 'date', week: 'date', time: 'date',
  checkbox: 'boolean',
  text: 'string', email: 'string', tel: 'string', url: 'string', search: 'string', password: 'string',
};

export function resolveDataType(
  field: L1Node,
): { dataType: string; confidence: number; ambiguous: boolean } {
  // <select> is always an enumeration / code picker
  if (field.tag.toLowerCase() === 'select') {
    return { dataType: 'code', confidence: 0.85, ambiguous: false };
  }
  const type = field.attributes['type'];
  if (type && TYPE_MAP[type]) {
    return { dataType: TYPE_MAP[type], confidence: 0.9, ambiguous: false };
  }
  const inputmode = field.attributes['inputmode'];
  if (inputmode === 'numeric' || inputmode === 'decimal') {
    return { dataType: 'number', confidence: 0.7, ambiguous: false };
  }
  if (field.attributes['pattern']) {
    return { dataType: 'string', confidence: 0.7, ambiguous: false };
  }
  return { dataType: 'unknown', confidence: UNCERTAIN_CONFIDENCE, ambiguous: true };
}
