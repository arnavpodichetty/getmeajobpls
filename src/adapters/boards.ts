import { fillPage } from '../lib/engine/fill';
import type { Adapter } from './types';

/**
 * ATSs whose forms the shared engine fills well on its own. They're listed so
 * the popup can name the site, and so it fills the right frame when the form
 * is embedded. Give one its own file (like lever.ts) when it needs special
 * handling.
 */
const BOARDS: { id: string; name: string; host: RegExp }[] = [
  { id: 'workable', name: 'Workable', host: /(^|\.)(apply\.)?workable\.com$/ },
  { id: 'recruitee', name: 'Recruitee', host: /\.recruitee\.com$/ },
  { id: 'jobvite', name: 'Jobvite', host: /(^|\.)jobvite\.com$/ },
  { id: 'rippling', name: 'Rippling', host: /^ats\.rippling\.com$/ },
  { id: 'dover', name: 'Dover', host: /(^|\.)dover\.(com|io)$/ },
  { id: 'teamtailor', name: 'Teamtailor', host: /\.teamtailor\.com$/ },
  { id: 'breezy', name: 'Breezy HR', host: /\.breezy\.hr$/ },
  { id: 'bamboohr', name: 'BambooHR', host: /\.bamboohr\.com$/ },
  { id: 'jazzhr', name: 'JazzHR', host: /(\.applytojob\.com|\.jazzhr\.com)$/ },
  { id: 'taleo', name: 'Taleo', host: /\.taleo\.net$/ },
  { id: 'oracle', name: 'Oracle Recruiting', host: /\.oraclecloud\.com$/ },
  { id: 'adp', name: 'ADP', host: /(workforcenow|recruiting)\.adp\.com$/ },
  { id: 'ukg', name: 'UKG', host: /(ultipro\.com|ukg\.net)$/ },
  { id: 'dayforce', name: 'Dayforce', host: /dayforcehcm\.com$/ },
  { id: 'paylocity', name: 'Paylocity', host: /recruiting\.paylocity\.com$/ },
  { id: 'phenom', name: 'Phenom', host: /phenompeople\.com$/ },
  { id: 'eightfold', name: 'Eightfold', host: /eightfold\.ai$/ },
  { id: 'avature', name: 'Avature', host: /avature\.net$/ },
  { id: 'pinpoint', name: 'Pinpoint', host: /pinpointhq\.com$/ },
  { id: 'personio', name: 'Personio', host: /jobs\.personio\.(de|com)$/ },
  { id: 'wellfound', name: 'Wellfound', host: /wellfound\.com$/ },
  { id: 'gem', name: 'Gem', host: /jobs\.gem\.com$/ },
  { id: 'comeet', name: 'Comeet', host: /comeet\.(co|com)$/ },
  { id: 'jobscore', name: 'JobScore', host: /jobscore\.com$/ },
  { id: 'freshteam', name: 'Freshteam', host: /freshteam\.com$/ },
  { id: 'zoho', name: 'Zoho Recruit', host: /zohorecruit\.(com|eu|in)$/ },
  { id: 'cornerstone', name: 'Cornerstone', host: /csod\.com$/ },
];

export const boardAdapters: Adapter[] = BOARDS.map((b) => ({
  id: b.id,
  name: b.name,
  detect: (url) => b.host.test(url.hostname),
  fill(ctx) {
    return fillPage(ctx, { ats: b.name, incremental: ctx.incremental });
  },
}));
