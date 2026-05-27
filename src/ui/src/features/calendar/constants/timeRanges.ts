export const WORKING_HOURS = {
  START: '09:00',
  END: '17:00',
  LUNCH_START: '12:00',
  LUNCH_END: '13:00',
} as const;

export const DEFAULT_DURATIONS = {
  QUICK: 15,
  SHORT: 30,
  STANDARD: 60,
  LONG: 90,
  FOCUS: 120,
  ALL_DAY: 480,
} as const;

export const TIME_INTERVALS = {
  FINE: 5,
  STANDARD: 15,
  COARSE: 30,
  HOUR: 60,
} as const;

export const TIME_FORMATS = {
  TWELVE_HOUR: 'h:mm A',
  TWENTY_FOUR_HOUR: 'HH:mm',
  HOUR_ONLY_12: 'h A',
  HOUR_ONLY_24: 'HH',
} as const;

export const COMMON_TIMEZONES = [
  { label: 'Pacific Time (PT)', value: 'America/Los_Angeles', offset: 'GMT-8' },
  { label: 'Mountain Time (MT)', value: 'America/Denver', offset: 'GMT-7' },
  { label: 'Central Time (CT)', value: 'America/Chicago', offset: 'GMT-6' },
  { label: 'Eastern Time (ET)', value: 'America/New_York', offset: 'GMT-5' },
  { label: 'UTC', value: 'UTC', offset: 'GMT+0' },
  { label: 'London (GMT)', value: 'Europe/London', offset: 'GMT+0' },
  { label: 'Central European Time', value: 'Europe/Paris', offset: 'GMT+1' },
  { label: 'Eastern European Time', value: 'Europe/Sofia', offset: 'GMT+2' },
  { label: 'Moscow Time', value: 'Europe/Moscow', offset: 'GMT+3' },
  { label: 'India Standard Time', value: 'Asia/Kolkata', offset: 'GMT+5:30' },
  { label: 'Singapore Time', value: 'Asia/Singapore', offset: 'GMT+8' },
  { label: 'Japan Standard Time', value: 'Asia/Tokyo', offset: 'GMT+9' },
  { label: 'Australian Eastern Time', value: 'Australia/Sydney', offset: 'GMT+11' },
] as const;

export function generateTimeSlots(
  intervalMinutes: number = TIME_INTERVALS.STANDARD,
  startHour: number = 0,
  endHour: number = 24
): { value: string; label: string }[] {
  const slots: { value: string; label: string }[] = [];

  for (let hour = startHour; hour < endHour; hour++) {
    for (let minute = 0; minute < 60; minute += intervalMinutes) {
      const hourStr = hour.toString().padStart(2, '0');
      const minuteStr = minute.toString().padStart(2, '0');
      const value = `${hourStr}:${minuteStr}`;

      const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
      const period = hour < 12 ? 'AM' : 'PM';
      const label = minute === 0
        ? `${displayHour} ${period}`
        : `${displayHour}:${minuteStr} ${period}`;

      slots.push({ value, label });
    }
  }

  return slots;
}

export function getBusinessHoursSlots(): { value: string; label: string }[] {
  return generateTimeSlots(TIME_INTERVALS.STANDARD, 8, 18);
}

export const DURATION_OPTIONS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1 hour' },
  { value: 90, label: '1.5 hours' },
  { value: 120, label: '2 hours' },
  { value: 180, label: '3 hours' },
  { value: 240, label: '4 hours' },
] as const;

export const REMINDER_OPTIONS = [
  { value: 0, label: 'At time of event' },
  { value: 5, label: '5 minutes before' },
  { value: 10, label: '10 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 120, label: '2 hours before' },
  { value: 1440, label: '1 day before' },
  { value: 2880, label: '2 days before' },
] as const;

export const WEEK_START_OPTIONS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 6, label: 'Saturday' },
] as const;

export const DISPLAY_HOURS = [
  { hour: 0, label: '12 AM' },
  { hour: 1, label: '1 AM' },
  { hour: 2, label: '2 AM' },
  { hour: 3, label: '3 AM' },
  { hour: 4, label: '4 AM' },
  { hour: 5, label: '5 AM' },
  { hour: 6, label: '6 AM' },
  { hour: 7, label: '7 AM' },
  { hour: 8, label: '8 AM' },
  { hour: 9, label: '9 AM' },
  { hour: 10, label: '10 AM' },
  { hour: 11, label: '11 AM' },
  { hour: 12, label: '12 PM' },
  { hour: 13, label: '1 PM' },
  { hour: 14, label: '2 PM' },
  { hour: 15, label: '3 PM' },
  { hour: 16, label: '4 PM' },
  { hour: 17, label: '5 PM' },
  { hour: 18, label: '6 PM' },
  { hour: 19, label: '7 PM' },
  { hour: 20, label: '8 PM' },
  { hour: 21, label: '9 PM' },
  { hour: 22, label: '10 PM' },
  { hour: 23, label: '11 PM' },
] as const;
