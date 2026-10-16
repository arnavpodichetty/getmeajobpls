import { fillText } from '../lib/engine/controls';
import { queryAllDeep, queryDeep, realClick, sleep, waitForElement } from '../lib/engine/dom';
import { fillPage } from '../lib/engine/fill';
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
} as const;

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
      resumeTarget: () => queryDeep<HTMLElement>(SELECTORS.resume),
      skip: (field) => {
        if (!/if .*other.*university/i.test(field.label)) return false;
        const school = ctx.profile.education[0]?.school;
        if (!school) return false;
        const primary = scanFields().find((candidate) => candidate.kind === 'combobox'
          && /university/i.test(candidate.label) && !/other/i.test(candidate.label));
        return !!primary && schoolVariants(school).some((variant) => optionScore(currentValue(primary), variant) >= 0.85);
      },
    });
    if (!ctx.incremental) {
      await fillEducationCards(ctx, report);
      await syncConfirmEmail(report);
      report.filled = report.fields.filter((f) => f.status === 'filled').length;
      report.needsReview = report.fields.filter((f) => f.status === 'review').length;
    }
    return report;
  },
};
