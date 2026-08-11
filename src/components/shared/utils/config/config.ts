import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import brandConfig from '../../../../../brand.config.json';

export const PRODUCTION_DOMAINS = { COM: brandConfig.platform.hostname.production.com } as const;
export const STAGING_DOMAINS = { COM: brandConfig.platform.hostname.staging.com } as const;
export const DERIV_API_BASE_URLS = {
    STAGING: brandConfig.platform.derivws.url.staging,
    PRODUCTION: brandConfig.platform.derivws.url.production,
} as const;
export const WS_SERVERS = {
    STAGING: DERIV_API_BASE_URLS.STAGING.replace(/^https:/, 'wss:') + 'options/ws/public',
    PRODUCTION: DERIV_API_BASE_URLS.PRODUCTION.replace(/^https:/, 'wss:') + 'options/ws/public',
} as const;

export const isProduction = () => {
    const hostname = window.location.hostname.toLowerCase();
    return hostname === 'derivfx.site' || hostname === 'www.derivfx.site';
};
export const isLocal = () => /localhost(:\d+)?$/i.test(window.location.hostname);
const getDefaultServerURL = () => (isProduction() ? WS_SERVERS.PRODUCTION : WS_SERVERS.STAGING);

export const getSocketURL = async (): Promise<string> => {
    try {
        const authInfo = OAuthTokenExchangeService.getAuthInfo();
        if (!authInfo?.access_token) return getDefaultServerURL();
        return await DerivWSAccountsService.getAuthenticatedWebSocketURL(authInfo.access_token);
    } catch (error) {
        console.error('[DerivWS] Error in getSocketURL:', error);
        return getDefaultServerURL();
    }
};

export const getDebugServiceWorker = () => {
    const value = window.localStorage.getItem('debug_service_worker');
    return value ? !!parseInt(value, 10) : false;
};

const generateCSRFToken = (): string => {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode(...array)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};
const generateCodeVerifier = (): string => {
    const array = new Uint8Array(64);
    crypto.getRandomValues(array);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    return Array.from(array, value => alphabet[value % alphabet.length]).join('');
};
const generateCodeChallenge = async (verifier: string): Promise<string> => {
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return btoa(String.fromCharCode(...new Uint8Array(hashBuffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

// IMPORTANT: these keys are shared by the login generator, callback validator,
// and token exchange. A previous version used different PKCE key names.
const VERIFIER_KEY = 'oauth_code_verifier';
const VERIFIER_TIMESTAMP_KEY = 'oauth_code_verifier_timestamp';
const STATE_KEY = 'oauth_csrf_token';
const STATE_TIMESTAMP_KEY = 'oauth_csrf_token_timestamp';
const REDIRECT_URI = 'https://derivfx.site';

const storeCodeVerifier = (verifier: string) => {
    sessionStorage.setItem(VERIFIER_KEY, verifier);
    sessionStorage.setItem(VERIFIER_TIMESTAMP_KEY, Date.now().toString());
};
export const getCodeVerifier = (): string | null => {
    const verifier = sessionStorage.getItem(VERIFIER_KEY);
    const timestamp = sessionStorage.getItem(VERIFIER_TIMESTAMP_KEY);
    if (!verifier || !timestamp) return null;
    if (Date.now() - parseInt(timestamp, 10) > 600000) {
        clearCodeVerifier();
        return null;
    }
    return verifier;
};
export const clearCodeVerifier = () => {
    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem(VERIFIER_TIMESTAMP_KEY);
};

const storeCSRFToken = (token: string) => {
    sessionStorage.setItem(STATE_KEY, token);
    sessionStorage.setItem(STATE_TIMESTAMP_KEY, Date.now().toString());
};
export const validateCSRFToken = (token: string): boolean => {
    const stored = sessionStorage.getItem(STATE_KEY);
    const timestamp = sessionStorage.getItem(STATE_TIMESTAMP_KEY);
    if (!stored || !timestamp || stored !== token) return false;
    if (Date.now() - parseInt(timestamp, 10) > 600000) {
        clearCSRFToken();
        return false;
    }
    return true;
};
export const clearCSRFToken = () => {
    sessionStorage.removeItem(STATE_KEY);
    sessionStorage.removeItem(STATE_TIMESTAMP_KEY);
};

/** Single OAuth2 + PKCE URL generator. */
export const generateOAuthURL = async (prompt?: string) => {
    const hostname = isLocal() ? brandConfig.platform.auth2_url.staging : brandConfig.platform.auth2_url.production;
    const clientId = process.env.APP_ID || process.env.CLIENT_ID || process.env.NEXT_PUBLIC_APP_ID;
    if (!clientId) throw new Error('OAuth client ID is missing. Set APP_ID in Vercel.');

    const state = generateCSRFToken();
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    storeCSRFToken(state);
    storeCodeVerifier(verifier);

    const url = new URL(`${hostname}auth`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', String(clientId));
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('scope', 'trade');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    if (prompt) url.searchParams.set('prompt', prompt);
    return url.toString();
};
