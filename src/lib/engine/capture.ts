// Page utilities behind the popup's "Capture this form" and "Save answers
// from this page" buttons.
import type { Profile, SavedAnswer } from '../types';
import { todayISO } from '../clock';
import { resolveAnswer } from './answers';
import { scanFields, currentValue } from './scan';
import { questionSimilarity } from './text';

const DROP = new Set(['script', 'style', 'link', 'iframe', 'img', 'svg', 'noscript', 'video', 'picture', 'meta', 'canvas']);
const VOID = new Set(['input', 'br', 'hr', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);
// Attributes that can carry what you typed; dropped so a capture is safe to share.
const VALUE_ATTRS = new Set(['value', 'checked', 'selected', 'data-value', 'data-initial-value']);

const escapeAttr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const escapeText = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/**
 * Serialize the page's structure (open shadow roots included) without
 * scripts, styles, or any values typed into fields. Used to build test
 * fixtures for sites that need a new or fixed adapter.
 */
export function captureForm(): string {
  const serialize = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      // Text inside a textarea or a rich-text editor is your answer, not page structure.
      if (parent?.closest('textarea, [contenteditable="true"]')) return '';
      return escapeText(node.textContent ?? '');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (DROP.has(tag)) return '';
    const attrs = [...el.attributes]
      .filter((a) => !a.name.startsWith('on') && a.name !== 'style' && a.name !== 'srcset' && !VALUE_ATTRS.has(a.name))
      .map((a) => ` ${a.name}="${escapeAttr(a.value)}"`)
      .join('');
    // Keep option values (they're the site's, not yours) so selects stay testable.
    const optionValue = tag === 'option' ? ` value="${escapeAttr((el as HTMLOptionElement).value)}"` : '';
    const shadow = el.shadowRoot ? `<template shadowrootmode="open">${[...el.shadowRoot.childNodes].map(serialize).join('')}</template>` : '';
    const kids = [...el.childNodes].map(serialize).join('');
    return VOID.has(tag) ? `<${tag}${attrs}>` : `<${tag}${attrs}${optionValue}>${shadow}${kids}</${tag}>`;
  };
  const date = todayISO();
  return `<!doctype html>\n<!-- captured from ${escapeText(location.href)} on ${date} by getmeajobpls -->\n<html><body>${serialize(document.body)}</body></html>\n`;
}

/** Questions on the page that you answered yourself and the profile can't answer yet. */
export function collectAnswers(profile: Profile): { question: string; answer: string }[] {
  const out: { question: string; answer: string }[] = [];
  for (const field of scanFields()) {
    if (field.kind === 'file' || field.kind === 'checkbox' || !field.label) continue;
    const answer = currentValue(field);
    if (!answer || answer.length > 5000) continue;
    const known = resolveAnswer(field.label, '', null, { profile, skills: profile.skills }, field.kind !== 'text' && field.kind !== 'textarea');
    if (known.matchedKey && known.matchedKey !== 'savedAnswer') continue; // already a profile field
    if (known.answer?.value === answer) continue; // already saved
    out.push({ question: field.label, answer });
  }
  return out;
}

/** Merge collected answers into the saved-answers bank (same question → answer updated). */
export function mergeSavedAnswers(bank: SavedAnswer[], incoming: { question: string; answer: string }[], newId: () => string): { added: number; updated: number } {
  let added = 0;
  let updated = 0;
  for (const item of incoming) {
    const existing = bank.find((b) => questionSimilarity(b.question, item.question) >= 0.9);
    if (existing) {
      if (existing.answer !== item.answer) {
        existing.answer = item.answer;
        updated++;
      }
    } else {
      bank.push({ id: newId(), question: item.question, answer: item.answer });
      added++;
    }
  }
  return { added, updated };
}
