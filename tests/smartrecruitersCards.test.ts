// SmartRecruiters after a resume upload: each parsed school is a closed card whose
// Major/Degree boxes only exist once Edit is clicked. Also: resume parsing can
// rewrite the email, so the confirmation must follow the email box.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { smartrecruiters } from '../src/adapters/smartrecruiters';
import { queryDeep } from '../src/lib/engine/dom';
import { context, fastTimings } from './helpers/fixture';

const formHtml = readFileSync(resolve(__dirname, 'fixtures/smartrecruiters-education.html'), 'utf8')
  .replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '');

/** An spl-button host with its real <button> in an open shadow root. */
function splButton(dataTest: string, onClick: () => void): HTMLElement {
  const host = document.createElement('spl-button');
  host.setAttribute('data-test', dataTest);
  const button = document.createElement('button');
  button.type = 'button';
  button.addEventListener('click', onClick);
  host.attachShadow({ mode: 'open' }).append(button);
  return host;
}

function attachShadows(root: ParentNode): void {
  for (const template of [...root.querySelectorAll<HTMLTemplateElement>('template[shadowrootmode]')]) {
    const host = template.parentElement!;
    if (host.shadowRoot) continue;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.append(template.content.cloneNode(true));
    template.remove();
    attachShadows(shadow);
  }
}

let saved: { major: string; degree: string } | null = null;

function closedCard(school: string): HTMLElement {
  const card = document.createElement('div');
  card.setAttribute('data-test', 'education-entry');
  const details = document.createElement('p');
  details.textContent = `${school} 2024 - 2028`;
  card.append(details, splButton('education-entry-edit', () => {
    const form = document.createElement('div');
    form.setAttribute('data-test', 'education-edit-form');
    form.innerHTML = formHtml;
    attachShadows(form);
    form.append(splButton('education-save', () => {
      saved = {
        major: queryDeep<HTMLInputElement>('input[id^="edu-major-"]', form)!.value,
        degree: queryDeep<HTMLInputElement>('input[id^="edu-degree-"]', form)!.value,
      };
      card.replaceWith(closedCard(school));
    }));
    card.replaceChildren(form);
  }));
  return card;
}

beforeEach(() => {
  fastTimings();
  saved = null;
  document.body.innerHTML = '';
});

describe('SmartRecruiters parsed education cards', () => {
  it('opens the card for your school, fills Major and Degree, and saves it', async () => {
    document.body.append(closedCard('University of California, Los Angeles'));
    const report = await smartrecruiters.fill(context({ resume: null }));
    expect(saved).toEqual({ major: 'Computer Science', degree: "Bachelor's Degree" });
    expect(report.fields.some((f) => f.label === 'University of California, Los Angeles: Major' && f.status === 'filled')).toBe(true);
    expect(queryDeep('[data-test="education-edit-form"]')).toBeNull();
  });

  it('leaves cards for schools that are not in your profile closed', async () => {
    document.body.append(closedCard('Springfield High School'));
    await smartrecruiters.fill(context({ resume: null }));
    expect(saved).toBeNull();
    expect(queryDeep('[data-test="education-edit-form"]')).toBeNull();
  });
});

describe('SmartRecruiters confirm email', () => {
  it('matches the confirmation to what is actually in the email box', async () => {
    document.body.innerHTML = `
      <label for="email-input">Email</label><input id="email-input" type="email" value="parsed@example.com">
      <label for="confirm-email-input">Confirm your email</label><input id="confirm-email-input" type="email">`;
    const report = await smartrecruiters.fill(context({ resume: null }));
    expect(queryDeep<HTMLInputElement>('#confirm-email-input')!.value).toBe('parsed@example.com');
    expect(report.fields.find((f) => /confirm/i.test(f.label))?.status).toBe('filled');
  });
});
