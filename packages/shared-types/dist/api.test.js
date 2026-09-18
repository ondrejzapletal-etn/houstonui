import { describe, it, expect } from 'vitest';
// Type guard helper – mirrors what consuming code would write
function isApiSuccess(r) {
    return r.success === true;
}
describe('ApiSuccess', () => {
    it('has success: true and carries typed data', () => {
        const result = { success: true, data: { id: 42 } };
        expect(result.success).toBe(true);
        expect(result.data.id).toBe(42);
    });
    it('accepts unknown data (default generic)', () => {
        const result = { success: true, data: 'anything' };
        expect(result.success).toBe(true);
        expect(result.data).toBe('anything');
    });
});
describe('ApiError', () => {
    it('has success: false and error object with code and message', () => {
        const result = {
            success: false,
            error: { code: 'NOT_FOUND', message: 'Resource not found' },
        };
        expect(result.success).toBe(false);
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toBe('Resource not found');
    });
});
describe('isApiSuccess type guard', () => {
    it('returns true for a success response', () => {
        const response = { success: true, data: 'hello' };
        expect(isApiSuccess(response)).toBe(true);
    });
    it('returns false for an error response', () => {
        const response = {
            success: false,
            error: { code: 'SERVER_ERROR', message: 'Something went wrong' },
        };
        expect(isApiSuccess(response)).toBe(false);
    });
    it('narrows type so data is accessible after guard', () => {
        const response = { success: true, data: 99 };
        if (isApiSuccess(response)) {
            // TypeScript would error here if narrowing didn't work
            expect(response.data).toBe(99);
        }
        else {
            throw new Error('Should have been success');
        }
    });
});
//# sourceMappingURL=api.test.js.map