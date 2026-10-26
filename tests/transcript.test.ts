import { beforeEach, describe, expect, it } from 'vitest';
import { asksForTranscript, fillPage, isTranscriptUpload } from '../src/lib/engine/fill';
import { resetLayoutCache } from '../src/lib/engine/dom';
import { context, fastTimings } from './helpers/fixture';

const transcriptFile = () => {
  const file = new File(['%PDF-1.4 transcript'], 'ada-transcript.pdf', { type: 'application/pdf' });
  return { meta: { id: 'transcript', kind: 'transcript' as const, name: 'Transcript', tags: [], skills: [], fileName: file.name, mimeType: 'application/pdf', size: file.size, uploadedAt: 0, isDefault: false }, file };
};

// Greenhouse's new board: the resume and a custom "unofficial transcript" upload (from a live capture).
const greenhouseUpload = (id: string, label: string, required: boolean) => `
  <div class="field-wrapper"><div role="group" aria-labelledby="upload-label-${id}" aria-required="${required}" class="file-upload">
    <div id="upload-label-${id}" class="label upload-label">${label}${required ? '<span class="required">*</span>' : ''}</div>
    <div class="file-upload__wrapper"><div class="button-container">
      <div class="secondary-button"><div><button type="button" class="btn btn--pill">Attach</button>
      <label class="visually-hidden" for="${id}">Attach</label>
      <input id="${id}" class="visually-hidden" type="file" accept=".pdf,.doc,.docx,.txt,.rtf"></div></div>
      <div class="secondary-button"><button type="button" class="btn btn--pill">Dropbox</button></div>
    </div></div>
  </div></div>`;

const greenhouse = () => `<form>
  ${greenhouseUpload('resume', 'Resume/CV', true)}
  ${greenhouseUpload('cover_letter', 'Cover Letter', false)}
  ${greenhouseUpload('question_13056583007', 'Please upload a copy of your unofficial transcript. ', true)}
</form>`;

// Workday application questions: a transcript attachment question is the only upload on the step.
const workdayQuestion = () => `<div data-automation-id="formField-" data-fkit-id="questionnaire--transcript">
  <label id="label9"><span>Please upload your most recent unofficial transcript<abbr aria-hidden="true">*</abbr></span></label>
  <div data-automation-id="attachments-FileUpload" aria-labelledby="label9">
    <input type="file" data-automation-id="file-upload-input-ref" />
  </div>
</div>`;

const fileOf = (id: string) => (document.getElementById(id) as HTMLInputElement).files?.[0]?.name;

describe('transcript uploads', () => {
  beforeEach(() => {
    fastTimings();
    resetLayoutCache();
  });

  it('recognizes transcript questions but not interview transcripts', () => {
    expect(isTranscriptUpload('Please upload a copy of your unofficial transcript.')).toBe(true);
    expect(isTranscriptUpload('Academic Transcripts')).toBe(true);
    expect(isTranscriptUpload('Upload the transcript of your video interview')).toBe(false);
    expect(isTranscriptUpload('Resume/CV')).toBe(false);
  });

  it('puts the resume and the transcript in their own Greenhouse uploads', async () => {
    document.body.innerHTML = greenhouse();
    expect(asksForTranscript(document.getElementById('question_13056583007')!)).toBe(true);
    const report = await fillPage(context({ transcript: transcriptFile() }), { ats: 'Greenhouse', resumeTarget: () => document.querySelector('input#resume') });
    expect(fileOf('resume')).toBe('ada-resume.pdf');
    expect(fileOf('question_13056583007')).toBe('ada-transcript.pdf');
    expect(fileOf('cover_letter')).toBeUndefined();
    expect(report.fields.find((f) => f.label.startsWith('Transcript'))?.status).toBe('filled');
  });

  it('flags a required transcript upload when none is saved', async () => {
    document.body.innerHTML = greenhouse();
    const report = await fillPage(context(), { ats: 'Greenhouse', resumeTarget: () => document.querySelector('input#resume') });
    expect(fileOf('question_13056583007')).toBeUndefined();
    const field = report.fields.find((f) => /transcript/i.test(f.label));
    expect(field?.status).toBe('review');
  });

  it('never puts the resume in a Workday transcript question', async () => {
    document.body.innerHTML = workdayQuestion();
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
    const report = await fillPage(context({ transcript: transcriptFile() }), {
      ats: 'Workday',
      resumeTarget: () => [...document.querySelectorAll<HTMLElement>('input[type=file]')].find((el) => !asksForTranscript(el)) ?? null,
    });
    expect(input.files?.[0]?.name).toBe('ada-transcript.pdf');
    expect(report.fields.some((f) => f.label.startsWith('Resume'))).toBe(false);
  });

  it('attaches the transcript once across incremental passes', async () => {
    document.body.innerHTML = workdayQuestion();
    let attaches = 0;
    document.querySelector('input[type=file]')!.addEventListener('change', () => attaches++);
    const ctx = context({ resume: null, transcript: transcriptFile() });
    await fillPage(ctx, { ats: 'Workday' });
    // Workday re-renders the upload after taking the file.
    document.body.innerHTML = workdayQuestion();
    document.querySelector('input[type=file]')!.addEventListener('change', () => attaches++);
    await fillPage({ ...ctx, incremental: true }, { ats: 'Workday', incremental: true });
    expect(attaches).toBe(1);
  });
});
