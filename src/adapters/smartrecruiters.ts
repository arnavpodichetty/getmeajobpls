import { attachFile, fillText } from '../lib/engine/controls';
import { queryAllDeep, queryDeep, realClick, sleep, waitForElement } from '../lib/engine/dom';
import { fillPage, isTranscriptUpload } from '../lib/engine/fill';
import { labelFor } from '../lib/engine/labels';
import { currentValue, scanFields } from '../lib/engine/scan';
import { optionScore, normalize, schoolVariants } from '../lib/engine/text';
import type { Education, FillReport } from '../lib/types';
import type { Adapter, FillContext } from './types';

// SmartRecruiters' apply page is built from spl-* web components; the engine
// walks their open shadow roots. Selectors here are searched deeply.
const SELECTORS = {
  resume: 'spl-dropzone input[type=file], input[type=file][accept*="pdf" i]',
  email: 'input#email-input',
  confirmEmail: 'input#confirm-email-input',
  // After a resume upload, each parsed school is a closed card; Major and
  // Degree only exist once its Edit button opens the form.
  educationCard: '[data-test="education-entry"]',
  educationEdit: '[data-test="education-entry-edit"]',
  educationForm: '[data-test="education-edit-form"]',
  educationSave: '[data-test="education-save"]',
  // Screening questions: each sits in its own container. An info block can ask
  // for a document that the "Additional attachments" upload under it takes.
  question: '[data-test="question-container"]',
  info: 'sr-question-field-info',
  attachments: 'sr-question-field-files',
  fileInput: 'input[type=file]',
  attachedFile: '.c-spl-file-list-item-name',
} as const;

/** Uploads for something other than the resume. */
const OTHER_UPLOAD = /\b(?:additional|other|cover|transcripts?|portfolio|writing sample|supporting)\b/;

/** The resume drop zone, never an "Additional attachments" box. */
function resumeUpload(): HTMLElement | null {
  return queryAllDeep<HTMLElement>(SELECTORS.resume).find((el) => !OTHER_UPLOAD.test(normalize(labelFor(el).label))) ?? null;
}

const attachedNames = (container: Element) => queryAllDeep(SELECTORS.attachedFile, container).map((el) => (el.textContent ?? '').trim());

/**
 * "Please submit a school transcript (REQUIRED)" as an info block, with the
 * "Additional attachments" upload right after it: the transcript goes there.
 */
async function attachRequestedTranscript(ctx: FillContext, report: FillReport): Promise<void> {
  for (const container of queryAllDeep(SELECTORS.question)) {
    const input = queryDeep(SELECTORS.attachments, container) ? queryDeep<HTMLInputElement>(SELECTORS.fileInput, container) : null;
    const prev = container.previousElementSibling;
    if (!input || !prev?.matches(SELECTORS.question) || !queryDeep(SELECTORS.info, prev)) continue;
    const request = queryAllDeep('[slot="label-content"]', prev).map((el) => el.textContent ?? '').join(' ');
    if (!isTranscriptUpload(request)) continue;
    const label = 'Transcript';
    if (!ctx.transcript) {
      report.fields.push({ label, status: 'review', reason: 'This job asks for your transcript. Add it under Options → Transcript, or attach it here.' });
      continue;
    }
    const name = ctx.transcript.file.name;
    if (attachedNames(container).includes(name)) continue;
    const outcome = attachFile(input, ctx.transcript.file, 'transcript');
    if (outcome.ok) await waitForElement(() => (attachedNames(container).includes(name) ? container : null), 4000);
    const shown = attachedNames(container).includes(name);
    report.fields.push({ label: `${label} (${name})`, status: outcome.ok && (shown || !outcome.review) ? 'filled' : 'review', reason: shown ? undefined : outcome.review });
  }
}

/** The real <button> inside an spl-button / oc-button host. */
const innerButton = (host: Element): HTMLElement => (host instanceof HTMLButtonElement ? host : queryDeep<HTMLElement>('button', host) ?? (host as HTMLElement));

/** The profile school a card describes, by its visible text. */
function schoolFor(card: Element, education: Education[]): Education | undefined {
  const text = normalize(card.textContent ?? '');
  return education.find((ed) => ed.school && schoolVariants(ed.school).some((v) => {
    const name = normalize(v);
    return name.length > 3 && text.includes(name);
  }));
}

/** Open each closed card for one of your schools, fill it from that school, and save it. */
async function fillEducationCards(ctx: FillContext, report: FillReport): Promise<void> {
  const cards = queryAllDeep(SELECTORS.educationCard).filter((card) => !queryDeep(SELECTORS.educationForm, card) && queryDeep(SELECTORS.educationEdit, card));
  for (const card of cards) {
    const school = schoolFor(card, ctx.profile.education);
    if (!school) continue;
    if (queryDeep(SELECTORS.educationForm)) {
      report.notes.push(`Close the open education form, then fill again to complete ${school.school}.`);
      return;
    }
    realClick(innerButton(queryDeep(SELECTORS.educationEdit, card)!));
    const form = await waitForElement(() => queryDeep<HTMLElement>(SELECTORS.educationForm));
    if (!form) continue;
    await sleep(300);
    const sub = await fillPage({ ...ctx, resume: null, profile: { ...ctx.profile, education: [school] } }, { ats: 'SmartRecruiters', root: form, incremental: true });
    report.fields.push(...sub.fields.map((f) => ({ ...f, label: `${school.school}: ${f.label}` })));
    report.filled += sub.filled;
    report.needsReview += sub.needsReview;

    const save = queryDeep(SELECTORS.educationSave, form);
    if (save) realClick(innerButton(save));
    const closed = await waitForElement(() => (queryDeep(SELECTORS.educationForm) ? null : document.body), 4000);
    if (!closed) report.notes.push(`Check and save the education entry for ${school.school}.`);
  }
}

/** Resume parsing can rewrite the email after we fill; keep the confirmation matching what's in the email box. */
async function syncConfirmEmail(report: FillReport): Promise<void> {
  await sleep(1500);
  const email = queryDeep<HTMLInputElement>(SELECTORS.email);
  const confirm = queryDeep<HTMLInputElement>(SELECTORS.confirmEmail);
  if (!email?.value.trim() || !confirm || confirm.value === email.value) return;
  const outcome = fillText(confirm, email.value);
  const existing = report.fields.find((f) => /confirm/i.test(f.label) && /e ?mail/i.test(f.label));
  const result = { label: existing?.label ?? 'Confirm your email', status: outcome.ok ? 'filled' as const : 'review' as const, reason: outcome.ok ? undefined : outcome.review };
  if (existing) Object.assign(existing, result);
  else report.fields.push(result);
}

export const smartrecruiters: Adapter = {
  id: 'smartrecruiters',
  name: 'SmartRecruiters',
  detect(url) {
    return url.hostname.endsWith('.smartrecruiters.com') || url.hostname === 'www.smartr.me';
  },
  async fill(ctx) {
    const report = await fillPage(ctx, {
      ats: this.name,
      incremental: ctx.incremental,
      resumeTarget: resumeUpload,
      skip: (field) => {
        if (!/if .*other.*university/i.test(field.label)) return false;
        const school = ctx.profile.education[0]?.school;
        if (!school) return false;
        const primary = scanFields().find((candidate) => candidate.kind === 'combobox'
          && /university/i.test(candidate.label) && !/other/i.test(candidate.label));
        return !!primary && schoolVariants(school).some((variant) => optionScore(currentValue(primary), variant) >= 0.85);
      },
    });
    await attachRequestedTranscript(ctx, report);
    if (!ctx.incremental) {
      await fillEducationCards(ctx, report);
      await syncConfirmEmail(report);
      report.filled = report.fields.filter((f) => f.status === 'filled').length;
      report.needsReview = report.fields.filter((f) => f.status === 'review').length;
    }
    return report;
  },
};
