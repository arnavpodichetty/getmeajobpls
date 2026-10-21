import { describe, expect, it } from 'vitest';
import { cityState, isJobPosting, jobInfoForPage, payFromText, postedLabel, postingKey, readJobInfo } from '../src/lib/jobInfo';

function page(html: string, title = ''): Document {
  document.documentElement.innerHTML = `<head><title>${title}</title></head><body>${html}</body>`;
  return document;
}

describe('job details for the panel', () => {
  it('reads an Oracle Recruiting apply page header', () => {
    const doc = page(`
      <div class="app-header__current-page-title-container"><div data-bind="text: jobTitle">Machine Learning Summer Associate</div></div>
      <ul class="context-menu__list">
        <li class="context-menu__item posting-locations">Location: <span><ul><li>New York, NY, United States</li><li>Seattle, WA, United States</li><li>Palo Alto, CA, United States</li></ul></span></li>
        <li class="context-menu__item">Job Identification: <span>123</span></li>
        <li class="context-menu__item">Posting Date: <span>01/05/2025, 06:37 PM</span></li>
        <li class="context-menu__item">Base Pay/Salary: <span>New York,NY $135,000.00-$155,000.00; Seattle,WA $135,000.00-$155,000.00</span></li>
      </ul>`, 'Initech Careers');
    expect(readJobInfo(doc, new URL('https://initech.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/123/apply/section/1'))).toEqual({
      title: 'Machine Learning Summer Associate',
      company: 'Initech',
      location: 'New York, NY + 2 more',
      locations: 'New York, NY\nSeattle, WA\nPalo Alto, CA',
      pay: '$135,000 – $155,000',
      posted: 'Posted Jan 5, 2025',
    });
  });

  it('prefers the posting\'s schema.org JobPosting data', () => {
    const doc = page(`<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'JobPosting',
        title: 'Software Engineer Intern',
        hiringOrganization: { '@type': 'Organization', name: 'Globex' },
        jobLocation: [{ '@type': 'Place', address: { addressLocality: 'Austin', addressRegion: 'TX', addressCountry: 'US' } }],
        datePosted: '2025-03-14T09:00:00Z',
        baseSalary: { '@type': 'MonetaryAmount', currency: 'USD', value: { minValue: 45, maxValue: 52, unitText: 'HOUR' } },
      }],
    })}</script><h1>Apply</h1>`);
    expect(readJobInfo(doc, new URL('https://jobs.example.com/apply'))).toEqual({
      title: 'Software Engineer Intern', company: 'Globex', location: 'Austin, TX', locations: '', pay: '$45 – $52/hr', posted: 'Posted Mar 14, 2025',
    });
  });

  it('falls back to the ATS URL for the company and the description for pay', () => {
    const doc = page('<h1>Data Analyst</h1><p>The base salary range for this role is $95,000 - $120,000 per year, plus a 401(k).</p>');
    expect(readJobInfo(doc, new URL('https://job-boards.greenhouse.io/hooli/jobs/4567'))).toEqual(
      expect.objectContaining({ title: 'Data Analyst', company: 'Hooli', pay: '$95,000 – $120,000/yr' }),
    );
  });

  it.each([
    ['$40 - $45 per hour', '$40 – $45/hr'],
    ['$80-120K', '$80,000 – $120,000'],
    ['between $135,000.00 and $155,000.00', ''],
    ['£50,000 to £60,000 per annum', '£50,000 – £60,000/yr'],
    ['$32/hr', '$32/hr'],
    ['$28.50 an hour', '$28.50/hr'],
    ['$22.50 - $27.25 per hour', '$22.50 – $27.25/hr'],
    ['We match 401(k) contributions up to 6%', ''],
    ['$5 - $9 off lunch', ''],
  ])('reads pay from "%s"', (text, pay) => {
    expect(payFromText(text)).toBe(pay);
  });

  it.each([
    ['2026-10-20', 'Posted today'],
    ['2026-10-19T18:37:00Z', 'Posted yesterday'],
    ['10/14/2026, 06:37 PM', 'Posted 6 days ago'],
    ['2026-08-01', 'Posted Aug 1, 2026'],
    ['Posted 30+ Days Ago', 'Posted 30+ Days Ago'],
    ['3 days ago', 'Posted 3 days ago'],
    ['2026-11-02', ''],
    ['soon', ''],
  ])('labels the posting date %s', (raw, label) => {
    expect(postedLabel(raw, new Date(2026, 9, 20, 12))).toBe(label);
  });

  it.each([
    ['New York, New York', 'New York, NY'],
    ['San Francisco, California, United States', 'San Francisco, CA'],
    ['Seattle, WA, United States', 'Seattle, WA'],
    ['Austin, TX 78701', 'Austin, TX'],
    ['US-CA-San Jose', 'San Jose, CA'],
    ['USA, NY, New York', 'New York, NY'],
    ['London, England, United Kingdom', 'London, England'],
    ['Remote (US)', 'Remote (US)'],
    ['San Francisco Bay Area', 'San Francisco Bay Area'],
    ['Center Valley, Pennsylvania', 'Center Valley, PA'],
    ['Initech Headquarters', ''],
    ['01234-100 Main', ''],
    ['Building 4, Main Campus', ''],
  ])('shows %s as %s', (place, shown) => {
    expect(cityState(place)).toBe(shown);
  });

  it('shows several locations as the first one plus a count', () => {
    const doc = page('<h1 class="ashby-job-posting-heading">Data Engineer</h1><div><h2>Location</h2><p>San Francisco, California; New York, New York</p></div>');
    expect(readJobInfo(doc, new URL('https://jobs.ashbyhq.com/acme/1'))).toEqual(expect.objectContaining({
      location: 'San Francisco, CA + 1 more', locations: 'San Francisco, CA\nNew York, NY',
    }));
  });

  it('recognizes job posting pages before the application', () => {
    const workday = page('<h2 data-automation-id="jobPostingHeader">Analyst Intern</h2><a>Apply</a>');
    expect(isJobPosting(workday, new URL('https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Austin-TX/Analyst-Intern_R123'))).toBe(true);
    const search = page('<h1>Search for jobs</h1><ul><li>Analyst Intern</li></ul>');
    expect(isJobPosting(search, new URL('https://acme.wd5.myworkdayjobs.com/en-US/Careers'))).toBe(false);
    const ld = page(`<script type="application/ld+json">{"@type":"JobPosting","title":"Analyst"}</script>`);
    expect(isJobPosting(ld, new URL('https://careers.example.com/jobs/1'))).toBe(true);
    expect(isJobPosting(page('<h1>About us</h1>'), new URL('https://example.com/about'))).toBe(false);
  });

  it('reads a Workday posting from its header, not the building in its job data', () => {
    const doc = page(`<script type="application/ld+json">${JSON.stringify({
      '@type': 'JobPosting', title: 'Intern, Data Science', datePosted: '2025-02-03',
      jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressCountry: 'United States of America', addressLocality: 'Initech Headquarters' } },
      hiringOrganization: { name: '', '@type': 'Organization' },
    })}</script>
      <h2 data-automation-id="jobPostingHeader">Intern, Data Science</h2>
      <div data-automation-id="locations"><dl><dt>locations</dt><dd>Rochester, New York</dd></dl></div>
      <div data-automation-id="postedOn"><dl><dt>posted on</dt><dd>Posted Today</dd></dl></div>
      <p>The salary range for this role is: $19.00- $32.00 an hour</p>
      <div data-automation-id="jobSidebar"><h3>About Initech Corporation</h3></div>`);
    expect(readJobInfo(doc, new URL('https://itc.wd5.myworkdayjobs.com/Careers/job/Rochester-New-York/Intern_R-1'))).toEqual({
      title: 'Intern, Data Science', company: 'Initech Corporation', location: 'Rochester, NY', locations: '', pay: '$19 – $32/hr', posted: 'Posted Feb 3, 2025',
    });
  });

  it('never shows a building from job data as the location', () => {
    const doc = page(`<script type="application/ld+json">${JSON.stringify({
      '@type': 'JobPosting', title: 'Analyst',
      jobLocation: { address: { addressLocality: 'Globex Campus', addressRegion: 'TX', addressCountry: 'US' } },
    })}</script>`);
    expect(readJobInfo(doc, new URL('https://careers.example.com/1')).location).toBe('TX');
  });

  it('carries the posting\'s details to its application pages', () => {
    sessionStorage.clear();
    const base = 'https://itc.wd5.myworkdayjobs.com/Careers/job/Rochester-New-York/Intern_R-1';
    const ld = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'JobPosting', title: 'Intern, Data Science', datePosted: '2025-02-03',
      jobLocation: { address: { addressCountry: 'United States of America', addressLocality: 'Initech Headquarters' } },
    })}</script>`;
    page(`${ld}<h2 data-automation-id="jobPostingHeader">Intern, Data Science</h2>
      <div data-automation-id="locations"><dl><dd>Rochester, New York</dd></dl></div>
      <p>The salary range for this role is: $19.00- $32.00 an hour</p>
      <div data-automation-id="jobSidebar"><h3>About Initech Corporation</h3></div>`);
    const posting = jobInfoForPage(document, new URL(base));
    expect(posting).toEqual(expect.objectContaining({ company: 'Initech Corporation', location: 'Rochester, NY', pay: '$19 – $32/hr' }));

    // The application keeps only the JobPosting data: no header, pay or sidebar.
    page(`${ld}<h2>My Information</h2><input name="firstName">`);
    expect(jobInfoForPage(document, new URL(`${base}/apply/applyManually`))).toEqual(posting);

    // Another job in the same tab doesn't borrow them.
    page('<h2>My Information</h2>');
    expect(jobInfoForPage(document, new URL('https://itc.wd5.myworkdayjobs.com/Careers/job/Austin-Texas/Analyst_R-2/apply')).pay).toBe('');
  });

  it('gives a posting and its application steps the same key', () => {
    const oracle = 'https://acme.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/123';
    expect(postingKey(new URL(`${oracle}/apply/section/2`))).toBe(postingKey(new URL(oracle)));
    const workday = 'https://acme.wd5.myworkdayjobs.com/Careers/job/Austin-TX/Analyst_R-9';
    expect(postingKey(new URL(`${workday}/apply/autofillWithResume`))).toBe(postingKey(new URL(workday)));
    expect(postingKey(new URL(`${workday}/apply`))).not.toBe(postingKey(new URL('https://acme.wd5.myworkdayjobs.com/Careers/job/Austin-TX/Analyst_R-10')));
  });
});
