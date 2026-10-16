import { fillPage } from '../lib/engine/fill';
import type { Adapter } from './types';

/** Fallback for every other site: label-based matching over all visible fields. */
export const generic: Adapter = {
  id: 'generic',
  name: 'Unknown site',
  detect: () => true,
  async fill(ctx) {
    return fillPage(ctx, { ats: this.name, incremental: ctx.incremental });
  },
};
