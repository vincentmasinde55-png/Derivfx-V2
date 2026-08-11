import { ErrorLogger } from '@/utils/error-logger';

const REDIRECT_URI = 'https://derivfx.site';

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

export class OAuthTokenExchangeService {
    static getAuthInfo(): AuthInfo | null {
        try {
            const value = sessionStorage.getItem('auth_info');
            if (!value) return null;
            const authInfo: AuthInfo = JSON.parse(value);
            if (authInfo.expires_at && Date.now() >= authInfo.expires_at) {
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
        sessionStorage.removeItem('auth_info');
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
                return {
                    error: 'invalid_request',
                    error_description: 'PKCE verifier is missing. Please restart login.',
                };
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
                    error_description:
                        data.error_description || `OAuth token exchange failed (${response.status}).`,
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
            sessionStorage.setItem('auth_info', JSON.stringify(authInfo));
            return data;
        } catch (error) {
            ErrorLogger.error('OAuth', 'Token exchange network or parsing error', error);
            return {
                error: 'network_error',
                error_description: error instanceof Error ? error.message : 'OAuth token exchange failed.',
            };
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
            sessionStorage.setItem(
                'auth_info',
                JSON.stringify({
                    access_token: data.access_token,
                    token_type: data.token_type || 'bearer',
                    expires_in: data.expires_in || 3600,
                    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
                    scope: data.scope,
                    refresh_token: data.refresh_token || existing?.refresh_token,
                })
            );
            return data;
        } catch (error) {
            return {
                error: 'network_error',
                error_description: error instanceof Error ? error.message : 'Token refresh failed.',
            };
        }
    }
}
