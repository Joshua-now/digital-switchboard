import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js';
export function normalizePhone(phone, defaultCountry = 'US') {
    try {
        if (!phone)
            return null;
        const cleaned = phone.replace(/\D/g, '');
        if (!isValidPhoneNumber(phone, defaultCountry)) {
            if (cleaned.length >= 10) {
                const testPhone = defaultCountry === 'US' ? `+1${cleaned}` : `+${cleaned}`;
                if (isValidPhoneNumber(testPhone)) {
                    const parsed = parsePhoneNumber(testPhone);
                    return parsed.format('E.164');
                }
            }
            return null;
        }
        const parsed = parsePhoneNumber(phone, defaultCountry);
        return parsed.format('E.164');
    }
    catch (error) {
        console.error('Phone normalization error:', error);
        return null;
    }
}
export function isWithinQuietHours(timezone, quietStart, quietEnd) {
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
        }
        else {
            return currentMinutes >= startMinutes || currentMinutes < endMinutes;
        }
    }
    catch (error) {
        console.error('Quiet hours check error:', error);
        return false;
    }
}
export function generateDedupeKey(contactId, phone) {
    if (contactId) {
        return `contact_${contactId}`;
    }
    if (phone) {
        const date = new Date().toISOString().split('T')[0];
        return `phone_${phone}_${date}`;
    }
    throw new Error('Cannot generate dedupe key without contactId or phone');
}
