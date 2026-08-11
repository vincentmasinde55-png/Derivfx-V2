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

// OAuth state and PKCE data use a host-shared cookie so a www <-> apex
// redirect cannot lose the verifier/state through origin-isolated storage.
const VERIFIER_KEY = 'derivfx_oauth_code_verifier';
const VERIFIER_TIMESTAMP_KEY = 'derivfx_oauth_code_verifier_timestamp';
const STATE_KEY = 'derivfx_oauth_csrf_token';
const STATE_TIMESTAMP_KEY = 'derivfx_oauth_csrf_token_timestamp';
const REDIRECT_URI = 'https://derivfx.site';
const COOKIE_DOMAIN = '.derivfx.site';

const setOAuthCookie = (key: string, value: string, maxAge = 600) => {
    document.cookie = `${key}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; Domain=${COOKIE_DOMAIN}; Secure; SameSite=Lax`;
};
const getOAuthCookie = (key: string): string | null => {
    const item = document.cookie.split('; ').find(cookie => cookie.startsWith(`${key}=`));
    return item ? decodeURIComponent(item.substring(key.length + 1)) : null;
};
const clearOAuthCookie = (key: string) => {
    document.cookie = `${key}=; Max-Age=0; Path=/; Domain=${COOKIE_DOMAIN}; Secure; SameSite=Lax`;
};

const storeCodeVerifier = (verifier: string) => {
    setOAuthCookie(VERIFIER_KEY, verifier);
    setOAuthCookie(VERIFIER_TIMESTAMP_KEY, Date.now().toString());
};
export const getCodeVerifier = (): string | null => {
    const verifier = getOAuthCookie(VERIFIER_KEY);
    const timestamp = getOAuthCookie(VERIFIER_TIMESTAMP_KEY);
    if (!verifier || !timestamp) return null;
    if (Date.now() - parseInt(timestamp, 10) > 600000) {
        clearCodeVerifier();
        return null;
    }
    return verifier;
};
export const clearCodeVerifier = () => {
    clearOAuthCookie(VERIFIER_KEY);
    clearOAuthCookie(VERIFIER_TIMESTAMP_KEY);
};

const storeCSRFToken = (token: string) => {
    setOAuthCookie(STATE_KEY, token);
    setOAuthCookie(STATE_TIMESTAMP_KEY, Date.now().toString());
};
export const validateCSRFToken = (token: string): boolean => {
    const stored = getOAuthCookie(STATE_KEY);
    const timestamp = getOAuthCookie(STATE_TIMESTAMP_KEY);
    if (!stored || !timestamp || stored !== token) return false;
    if (Date.now() - parseInt(timestamp, 10) > 600000) {
        clearCSRFToken();
        return false;
    }
    return true;
};
export const clearCSRFToken = () => {
    clearOAuthCookie(STATE_KEY);
    clearOAuthCookie(STATE_TIMESTAMP_KEY);
};

/** Single OAuth2 + PKCE URL generator. */
export const generateOAuthURL = async (prompt?: string) => {
    // Canonicalize www before generating state/PKCE so the configured redirect
    // URI and the browser origin always agree.
    if (!isLocal() && window.location.hostname.toLowerCase() === 'www.derivfx.site') {
        window.location.replace(`https://derivfx.site${window.location.pathname}${window.location.search}${window.location.hash}`);
        return '';
    }

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
