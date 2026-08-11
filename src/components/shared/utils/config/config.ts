import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import brandConfig from '../../../../../brand.config.json';

// =============================================================================
// Constants - Domain & Server Configuration (from brand.config.json)
// =============================================================================

export const PRODUCTION_DOMAINS = {
    COM: brandConfig.platform.hostname.production.com,
} as const;

export const STAGING_DOMAINS = {
    COM: brandConfig.platform.hostname.staging.com,
} as const;

export const DERIV_API_BASE_URLS = {
    STAGING: brandConfig.platform.derivws.url.staging,
    PRODUCTION: brandConfig.platform.derivws.url.production,
} as const;

export const WS_SERVERS = {
    STAGING: DERIV_API_BASE_URLS.STAGING.replace(/^https:/, 'wss:') + 'options/ws/public',
    PRODUCTION: DERIV_API_BASE_URLS.PRODUCTION.replace(/^https:/, 'wss:') + 'options/ws/public',
} as const;

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

export const getSocketURL = async (): Promise<string> => {
    try {
        const authInfo = OAuthTokenExchangeService.getAuthInfo();
        if (!authInfo || !authInfo.access_token) return getDefaultServerURL();

        return await DerivWSAccountsService.getAuthenticatedWebSocketURL(authInfo.access_token);
    } catch (error) {
        console.error('[DerivWS] Error in getSocketURL:', error);
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
        clearCodeVerifier();
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
        clearCSRFToken();
        return false;
    }
    return true;
};

export const clearCSRFToken = (): void => {
    sessionStorage.removeItem('oauth_csrf_token');
    sessionStorage.removeItem('oauth_csrf_token_timestamp');
};

/**
 * Generate the single OAuth2 + PKCE authorization URL used by DerivFX.
 *
 * The public OAuth client ID is exposed to the browser at build time as APP_ID.
 * APP_ID is intentionally used here because Vercel currently provides APP_ID,
 * while CLIENT_ID is optional for backwards compatibility.
 */
export const generateOAuthURL = async (prompt?: string) => {
    try {
        const environment = isProduction() ? 'production' : 'staging';
        const hostname = brandConfig?.platform.auth2_url?.[environment];
        const clientId = process.env.APP_ID || process.env.CLIENT_ID || process.env.NEXT_PUBLIC_APP_ID;

        if (!hostname) throw new Error('OAuth authentication endpoint is missing.');
        if (!clientId) throw new Error('OAuth client ID is missing. Set APP_ID in Vercel.');

        const csrfToken = generateCSRFToken();
        const codeVerifier = generateCodeVerifier();
        const codeChallenge = await generateCodeChallenge(codeVerifier);

        // Store the exact values used by useOAuthCallback + OAuthTokenExchangeService.
        storeCSRFToken(csrfToken);
        storeCodeVerifier(codeVerifier);

        const redirectUrl = window.location.origin;
        const url = new URL(`${hostname}auth`);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', String(clientId));
        url.searchParams.set('redirect_uri', redirectUrl);
        url.searchParams.set('scope', 'trade');
        url.searchParams.set('state', csrfToken);
        url.searchParams.set('code_challenge', codeChallenge);
        url.searchParams.set('code_challenge_method', 'S256');
        if (prompt) url.searchParams.set('prompt', prompt);

        return url.toString();
    } catch (error) {
        console.error('[OAuth] Error generating OAuth URL:', error);
        throw error;
    }
};
