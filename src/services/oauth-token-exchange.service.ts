import { ErrorLogger } from '@/utils/error-logger';

const REDIRECT_URI = 'https://derivfx.site';
const AUTH_STORAGE_KEY = 'auth_info';

interface TokenExchangeResponse {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
}

interface AuthInfo {
    access_token: string;
    token_type: string;
    expires_in: number;
    expires_at: number;
    scope?: string;
    refresh_token?: string;
}

const writeAuthInfo = (authInfo: AuthInfo) => {
    // Persist the OAuth session across page reloads. sessionStorage alone was
    // causing the user to appear logged out after refreshing the site.
    try { localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authInfo)); } catch { /* ignore */ }
    try { sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authInfo)); } catch { /* ignore */ }
};

const readStoredAuthInfo = () => {
    try {
        const value = localStorage.getItem(AUTH_STORAGE_KEY) || sessionStorage.getItem(AUTH_STORAGE_KEY);
        return value ? JSON.parse(value) as AuthInfo : null;
    } catch (error) {
        ErrorLogger.error('OAuth', 'Error parsing persisted auth_info', error);
        return null;
    }
};

export class OAuthTokenExchangeService {
    static getAuthInfo(): AuthInfo | null {
        try {
            const authInfo = readStoredAuthInfo();
            if (!authInfo?.access_token) return null;
            if (authInfo.expires_at && Date.now() >= authInfo.expires_at) {
                // A refresh token can still be used by the caller before the
                // session is discarded, so keep the record when possible.
                if (authInfo.refresh_token) return authInfo;
                this.clearAuthInfo();
                return null;
            }
            return authInfo;
        } catch (error) {
            ErrorLogger.error('OAuth', 'Error parsing auth_info', error);
            return null;
        }
    }

    static clearAuthInfo(): void {
        try { sessionStorage.removeItem(AUTH_STORAGE_KEY); } catch { /* ignore */ }
        try { localStorage.removeItem(AUTH_STORAGE_KEY); } catch { /* ignore */ }
        try { localStorage.removeItem('active_loginid'); } catch { /* ignore */ }
        try { localStorage.removeItem('account_type'); } catch { /* ignore */ }
        try { localStorage.removeItem('derivfx_authenticated'); } catch { /* ignore */ }
    }

    static isAuthenticated(): boolean {
        return !!this.getAuthInfo()?.access_token;
    }

    static getAccessToken(): string | null {
        return this.getAuthInfo()?.access_token || null;
    }

    static async exchangeCodeForToken(code: string, codeVerifier: string): Promise<TokenExchangeResponse> {
        try {
            if (!codeVerifier) {
                return { error: 'invalid_request', error_description: 'PKCE verifier is missing. Please restart login.' };
            }

            const response = await fetch('/api/oauth/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    grant_type: 'authorization_code',
                    code,
                    code_verifier: codeVerifier,
                    redirect_uri: REDIRECT_URI,
                }),
            });

            const data: TokenExchangeResponse = await response.json();
            if (!response.ok || data.error || !data.access_token) {
                return {
                    error: data.error || 'token_exchange_failed',
                    error_description: data.error_description || `OAuth token exchange failed (${response.status}).`,
                };
            }

            const authInfo: AuthInfo = {
                access_token: data.access_token,
                token_type: data.token_type || 'bearer',
                expires_in: data.expires_in || 3600,
                expires_at: Date.now() + (data.expires_in || 3600) * 1000,
                scope: data.scope,
                ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
            };
            writeAuthInfo(authInfo);
            return data;
        } catch (error) {
            ErrorLogger.error('OAuth', 'Token exchange network or parsing error', error);
            return { error: 'network_error', error_description: error instanceof Error ? error.message : 'OAuth token exchange failed.' };
        }
    }

    static async refreshAccessToken(refreshToken: string): Promise<TokenExchangeResponse> {
        try {
            const response = await fetch('/api/oauth/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken }),
            });
            const data: TokenExchangeResponse = await response.json();
            if (data.error || !data.access_token) return data;

            const existing = this.getAuthInfo();
            const authInfo: AuthInfo = {
                access_token: data.access_token,
                token_type: data.token_type || 'bearer',
                expires_in: data.expires_in || 3600,
                expires_at: Date.now() + (data.expires_in || 3600) * 1000,
                scope: data.scope,
                refresh_token: data.refresh_token || existing?.refresh_token,
            };
            writeAuthInfo(authInfo);
            return data;
        } catch (error) {
            return { error: 'network_error', error_description: error instanceof Error ? error.message : 'Token refresh failed.' };
        }
    }
}
