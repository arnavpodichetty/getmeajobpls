import type { Profile } from './types';

/**
 * "1-415-555-0100": country code, then the 10-digit number in groups, for phone
 * boxes that ask for that form (Greenhouse, Ashby). A number saved with its
 * country code ("+1 415 555 0100") is grouped the same way. Other lengths are
 * left as saved.
 */
export function dashedPhone(p: Profile): string {
  const cc = p.personal.phoneCountryCode.replace(/\D/g, '');
  let digits = p.personal.phone.replace(/\D/g, '');
  if (cc && digits.length === 10 + cc.length && digits.startsWith(cc)) digits = digits.slice(cc.length);
  if (digits.length !== 10) return p.personal.phone;
  const local = `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return cc ? `${cc}-${local}` : local;
}
