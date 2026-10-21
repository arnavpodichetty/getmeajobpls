import { ashby } from './ashby';
import { boardAdapters } from './boards';
import { generic } from './generic';
import { greenhouse } from './greenhouse';
import { icims } from './icims';
import { lever } from './lever';
import { oracle } from './oracle';
import { smartrecruiters } from './smartrecruiters';
import { successfactors } from './successfactors';
import type { Adapter } from './types';
import { workday } from './workday';

/** Checked in order; generic must stay last. */
export const ADAPTERS: Adapter[] = [greenhouse, lever, ashby, workday, icims, smartrecruiters, successfactors, oracle, ...boardAdapters, generic];

export function detectAdapter(url: URL, doc: Document): Adapter {
  return ADAPTERS.find((a) => a.detect(url, doc)) ?? generic;
}
