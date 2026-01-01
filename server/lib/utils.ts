import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js';

export function normalizePhone(phone: string, defaultCountry: string = 'US'): string | null {
  try {
    if (!phone) return null;

    const cleaned = phone.replace(/\D/g, '');

    if (!isValidPhoneNumber(phone, defaultCountry as any)) {
      if (cleaned.length >= 10) {
        const testPhone = defaultCountry === 'US' ? `+1${cleaned}` : `+${cleaned}`;
        if (isValidPhoneNumber(testPhone)) {
          const parsed = parsePhoneNumber(testPhone);
          return parsed.format('E.164');
        }
      }
      return null;
    }

    const parsed = parsePhoneNumber(phone, defaultCountry as any);
    return parsed.format('E.164');
  } catch (error) {
    console.error('Phone normalization error:', error);
    return null;
  }
}

export function isWithinQuietHours(
  timezone: string,
  quietStart: string,
  quietEnd: string
): boolean {
  try {
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', {
      timeZone: timezone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });

    const [currentHour, currentMinute] = timeString.split(':').map(Number);
    const currentMinutes = currentHour * 60 + currentMinute;

    const [startHour, startMinute] = quietStart.split(':').map(Number);
    const startMinutes = startHour * 60 + startMinute;

    const [endHour, endMinute] = quietEnd.split(':').map(Number);
    const endMinutes = endHour * 60 + endMinute;

    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    } else {
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
  } catch (error) {
    console.error('Quiet hours check error:', error);
    return false;
  }
}

/**
 * 30-minute cooldown dedupe:
 * - Same contact/phone within the same window => same dedupeKey (deduped)
 * - After the window rolls over => new dedupeKey (allowed)
 *
 * Configure via env: DEDUPE_WINDOW_MINUTES (default 30)
 */
export function generateDedupeKey(contactId?: string, phone?: string): string {
  const windowMinutesRaw = process.env.DEDUPE_WINDOW_MINUTES;
  const windowMinutes = Number.isFinite(Number(windowMinutesRaw)) && Number(windowMinutesRaw) > 0
    ? Number(windowMinutesRaw)
    : 30;

  const windowMs = windowMinutes * 60 * 1000;
  const bucket = Math.floor(Date.now() / windowMs);

  const safeContactId = contactId?.trim();
  const safePhone = phone?.trim();

  if (safeContactId) {
    return `contact_${safeContactId}_w${windowMinutes}_b${bucket}`;
  }

  if (safePhone) {
    return `phone_${safePhone}_w${windowMinutes}_b${bucket}`;
  }

  throw new Error('Cannot generate dedupe key without contactId or phone');
}
