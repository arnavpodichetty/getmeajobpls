// The on-page panel shows on unrecognized sites only for forms that look like job applications.
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { looksLikeJobForm } from '../src/lib/engine/jobForm';
import { isVisible, resetLayoutCache } from '../src/lib/engine/dom';
import { scanFields } from '../src/lib/engine/scan';
import { loadFixture } from './helpers/fixture';

function check(url: string, title = document.title): boolean {
  resetLayoutCache();
  const headings = [...document.querySelectorAll('h1, h2')].map((h) => h.textContent ?? '').join(' ');
  return looksLikeJobForm(scanFields().filter((f) => isVisible(f.el)), { url, title, headings });
}

function page(title: string, body: string): void {
  document.title = title;
  document.body.innerHTML = body;
}

const fixtures = readdirSync(resolve(__dirname, 'fixtures'))
  .filter((f) => f.endsWith('.html'))
  .map((f) => f.replace('.html', ''))
  // Later wizard steps and single-section captures hold only a few fields; their ATS host is always recognized.
  .filter((f) => !/-[2-9]$/.test(f) && f !== 'smartrecruiters-education');

describe('job application forms on unrecognized hosts', () => {
  it.each(fixtures)('%s looks like an application', (name) => {
    loadFixture(name);
    expect(check('https://careers.example.com/apply/123')).toBe(true);
  });

  it('accepts a company-hosted form with a resume upload and a neutral URL', () => {
    page('Acme', `<h1>Join us</h1>
      <label>First name <input name="first"></label><label>Last name <input name="last"></label>
      <label>Email <input type="email" name="email"></label><label>Phone <input type="tel" name="phone"></label>
      <label>Resume <input type="file" name="resume"></label>`);
    expect(check('https://acme.com/form?id=7')).toBe(true);
  });
});

describe('everyday forms stay quiet', () => {
  it('ignores a sign-up form', () => {
    page('Create your account', `<h1>Sign up</h1>
      <label>Name <input></label><label>Email <input type="email"></label>
      <label>Password <input type="password"></label><label>Confirm password <input type="password"></label>`);
    expect(check('https://shop.example.com/signup')).toBe(false);
  });

  it('ignores a checkout form', () => {
    page('Checkout', `<h1>Shipping address</h1>
      <label>Full name <input></label><label>Address <input></label><label>City <input></label>
      <label>State <select><option>CA</option></select></label><label>ZIP <input></label>`);
    expect(check('https://store.example.com/checkout')).toBe(false);
  });

  it('ignores a contact form that mentions one job word', () => {
    page('Contact us', `<h2>Questions about your application?</h2>
      <label>Name <input></label><label>Email <input type="email"></label>
      <label>Subject <input></label><label>Message <textarea></textarea></label>`);
    expect(check('https://example.com/contact')).toBe(false);
  });

  it('ignores small forms even on careers pages', () => {
    page('Careers', `<h1>Jobs</h1><label>Search jobs <input></label><label>Location <input></label>`);
    expect(check('https://example.com/careers')).toBe(false);
  });
});
