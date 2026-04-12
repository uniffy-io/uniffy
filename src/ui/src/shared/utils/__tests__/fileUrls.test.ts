import { describe, it, expect } from 'vitest';
import {
    buildFileUrl,
    buildThumbnailUrl,
    buildMediaStreamUrl,
    buildAvatarUrl,
    FILE_URL_PATTERN,
    THUMBNAIL_URL_PATTERN,
    MEDIA_STREAM_URL_PATTERN,
    AVATAR_URL_PATTERN,
    parseFileUrl,
    parseMediaStreamUrl,
    extractFileId,
} from '../fileUrls';

const ORG_ID = '019c5ade-9095-724d-ae00-c87d70a50700';
const FILE_ID = '019c6285-0bdb-7394-879f-9c37145765ae';
const USER_ID = '019c5ade-1234-5678-9abc-def012345678';

// URL Builders

describe('buildFileUrl', () => {
    it('builds correct file URL', () => {
        expect(buildFileUrl(ORG_ID, FILE_ID)).toBe(`/api/files/${ORG_ID}/${FILE_ID}`);
    });
});

describe('buildThumbnailUrl', () => {
    it('builds correct thumbnail URL', () => {
        expect(buildThumbnailUrl(ORG_ID, FILE_ID)).toBe(`/api/thumbnails/${ORG_ID}/${FILE_ID}`);
    });
});

describe('buildMediaStreamUrl', () => {
    it('builds correct media stream URL', () => {
        expect(buildMediaStreamUrl(ORG_ID, FILE_ID)).toBe(`/media-stream/${ORG_ID}/${FILE_ID}`);
    });
});

describe('buildAvatarUrl', () => {
    it('builds correct avatar URL', () => {
        expect(buildAvatarUrl(USER_ID, '128')).toBe(`/api/avatars/${USER_ID}/128?_v=2`);
    });
});

// URL Patterns (regex)

describe('FILE_URL_PATTERN', () => {
    it('matches valid file URL', () => {
        const match = `/api/files/${ORG_ID}/${FILE_ID}`.match(FILE_URL_PATTERN);
        expect(match).not.toBeNull();
        expect(match![1]).toBe(ORG_ID);
        expect(match![2]).toBe(FILE_ID);
    });

    it('does not match URL with extra path segments', () => {
        expect(`/api/files/${ORG_ID}/${FILE_ID}/extra`.match(FILE_URL_PATTERN)).toBeNull();
    });

    it('does not match thumbnail URL', () => {
        expect(`/api/thumbnails/${ORG_ID}/${FILE_ID}`.match(FILE_URL_PATTERN)).toBeNull();
    });

    it('does not match media stream URL', () => {
        expect(`/media-stream/${ORG_ID}/${FILE_ID}`.match(FILE_URL_PATTERN)).toBeNull();
    });
});

describe('THUMBNAIL_URL_PATTERN', () => {
    it('matches valid thumbnail URL', () => {
        const match = `/api/thumbnails/${ORG_ID}/${FILE_ID}`.match(THUMBNAIL_URL_PATTERN);
        expect(match).not.toBeNull();
        expect(match![1]).toBe(ORG_ID);
        expect(match![2]).toBe(FILE_ID);
    });
});

describe('MEDIA_STREAM_URL_PATTERN', () => {
    it('matches valid media stream URL', () => {
        const match = `/media-stream/${ORG_ID}/${FILE_ID}`.match(MEDIA_STREAM_URL_PATTERN);
        expect(match).not.toBeNull();
        expect(match![1]).toBe(ORG_ID);
        expect(match![2]).toBe(FILE_ID);
    });
});

describe('AVATAR_URL_PATTERN', () => {
    it('matches valid avatar URL', () => {
        const match = `/api/avatars/${USER_ID}/128`.match(AVATAR_URL_PATTERN);
        expect(match).not.toBeNull();
        expect(match![1]).toBe(USER_ID);
        expect(match![2]).toBe('128');
    });
});

// URL Parsers

describe('parseFileUrl', () => {
    it('parses relative file URL', () => {
        const result = parseFileUrl(`/api/files/${ORG_ID}/${FILE_ID}`);
        expect(result).toEqual({ organizationId: ORG_ID, fileId: FILE_ID });
    });

    it('parses full file URL (as returned by img.src)', () => {
        const result = parseFileUrl(`http://localhost:5173/api/files/${ORG_ID}/${FILE_ID}`);
        expect(result).toEqual({ organizationId: ORG_ID, fileId: FILE_ID });
    });

    it('parses URL with query params', () => {
        const result = parseFileUrl(`/api/files/${ORG_ID}/${FILE_ID}?v=2`);
        expect(result).toEqual({ organizationId: ORG_ID, fileId: FILE_ID });
    });

    it('parses URL with hash fragment', () => {
        const result = parseFileUrl(`/api/files/${ORG_ID}/${FILE_ID}#section`);
        expect(result).toEqual({ organizationId: ORG_ID, fileId: FILE_ID });
    });

    it('returns null for non-file URL', () => {
        expect(parseFileUrl('/media-stream/org/file')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(parseFileUrl('')).toBeNull();
    });

    it('returns null for unrelated URL', () => {
        expect(parseFileUrl('https://example.com/image.png')).toBeNull();
    });
});

describe('parseMediaStreamUrl', () => {
    it('parses relative media stream URL', () => {
        const result = parseMediaStreamUrl(`/media-stream/${ORG_ID}/${FILE_ID}`);
        expect(result).toEqual({ organizationId: ORG_ID, fileId: FILE_ID });
    });

    it('parses full media stream URL', () => {
        const result = parseMediaStreamUrl(`http://localhost:5173/media-stream/${ORG_ID}/${FILE_ID}`);
        expect(result).toEqual({ organizationId: ORG_ID, fileId: FILE_ID });
    });

    it('returns null for file URL', () => {
        expect(parseMediaStreamUrl(`/api/files/${ORG_ID}/${FILE_ID}`)).toBeNull();
    });
});

describe('extractFileId', () => {
    it('extracts from file URL', () => {
        expect(extractFileId(`/api/files/${ORG_ID}/${FILE_ID}`)).toBe(FILE_ID);
    });

    it('extracts from media stream URL', () => {
        expect(extractFileId(`/media-stream/${ORG_ID}/${FILE_ID}`)).toBe(FILE_ID);
    });

    it('extracts from full URL', () => {
        expect(extractFileId(`http://localhost:5173/api/files/${ORG_ID}/${FILE_ID}`)).toBe(FILE_ID);
    });

    it('returns null for unknown URL', () => {
        expect(extractFileId('https://example.com/image.png')).toBeNull();
    });
});
