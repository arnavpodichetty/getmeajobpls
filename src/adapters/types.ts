import type { FillReport, Profile, ResumeMeta, Settings } from '../lib/types';

export interface ResumeFile {
  meta: ResumeMeta;
  file: File;
}

export interface FillContext {
  profile: Profile;
  resume: ResumeFile | null;
  settings: Settings;
  /** Skills from the chosen skill set (overrides resume and profile skills). */
  skills?: string[];
  /** Only fill fields that appeared since the last fill (next step of a wizard). */
  incremental?: boolean;
}

/**
 * One adapter per ATS. To add an ATS, create a file exporting an Adapter and
 * register it in ./index.ts (see README).
 */
export interface Adapter {
  /** Stable id, e.g. "greenhouse". */
  id: string;
  /** Display name for the popup. */
  name: string;
  /** True when this adapter handles the given frame. Runs in every frame. */
  detect(url: URL, doc: Document): boolean;
  fill(ctx: FillContext): Promise<FillReport>;
}
