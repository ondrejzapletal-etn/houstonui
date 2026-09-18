import { describe, it, expect, expectTypeOf } from 'vitest';
describe('UserProfile', () => {
    it('should have required fields', () => {
        const profile = {
            id: 'user-1',
            entraId: 'entra-abc',
            email: 'test@example.com',
            displayName: 'Test User',
        };
        expectTypeOf(profile).toMatchTypeOf();
    });
});
describe('LoginResponse', () => {
    it('should have accessToken, expiresIn and user', () => {
        const response = {
            accessToken: 'jwt.token.here',
            expiresIn: 900,
            user: {
                id: 'user-1',
                entraId: 'entra-abc',
                email: 'test@example.com',
                displayName: 'Test User',
            },
        };
        expectTypeOf(response).toMatchTypeOf();
    });
});
describe('SessionInfo', () => {
    it('should have user and expiresAt', () => {
        const session = {
            user: {
                id: 'user-1',
                entraId: 'entra-abc',
                email: 'test@example.com',
                displayName: 'Test User',
            },
            expiresAt: new Date().toISOString(),
        };
        expectTypeOf(session).toMatchTypeOf();
    });
});
describe('AuthErrorCode', () => {
    it('should only allow valid error codes', () => {
        const valid = [
            'AUTH_INVALID_TOKEN',
            'AUTH_TOKEN_EXPIRED',
            'AUTH_UNAUTHORIZED',
            'AUTH_CALLBACK_FAILED',
            'AUTH_SESSION_NOT_FOUND',
        ];
        expectTypeOf(valid).toMatchTypeOf();
    });
});
describe('re-export from index', () => {
    it('should be importable from package root', async () => {
        const mod = await import('./index');
        // Typy jsou erasable at runtime – ověřujeme pouze přítomnost modulu
        expect(mod).toBeDefined();
    });
});
//# sourceMappingURL=auth.test.js.map