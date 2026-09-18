export interface UserProfile {
    id: string;
    entraId?: string;
    googleId?: string;
    email: string;
    displayName: string;
}
export interface LoginResponse {
    accessToken: string;
    expiresIn: number;
    user: UserProfile;
}
export interface SessionInfo {
    user: UserProfile;
    expiresAt: string;
}
export type AuthErrorCode = 'AUTH_INVALID_TOKEN' | 'AUTH_TOKEN_EXPIRED' | 'AUTH_UNAUTHORIZED' | 'AUTH_CALLBACK_FAILED' | 'AUTH_SESSION_NOT_FOUND';
//# sourceMappingURL=auth.d.ts.map