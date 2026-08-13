import { describe, it, expect } from 'vitest';
import { ConnectError, Code } from '@connectrpc/connect';
import { isCanceledError } from '@/shared/utils/rpcErrors';

describe('isCanceledError', () => {
    it('detects a canceled ConnectRPC call', () => {
        expect(isCanceledError(new ConnectError('aborted', Code.Canceled))).toBe(true);
    });

    it('leaves real failures alone', () => {
        expect(isCanceledError(new ConnectError('boom', Code.Internal))).toBe(false);
        expect(isCanceledError(new Error('network down'))).toBe(false);
        expect(isCanceledError(undefined)).toBe(false);
    });

    it('still detects a raw AbortError', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        expect(isCanceledError(err)).toBe(true);
    });
});
