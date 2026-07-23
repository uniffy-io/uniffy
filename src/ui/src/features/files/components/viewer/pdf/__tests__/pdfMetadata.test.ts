import { describe, it, expect } from 'vitest';
import { parsePdfDate, extractPdfDocumentInfo, buildPdfInfoRows } from '../pdfMetadata';

describe('parsePdfDate', () => {
    it('parses a full timestamp', () => {
        const date = parsePdfDate('D:20260115093045');
        expect(date).not.toBeNull();
        expect(date?.getFullYear()).toBe(2026);
        expect(date?.getMonth()).toBe(0);
        expect(date?.getDate()).toBe(15);
        expect(date?.getHours()).toBe(9);
        expect(date?.getMinutes()).toBe(30);
        expect(date?.getSeconds()).toBe(45);
    });

    it('parses a partial date (year only)', () => {
        const date = parsePdfDate('D:2026');
        expect(date?.getFullYear()).toBe(2026);
        expect(date?.getMonth()).toBe(0);
        expect(date?.getDate()).toBe(1);
    });

    it('tolerates timezone suffixes', () => {
        const date = parsePdfDate("D:20260115093045+02'00'");
        expect(date?.getFullYear()).toBe(2026);
    });

    it('returns null for garbage input', () => {
        expect(parsePdfDate('not a date')).toBeNull();
        expect(parsePdfDate('')).toBeNull();
        expect(parsePdfDate(null)).toBeNull();
        expect(parsePdfDate(undefined)).toBeNull();
        expect(parsePdfDate('D:20261501000000')).toBeNull();
    });
});

describe('extractPdfDocumentInfo', () => {
    it('shapes string fields and drops empties', () => {
        const info = extractPdfDocumentInfo({
            Title: '  Annual Report ',
            Author: '',
            Producer: 'LibreOffice',
            PDFFormatVersion: '1.7',
            CreationDate: 'D:20260101',
        });
        expect(info.title).toBe('Annual Report');
        expect(info.author).toBeUndefined();
        expect(info.producer).toBe('LibreOffice');
        expect(info.formatVersion).toBe('1.7');
        expect(info.createdAt).toBeDefined();
    });

    it('handles non-object input', () => {
        expect(extractPdfDocumentInfo(null)).toEqual({});
        expect(extractPdfDocumentInfo(undefined)).toEqual({});
    });
});

describe('buildPdfInfoRows', () => {
    it('omits absent fields entirely', () => {
        const rows = buildPdfInfoRows({ title: 'Doc' }, 10, 1024);
        const labels = rows.map((row) => row.label);
        expect(labels).toEqual(['Title', 'Pages', 'Size']);
    });

    it('returns pages and size even without metadata', () => {
        const rows = buildPdfInfoRows(null, 5, 2048);
        expect(rows.find((row) => row.label === 'Pages')?.value).toBe('5');
        expect(rows.find((row) => row.label === 'Size')?.value).toBeTruthy();
    });
});
