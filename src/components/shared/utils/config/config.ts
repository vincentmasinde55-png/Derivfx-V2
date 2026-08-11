import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import brandConfig from '../../../../../brand.config.json';

// =============================================================================
// Constants - Domain & Server Configuration (from brand.config.json)
// =============================================================================

// Production app domains
export const PRODUCTION_DOMAINS = {
    COM: brandConfig.platform.hostname.production.com,
} as const;

// Staging app domains
export const STAGING_DOMAINS = {
    COM: brandConfig.platform.hostname.staging.com,
} as const;

// Deriv Options API REST base URLs.
// These are HTTPS because they are used by fetch() for accounts + OTP.
export const DERIV_API_BASE_URLS = {
    STAGING: brandConfig.platform.derivws.url.staging,
    PRODUCTION: brandConfig.platform.derivws.url.production,
} as const;

// Deriv Options API WebSocket endpoints.
// IMPORTANT: WebSocket() requires ws:// or wss://, not https://.
// Public is unauthenticated and is used before OAuth login so the app can
// load active symbols without getting stuck on the initialization screen.
export const WS_SERVERS = {
    STAGING: DERIV_API_BASE_URLS.STAGING.replace(/^https:/, 'wss:') + 'options/ws/public',
    PRODUCTION: DERIV_API_BASE_URLS.PRODUCTION.replace(/^https:/, 'wss:') + 'options/ws/public',
} as const;

// =============================================================================
// Helper Functions
// =============================================================================

export const isProduction = () => {
    const hostname = window.location.hostname;
    const productionDomains = Object.values(PRODUCTION_DOMAINS) as string[];
    return productionDomains.includes(hostname);
};

export const isLocal = () => /localhost(:\d+)?$/i.test(window.location.hostname);

const getDefaultServerURL = () => {
    const isProductionEnv = isProduction();

    try {
        return isProductionEnv ? WS_SERVERS.PRODUCTION : WS_SERVERS.STAGING;
    } catch (error) {
        console.error('Error in getDefaultServerURL:', error);
    }

    return isProductionEnv ? WS_SERVERS.PRODUCTION : WS_SERVERS.STAGING;
};

/**
 * Gets the WebSocket URL using the new Deriv Options API authenticated flow.
 *
 * Unauthenticated users use the public WebSocket for market metadata.
 * Authenticated users use:
 *   OAuth access token -> GET accounts -> POST account/{id}/otp -> returned wss URL
 */
export const getSocketURL = async (): Promise<string> => {
    try {
        const authInfo = OAuthTokenExchangeService.getAuthInfo();

        if (!authInfo || !authInfo.access_token) {
            return getDefaultServerURL();
        }

        const wsUrl = await DerivWSAccountsService.getAuthenticatedWebSocketURL(authInfo.access_token);
        return wsUrl;
    } catch (error) {
        console.error('[DerivWS] Error in getSocketURL:', error);
        // Keep the public market-data connection available if authenticated
        // setup fails. The UI can then still initialize instead of hanging.
        return getDefaultServerURL();
    }
};

export const getDebugServiceWorker = () => {
    const debug_service_worker_flag = window.localStorage.getItem('debug_service_worker');
    if (debug_service_worker_flag) return !!parseInt(debug_service_worker_flag);

    return false;
};

const generateCSRFToken = (): string => {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);

    const base64 = btoa(String.fromCharCode(...array));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};

const generateCodeVerifier = (): string => {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);

    const base64 = btoa(String.fromCharCode(...array));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};

const generateCodeChallenge = async (verifier: string): Promise<string> => {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);

    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const base64 = btoa(String.fromCharCode(...hashArray));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};

const storeCodeVerifier = (verifier: string): void => {
    sessionStorage.setItem('oauth_code_verifier', verifier);
    sessionStorage.setItem('oauth_code_verifier_timestamp', Date.now().toString());
};

export const getCodeVerifier = (): string | null => {
    const verifier = sessionStorage.getItem('oauth_code_verifier');
    const timestamp = sessionStorage.getItem('oauth_code_verifier_timestamp');

    if (!verifier || !timestamp) return null;

    const verifierAge = Date.now() - parseInt(timestamp, 10);
    if (verifierAge > 600000) {
        sessionStorage.removeItem('oauth_code_verifier');
        sessionStorage.removeItem('oauth_code_verifier_timestamp');
        return null;
    }

    return verifier;
};

export const clearCodeVerifier = (): void => {
    sessionStorage.removeItem('oauth_code_verifier');
    sessionStorage.removeItem('oauth_code_verifier_timestamp');
};

const storeCSRFToken = (token: string): void => {
    sessionStorage.setItem('oauth_csrf_token', token);
    sessionStorage.setItem('oauth_csrf_token_timestamp', Date.now().toString());
};

export const validateCSRFToken = (token: string): boolean => {
    const storedToken = sessionStorage.getItem('oauth_csrf_token');
    const timestamp = sessionStorage.getItem('oauth_csrf_token_timestamp');

    if (!storedToken || !timestamp || storedToken !== token) return false;

    const tokenAge = Date.now() - parseInt(timestamp, 10);
    if (tokenAge > 600000) {
        sessionStorage.removeItem('oauth_csrf_token');
        sessionStorage.removeItem('oauth_csrf_token_timestamp');
        return false;
    }

    return true;
};

export const clearCSRFToken = (): void => {
    sessionStorage.removeItem('oauth_csrf_token');
    sessionStorage.removeItem('oauth_csrf_token_timestamp');
};

export const generateOAuthURL = async (prompt?: string) => {
    try {
        const environment = isProduction() ? 'production' : 'staging';
        const hostname = brandConfig?.platform.auth2_url?.[environment];
        const clientId = process.env.CLIENT_ID;

        if (hostname && clientId) {
            const csrfToken = generateCSRFToken();
            storeCSRFToken(csrfToken);

            const codeVerifier = generateCodeVerifier();
            const codeChallenge = await generateCodeChallenge(codeVerifier);
            storeCodeVerifier(codeVerifier);

            const protocol = window.location.protocol;
            const host = window.location.host;
            const redirectUrl = `${protocol}//${host}`;
            const scopes = 'trade';

            let oauthUrl = `${hostname}auth?scope=${scopes}&response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUrl)}&state=${csrfToken}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

            if (prompt) {
                oauthUrl += `&prompt=${encodeURIComponent(prompt)}`;
            }

            return oauthUrl;
        }

        throw new Error('OAuth configuration missing: CLIENT_ID or authentication hostname.');
    } catch (error) {
        console.error('[OAuth] Error generating OAuth URL:', error);
        throw error;
    }
};
