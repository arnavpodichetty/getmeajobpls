// The fill pipeline every adapter runs: resume first, wait for parsing, then
// each field top to bottom, then a second pass for questions revealed by the
// first answers.
import type { FillContext } from '../../adapters/types';
import { setTimeZone } from '../clock';
import type { FieldResult, FillReport } from '../types';
import { LEAVE_EMPTY, resolveAnswer, type Answer, type AnswerContext, type AnswerValue } from './answers';
import {
  attachFile,
  fillButtons,
  fillCheckbox,
  fillCheckboxes,
  fillCombobox,
  fillMultiCombobox,
  fillRadio,
  fillRichText,
  fillSelect,
  fillText,
  formatDate,
  highlightTarget,
  monthName,
  type Outcome,
} from './controls';
import { closestDeep, composedElements, queryAllDeep, queryDeep, sleep, waitForStable } from './dom';
import { labelFor, optionText, textOfIds } from './labels';
import { currentValue, scanFields, type Field } from './scan';
import { DECLINE, isBareFieldHead, isPlaceholderOption, normalize } from './text';

/** Adapter-supplied answer for fields matching a selector (beats label matching). */
export interface Override {
  selector: string;
  key: string;
  value: (c: AnswerContext) => AnswerValue | null | undefined;
  isDate?: boolean;
}

/** A question the profile couldn't answer (flagged for review when required). */
export interface OpenQuestion {
  id: number;
  label: string;
  kind: Field['kind'];
  options: string[];
  required: boolean;
  maxLength?: number;
}

export interface EngineOptions {
  ats: string;
  root?: ParentNode;
  overrides?: Override[];
  /** Find the resume <input type=file> (or drop zone); defaults to a label-based search. */
  resumeTarget?: () => HTMLElement | null;
  /** Fields the adapter handles itself. */
  skip?: (field: Field) => boolean;
  /** Only fill fields not handled before (multi-step watching). */
  incremental?: boolean;
  /** Runs after each field is filled, e.g. to wait for the site to save it. */
  afterField?: () => Promise<void>;
}

// Elements already handled, so incremental passes (new steps) skip them.
// A fresh (non-incremental) fill starts over.
let handled = new WeakSet<Element>();
// Sites like Workday re-render the upload input after taking the file, so the new
// element isn't in `handled`. Remember the page that got the resume so later passes
// there don't attach it again (or re-attach one you removed). Another page, such as
// Workday's "Autofill with Resume" step or the next application, still gets it.
let resumeAttachedOn: string | null = null;
// Same for the transcript: the questions it went into on each page.
let transcriptAttached = new Set<string>();
const pageKey = () => `${location.origin}${location.pathname}`;

const HIGHLIGHT_ATTR = 'data-getmeajobpls';
const COLORS = { filled: '#1f9d63', review: '#d97706' };

export function clearHighlights(): void {
  queryAllDeep<HTMLElement>(`[${HIGHLIGHT_ATTR}]`).forEach((el) => {
    el.style.removeProperty('outline');
    el.style.removeProperty('outline-offset');
    el.removeAttribute(HIGHLIGHT_ATTR);
  });
}

function highlight(field: Field, status: 'filled' | 'review', enabled: boolean): void {
  if (!enabled) return;
  const target = highlightTarget(field.el, ['radio', 'checkboxes', 'buttons'].includes(field.kind));
  target.setAttribute(HIGHLIGHT_ATTR, status);
  target.style.setProperty('outline', `2px solid ${COLORS[status]}`, 'important');
  target.style.setProperty('outline-offset', '2px', 'important');
}

// Upload widgets that list the file themselves (Workday, many React uploaders) leave
// their <input> empty, e.g. My Experience after "Autofill with Resume".
const FILE_NAME = /[\w)-]\.(?:pdf|docx?|rtf|txt|odt|pages)\b/i;
function uploadShowsFile(input: HTMLElement): boolean {
  let el: HTMLElement | null = input;
  for (let depth = 0; depth < 6 && el?.parentElement; depth++) {
    el = el.parentElement;
    // Stop once the ancestor holds more than this upload widget.
    if ([...el.querySelectorAll('input, select, textarea')].some((c) => c !== input)) break;
    if (el.querySelector('[data-automation-id="file-upload-item"]') || FILE_NAME.test(el.textContent ?? '')) return true;
  }
  return false;
}

function pageShows(text: string): boolean {
  return composedElements(document).some((el) => !el.children.length && el.textContent?.includes(text));
}

const isChoice = (f: Field) => ['select', 'radio', 'checkboxes', 'combobox', 'buttons', 'checkbox'].includes(f.kind);

function displayLabel(field: Field): string {
  return field.label || field.hints.split(' | ')[0] || `Unlabelled ${field.kind}`;
}

function optionsOf(field: Field): string[] {
  switch (field.kind) {
    case 'select':
      return [...(field.el as HTMLSelectElement).options].map((o) => o.text.trim()).filter((t) => t && !isPlaceholderOption(t));
    case 'radio':
    case 'checkboxes':
      return field.members.map(optionText);
    case 'buttons':
      return field.members.map((b) => b.textContent?.trim() ?? '');
    default:
      return [];
  }
}

const US_CITIZEN_OPTION = /\b(?:u s|us|united states|american) citizen/;

/** Your profile link that `value` is, minus its "https://" (and "www."), or null. */
export function fullProfileLink(value: string, links: Record<string, string>): string | null {
  const bare = (s: string) => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  const shown = value.trim();
  if (!shown || /^https?:\/\//i.test(shown)) return null;
  return Object.values(links).find((link) => /^https?:\/\//i.test(link.trim()) && bare(link) === bare(shown))?.trim() ?? null;
}

const BARE_DOMAIN = /^(?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i;
const LINK_LABEL = /\b(?:links?|urls?|websites?|web ?sites?|web page|homepage|portfolio|linkedin|github|blog)\b/i;

/** True for a text box that asks for a web address: type="url", or a label about links. */
export function isLinkField(field: Field): boolean {
  if (field.kind !== 'text') return false;
  if ((field.el as HTMLInputElement).type === 'url') return true;
  return LINK_LABEL.test(field.label) && !/\b(?:e ?mail|phone)\b/i.test(field.label);
}

/**
 * The value of a link box with "https://" put back, or null when it already has one or isn't
 * a web address. Your profile's own spelling of the link wins; any other bare domain
 * ("acme.dev/work") gets "https://" in front, since sites reject links without it.
 */
export function linkWithScheme(value: string, links: Record<string, string>): string | null {
  const shown = value.trim();
  if (!shown || /^[a-z][a-z0-9+.-]*:\/\//i.test(shown)) return null;
  return fullProfileLink(shown, links) ?? (BARE_DOMAIN.test(shown) ? `https://${shown}` : null);
}

/** A visible option saying you're a US citizen, when your profile says you are. */
function usCitizenOption(field: Field, c: AnswerContext): Answer | null {
  if (!/^(united states|usa|us|u s|united states of america)$/.test(normalize(c.profile.answers.citizenship))) return null;
  const option = optionsOf(field).find((o) => {
    const n = normalize(o);
    return US_CITIZEN_OPTION.test(n) && !/\b(?:not|non|neither)\b/.test(n);
  });
  return option ? { key: 'usCitizenOption', value: option, confidence: 'high' } : null;
}

function asText(value: AnswerValue): string {
  return Array.isArray(value) ? value.join(', ') : value;
}

async function fillField(field: Field, answer: Answer): Promise<Outcome> {
  let value = answer.value;
  if (answer.isDate && typeof value === 'string' && !isChoice(field)) value = formatDate(value, field.el, field.label);
  // A dropdown asking only for the month ("June") or only for the year ("2028") of a date.
  else if (answer.isDate && typeof value === 'string' && /^\d{4}-\d{2}/.test(value)) {
    const question = normalize(field.label);
    if (/\bmonth\b/.test(question) && !/\byears?\b/.test(question)) value = monthName(value);
    else if (/\byears?\b/.test(question) && !/\bmonths?\b/.test(question)) value = value.slice(0, 4);
  }
  const one = asText(value);
  switch (field.kind) {
    case 'text':
    case 'textarea':
      if (one === DECLINE) return { ok: false, review: 'Decline-to-answer question with a text box.' };
      return fillText(field.el as HTMLInputElement, one);
    case 'date':
      return fillText(field.el as HTMLInputElement, typeof answer.value === 'string' ? formatDate(answer.value, field.el, field.label) : one);
    case 'richtext':
      return fillRichText(field.el, one);
    case 'select':
      return fillSelect(field.el as HTMLSelectElement, value, answer.tiers, answer.locationPreference, answer.availabilityDate);
    case 'radio':
      return fillRadio(field.members, one, answer.tiers, answer.locationPreference, answer.availabilityDate);
    case 'checkboxes':
      return fillCheckboxes(field.members, value, answer.tiers, answer.locationPreference, answer.availabilityDate);
    case 'checkbox':
      return fillCheckbox(field.el as HTMLInputElement, one);
    case 'buttons':
      return fillButtons(field.members, one, answer.tiers, answer.locationPreference, answer.availabilityDate);
    case 'combobox': {
      if (Array.isArray(value) && value.length > 1) {
        const { added, skipped } = await fillMultiCombobox(field.el, value);
        if (!added.length) return { ok: false, review: 'None of your skills matched the options.' };
        return skipped.length ? { ok: true, review: `Skipped (no match): ${skipped.slice(0, 6).join(', ')}${skipped.length > 6 ? '…' : ''}` } : { ok: true };
      }
      return fillCombobox(field.el, one, { tiers: answer.tiers, locationPreference: answer.locationPreference, availabilityDate: answer.availabilityDate });
    }
    default:
      return { ok: false, review: 'Unsupported field type.' };
  }
}

/** An upload asking for your (unofficial) transcript, not a video or interview transcript. */
const TRANSCRIPT = /\btranscripts?\b/;
export function isTranscriptUpload(text: string): boolean {
  const n = normalize(text);
  return TRANSCRIPT.test(n) && !/\b(?:video|interview|recording|meeting|call)\b/.test(n);
}

/** True when a file input's question asks for a transcript (used to keep the resume out of it). */
export function asksForTranscript(el: HTMLElement): boolean {
  const { label, hints } = labelFor(el);
  return isTranscriptUpload(`${label} ${hints}`);
}

/** Score file inputs: the resume field, not the cover letter or "autofill from resume" box. */
export function findResumeTarget(fields: Field[]): HTMLElement | null {
  const files = fields.filter((f) => f.kind === 'file');
  let best: { el: HTMLElement; score: number } | null = null;
  for (const f of files) {
    const text = normalize(`${f.label} ${f.hints}`);
    let score = 0;
    if (/resume|r sum|cv\b|curriculum/.test(text)) score += 3;
    if (/cover|transcript|portfolio|writing sample|additional|other/.test(text)) score -= 6;
    if (/autofill|auto fill|parse|import/.test(text)) score -= 1;
    if (score > (best?.score ?? -1)) best = { el: f.el, score };
  }
  if (best && best.score >= 0) return best.el;
  return null;
}

async function attachTranscripts(ctx: FillContext, root: ParentNode, results: FieldResult[], notes: string[], onFilled: () => void): Promise<void> {
  // Cheap check first: most steps have no upload, and a full scan reads every label.
  if (!queryDeep('input[type=file]', root)) return;
  const fields = scanFields(root).filter((f) => f.kind === 'file' && !handled.has(f.el) && isTranscriptUpload(`${f.label} ${f.hints}`));
  for (const field of fields) {
    handled.add(field.el);
    const label = displayLabel(field);
    const key = `${pageKey()}|${normalize(label)}`;
    if (transcriptAttached.has(key)) continue;
    if (!ctx.transcript) {
      if (field.required) results.push({ label, status: 'review', reason: 'Required. Add your transcript under Options → Transcript, or attach it here.' });
      continue;
    }
    const hasFile = (field.el instanceof HTMLInputElement && !!field.el.files?.length) || uploadShowsFile(field.el);
    if (hasFile && !ctx.settings.overwriteExisting) {
      results.push({ label, status: 'skipped', reason: 'A file is already attached.' });
      continue;
    }
    const outcome = attachFile(field.el, ctx.transcript.file, 'transcript');
    if (outcome.ok) {
      transcriptAttached.add(key);
      onFilled();
      await waitForStable(document.body, 800, 6000);
      if (outcome.review && pageShows(ctx.transcript.file.name)) outcome.review = undefined;
    }
    if (outcome.ok && !outcome.review) notes.push('Transcript attached.');
    results.push({ label: `Transcript (${ctx.transcript.file.name})`, status: outcome.ok && !outcome.review ? 'filled' : 'review', reason: outcome.review });
  }
}

function overrideFor(field: Field, overrides: Override[], c: AnswerContext): Answer | null {
  for (const o of overrides) {
    if (!field.members.some((m) => m.matches(o.selector) || closestDeep(m, o.selector))) continue;
    const value = o.value(c);
    if (value === null || value === undefined || (Array.isArray(value) ? !value.length : !value)) return null;
    return { key: o.key, value, confidence: 'high', isDate: o.isDate };
  }
  return null;
}

export async function fillPage(ctx: FillContext, opts: EngineOptions): Promise<FillReport> {
  const root = opts.root ?? document;
  setTimeZone(ctx.settings.timeZone);
  const answers: AnswerContext = {
    profile: ctx.profile,
    jobTitle: document.querySelector('[data-test="topbar-job-title"], h1')?.textContent?.trim() || document.title,
    jobText: (document.body.innerText || document.body.textContent || '').slice(0, 30000),
    skills: ctx.skills?.length ? ctx.skills : ctx.profile.skills,
  };
  const results: FieldResult[] = [];
  const notes: string[] = [];
  const open: { field: Field; question: OpenQuestion }[] = [];
  let filled = 0;
  if (!opts.incremental) {
    clearHighlights();
    handled = new WeakSet();
    resumeAttachedOn = null;
    transcriptAttached = new Set();
  }

  // Dropdowns marked filled, re-checked at the end: Workday re-renders a
  // questionnaire as it's answered and can put an earlier pick back to "Select One".
  const picked: { field: Field; index: number }[] = [];
  const record = (field: Field, status: FieldResult['status'], reason?: string) => {
    if (status === 'filled' && field.el.matches('button[aria-haspopup="listbox"], select')) picked.push({ field, index: results.length });
    results.push({ label: displayLabel(field), status, reason });
    if (status !== 'skipped') highlight(field, status, ctx.settings.highlightFields);
    if (status === 'filled') filled++;
  };

  // 1. Resume first: many ATSs parse it and overwrite fields afterwards.
  // Only look for the upload when there's a resume this page hasn't had yet; that
  // spares a full scan on every pass that watches a wizard for new steps.
  let resumeEl = ctx.resume && resumeAttachedOn !== pageKey()
    ? opts.resumeTarget?.() ?? (queryDeep('input[type=file]', root) ? findResumeTarget(scanFields(root)) : null)
    : null;
  if (resumeEl && asksForTranscript(resumeEl)) resumeEl = null;
  if (ctx.resume && resumeEl && !handled.has(resumeEl) && resumeAttachedOn !== pageKey()) {
    handled.add(resumeEl);
    const hasFile = (resumeEl instanceof HTMLInputElement && !!resumeEl.files?.length) || uploadShowsFile(resumeEl);
    if (hasFile && !ctx.settings.overwriteExisting) {
      results.push({ label: 'Resume', status: 'skipped', reason: 'A file is already attached.' });
    } else {
      const outcome = attachFile(resumeEl, ctx.resume.file);
      if (outcome.ok) {
        resumeAttachedOn = pageKey();
        filled++;
        notes.push('Resume attached; waited for the site to finish reading it.');
        await waitForStable(document.body, 1200, 12_000);
        // Widgets that clear their <input> show the file name once they've taken the file.
        if (outcome.review && pageShows(ctx.resume.file.name)) outcome.review = undefined;
      }
      results.push({ label: `Resume (${ctx.resume.meta.name})`, status: outcome.ok && !outcome.review ? 'filled' : 'review', reason: outcome.review });
    }
  } else if (ctx.resume && !resumeEl && !opts.incremental) {
    notes.push('No resume upload field found on this page.');
  }

  // 1b. Transcript uploads ("Please upload a copy of your unofficial transcript").
  await attachTranscripts(ctx, root, results, notes, () => filled++);

  // 2. Every other field, twice: answers can reveal follow-up questions.
  for (let pass = 0; pass < 2; pass++) {
    const fields = scanFields(root).filter((f) => f.kind !== 'file' && !f.members.some((m) => handled.has(m)));
    if (pass > 0 && !fields.length) break;
    for (const field of fields) {
      // Workday re-renders a questionnaire after some answers; the next pass finds the new copy.
      if (!field.el.isConnected) continue;
      // Skipped fields stay unhandled: the adapter may fill them itself later (Oracle's entry forms).
      if (opts.skip?.(field)) continue;
      field.members.forEach((m) => handled.add(m));

      const question = normalize(field.label);
      const reviewBusiness = ctx.settings.reviewBusinessLines && /\bbusiness (?:lines?|line s|units?)\b|\bdivisions?\b.*\b(?:prefer|interested)\b/.test(question);
      const reviewExperience = ctx.settings.reviewExperienceLevels
        && !/\b(?:english|language|reading|writing|speaking|comprehension)\b/.test(question)
        && /\b(?:experience|proficiency) levels?\b|\blevels? (?:of |with )?(?:experience|proficiency)\b|\bhow experienced\b/.test(question);
      if (reviewBusiness || reviewExperience) {
        if (!currentValue(field)) record(field, 'review', 'Your settings leave this question for you to answer.');
        continue;
      }

      const resolution = resolveAnswer(field.label, field.hints, field.el.getAttribute('autocomplete'), answers, isChoice(field));
      let answer = resolution.matchedKey === 'locationPreference'
        ? resolution.answer
        : overrideFor(field, opts.overrides ?? [], answers) ?? usCitizenOption(field, answers) ?? resolution.answer;
      // A lone checkbox ("I agree to SMS", "Share my LinkedIn") only takes a yes/no answer.
      if (field.kind === 'checkbox' && answer && !/^(yes|no)$/i.test(asText(answer.value))) {
        const binary = answer.tiers?.flat().find((value) => /^(yes|no)$/i.test(value));
        answer = binary ? { ...answer, value: binary } : null;
      }
      // 'Enter "N/A" if not' under a text box: a No answer is typed as N/A.
      if (answer && (field.kind === 'text' || field.kind === 'textarea') && /^no$/i.test(asText(answer.value))
        && /\b(?:enter|type|write|put|answer|respond(?: with)?)\s+["“'‘]?n\s*\/?\s*a\b/i.test(`${field.label} ${textOfIds(field.el, 'aria-describedby')}`)) {
        answer = { ...answer, value: 'N/A' };
      }
      const existing = currentValue(field);
      if (answer?.value === LEAVE_EMPTY) continue; // a follow-up that doesn't apply
      // The site pre-filled one of your links without "https://" (Oracle copies it from the
      // resume text, then rejects it). Put back the full link from your profile.
      const fullLink = field.kind !== 'text' ? null
        : isLinkField(field) ? linkWithScheme(existing, answers.profile.links) : fullProfileLink(existing, answers.profile.links);
      if (fullLink) answer = { key: 'linkWithScheme', value: fullLink, confidence: 'high' };
      // A profile link saved without "https://" going into a link box: add it.
      else if (answer && isLinkField(field) && typeof answer.value === 'string') {
        const withScheme = linkWithScheme(answer.value, {});
        if (withScheme) answer = { ...answer, value: withScheme };
      }

      if (!answer) {
        if (existing) continue;
        if (field.kind === 'checkbox' && !field.required) continue; // marketing/SMS opt-ins stay unticked
        open.push({
          field,
          question: {
            id: open.length,
            label: displayLabel(field),
            kind: field.kind,
            options: optionsOf(field),
            required: field.required,
            maxLength: (field.el as HTMLInputElement).maxLength > 0 ? (field.el as HTMLInputElement).maxLength : undefined,
          },
        });
        continue;
      }
      // A bare "Science" left in Major is not your "Computer Science"; replace it.
      const bareFieldHead = answer.key === 'major' && isBareFieldHead(existing, asText(answer.value));
      // Resume parsers sometimes put the entire degree line (including degree
      // titles and minors) in Major. Use the saved major for that field.
      const parsedDegreeInMajor = answer.key === 'major' && field.kind === 'text'
        && normalize(asText(answer.value)).length > 2
        && normalize(existing).includes(normalize(asText(answer.value)))
        && /\b(?:b a|b s|b sc|m a|m s|bachelor|master|degree|minor)\b/.test(normalize(existing));
      const dateInEducationField = ['gpa', 'degree'].includes(answer.key) && /^\d{4}(?:-\d{2}){0,2}$/.test(existing);
      if (existing && !ctx.settings.overwriteExisting && !fullLink && !bareFieldHead && !parsedDegreeInMajor && !dateInEducationField) {
        results.push({ label: displayLabel(field), status: 'skipped', reason: 'Already has a value.' });
        continue;
      }

      let outcome: Outcome;
      try {
        outcome = await fillField(field, answer);
      } catch (err) {
        outcome = { ok: false, review: `Error while filling: ${err instanceof Error ? err.message : err}` };
      }
      if (!outcome.ok) record(field, 'review', outcome.review);
      else if (outcome.review || answer.confidence === 'low') record(field, 'review', outcome.review ?? 'Matched loosely — please check.');
      else record(field, 'filled');
      if (outcome.ok) await opts.afterField?.();
      await sleep(30);
    }
    await sleep(400);
  }

  // Link boxes the site filled after we passed them (Oracle copies links from the resume a
  // moment later), still without "https://", which the site then rejects.
  for (const field of scanFields(root)) {
    if (!field.el.isConnected || !isLinkField(field) || opts.skip?.(field)) continue;
    const fixed = linkWithScheme(currentValue(field), answers.profile.links);
    if (!fixed) continue;
    const outcome = await fillField(field, { key: 'linkWithScheme', value: fixed, confidence: 'high' }).catch(() => null);
    if (!outcome?.ok) continue;
    const label = displayLabel(field);
    for (let i = results.length - 1; i >= 0; i--) if (results[i].label === label && results[i].status === 'skipped') results.splice(i, 1);
    record(field, outcome.review ? 'review' : 'filled', outcome.review);
  }

  for (const { field, index } of picked) {
    const shown = field.el instanceof HTMLSelectElement ? currentValue(field) : (field.el.textContent ?? '').trim();
    if (!field.el.isConnected || (shown && !isPlaceholderOption(shown))) continue;
    results[index] = { ...results[index], status: 'review', reason: 'The site cleared this answer after it was picked. Pick it again.' };
    highlight(field, 'review', ctx.settings.highlightFields);
    filled--;
  }

  for (const { field, question } of open) {
    if (question.required && !results.some((r) => r.label === question.label)) {
      record(field, 'review', 'Required, and your profile has no answer.');
    }
  }

  const needsReview = results.filter((r) => r.status === 'review').length;
  return { ats: opts.ats, filled, needsReview, fields: results, notes };
}
