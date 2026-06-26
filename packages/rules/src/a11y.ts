import { axeBackedRule } from './axe-rule.js';

export const a11yInputLabel = axeBackedRule({
  id: 'a11y.input-label',
  axeRuleId: 'label',
  defaultSeverity: 'block',
  confidenceFloor: 0.9,
  unknownPolicy: 'demote',
  authority: { standard: 'WCAG 2.1', clause: '4.1.2', url: 'https://www.w3.org/WAI/WCAG21/Understanding/name-role-value' },
});

export const a11yImageAlt = axeBackedRule({
  id: 'a11y.image-alt',
  axeRuleId: 'image-alt',
  defaultSeverity: 'block',
  confidenceFloor: 0.9,
  unknownPolicy: 'demote',
  authority: { standard: 'WCAG 2.1', clause: '1.1.1', url: 'https://www.w3.org/WAI/WCAG21/Understanding/non-text-content' },
});

export const a11yColorContrast = axeBackedRule({
  id: 'a11y.color-contrast',
  axeRuleId: 'color-contrast',
  defaultSeverity: 'block',
  confidenceFloor: 0.9,
  unknownPolicy: 'demote',
  authority: { standard: 'WCAG 2.1', clause: '1.4.3', url: 'https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum' },
});

export const A11Y_RULES = [a11yInputLabel, a11yImageAlt, a11yColorContrast];
