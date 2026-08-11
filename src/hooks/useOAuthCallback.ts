import { useCallback, useEffect, useState } from 'react';
import { clearCSRFToken, validateCSRFToken } from '@/components/shared/utils/config/config';
import { clearAuthData } from '@/utils/auth-utils';

/**
 * OAuth callback parameters extracted from URL
 */
export interface OAuthCallbackParams {
    code: string | null;
    state: string | null;
    error: string | null;
    error_description: string | null;
}

/**
 * OAuth callback processing result
 */
export interface OAuthCallbackResult {
    isProcessing: boolean;
    isValid: boolean;
    params: OAuthCallbackParams;
    error: string | null;
    cleanupURL: () => void;
}

/**
 * Custom hook to handle OAuth callback flow.
 *
 * The cleanup URL deliberately uses a same-origin relative URL. Deriv may
 * return the OAuth callback on the www host while the original redirect was
 * configured for the apex host (or vice versa). Passing an absolute URL from
 * the other host to history.replaceState throws a SecurityError and makes a
 * successful login look like an account-connection failure.
 */
export const useOAuthCallback = (): OAuthCallbackResult => {
    const [result, setResult] = useState<Omit<OAuthCallbackResult, 'cleanupURL'>>({
        isProcessing: true,
        isValid: false,
        params: {
            code: null,
            state: null,
            error: null,
            error_description: null,
        },
        error: null,
    });

    const cleanupURL = useCallback(() => {
        const url = new URL(window.location.href);
        url.searchParams.delete('code');
        url.searchParams.delete('state');
        url.searchParams.delete('scope');
        url.searchParams.delete('error');
        url.searchParams.delete('error_description');

        // Keep replaceState strictly same-origin. Do not pass url.toString(),
        // because the OAuth provider can return us on www.derivfx.site while
        // the configured redirect is derivfx.site (or the reverse).
        const cleanPath = `${url.pathname}${url.search}${url.hash}`;
        window.history.replaceState({}, '', cleanPath || '/');
    }, []);

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);

        const code = urlParams.get('code');
        const state = urlParams.get('state');
        const error = urlParams.get('error');
        const error_description = urlParams.get('error_description');
        const isOAuthCallback = code !== null || error !== null || state !== null;

        if (!isOAuthCallback) {
            setResult({
                isProcessing: false,
                isValid: false,
                params: { code: null, state: null, error: null, error_description: null },
                error: null,
            });
            return;
        }

        if (error) {
            console.error('OAuth error:', error, error_description);
            setResult({
                isProcessing: false,
                isValid: false,
                params: { code, state, error, error_description },
                error: error_description || error,
            });
            cleanupURL();
            return;
        }

        if (!state) {
            console.error('[DEBUG] Missing state parameter in OAuth callback');
            clearAuthData();
            setResult({
                isProcessing: false,
                isValid: false,
                params: { code, state, error, error_description },
                error: 'Missing state parameter - potential security threat',
            });
            window.location.replace(window.location.origin);
            return;
        }

        if (!validateCSRFToken(state)) {
            console.error('[DEBUG] CSRF token validation failed - potential security threat');
            clearAuthData();
            setResult({
                isProcessing: false,
                isValid: false,
                params: { code, state, error, error_description },
                error: 'CSRF token validation failed',
            });
            return;
        }

        clearCSRFToken();

        if (!code) {
            console.error('Missing authorization code in OAuth callback');
            setResult({
                isProcessing: false,
                isValid: false,
                params: { code, state, error, error_description },
                error: 'Missing authorization code',
            });
            cleanupURL();
            return;
        }

        setResult({
            isProcessing: false,
            isValid: true,
            params: { code, state, error, error_description },
            error: null,
        });
    }, [cleanupURL]);

    return {
        ...result,
        cleanupURL,
    };
};
