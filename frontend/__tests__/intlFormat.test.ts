import { formatNumber, formatCurrency, formatDate, formatRelativeTime } from '../utils/intlFormat';

describe('intlFormat', () => {
  describe('formatNumber', () => {
    it('formats en with comma thousands, dot decimal', () => {
      expect(formatNumber(1234.56, 'en')).toBe('1,234.56');
    });

    it('formats es with dot thousands, comma decimal', () => {
      expect(formatNumber(1234.56, 'es')).toBe('1.234,56');
    });

    it('formats fr with a space-style thousands separator', () => {
      const result = formatNumber(1234.56, 'fr').replace(/\u202F|\u00A0/g, ' ');
      expect(result).toBe('1 234,56');
    });
  });

  describe('formatCurrency', () => {
    it('formats XLM amounts using es decimal conventions', () => {
      const result = formatCurrency(1234.56, 'XLM', 'es');
      expect(result).toContain('1.234,56');
      expect(result).toContain('XLM');
    });
  });

  describe('formatDate', () => {
    it('formats fr dates as dd/mm/yyyy', () => {
      const date = new Date(2026, 6, 23); // 23 Jul 2026
      expect(formatDate(date, 'fr')).toBe('23/07/2026');
    });

    it('formats en dates as mm/dd/yyyy', () => {
      const date = new Date(2026, 6, 23);
      expect(formatDate(date, 'en')).toBe('07/23/2026');
    });
  });

  describe('formatRelativeTime', () => {
    it('formats a past time in Spanish', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      expect(formatRelativeTime(twoHoursAgo, 'es')).toMatch(/hace/);
    });
  });
});
