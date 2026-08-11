import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import brandConfig from '../../../../../brand.config.json';

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
    return btoa(String.fromCharCode(...new Uint8Array(hashBuffer)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
};

const storeCodeVerifier = (verifier: string): void => {
    sessionStorage.setItem('oauth_code_verifier', verifier);
    sessionStorage.setItem('oauth_code_verifier_timestamp', Date.now().toString());
};

export const getCodeVerifier = (): string | null => {
    const verifier = sessionStorage.getItem('oauth_code_verifier');
    const timestamp = sessionStorage.getItem('oauth_code_verifier_timestamp');
    if (!verifier || !timestamp) return null;

    if (Date.now() - parseInt(timestamp, 10) > 600000) {
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
    const stored = sessionStorage.getItem('oauth_csrf_token');
    const timestamp = sessionStorage.getItem('oauth_csrf_token_timestamp');
    if (!stored || !timestamp || stored !== token) return false;

    if (Date.now() - parseInt(timestamp, 10) > 600000) {
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
 * Single production OAuth2 + PKCE URL generator.
 * Public domains always use production OAuth. Only localhost uses staging.
 */
export const generateOAuthURL = async (prompt?: string) => {
    const hostname = isLocal()
        ? brandConfig.platform.auth2_url.staging
        : brandConfig.platform.auth2_url.production;
    const clientId = process.env.APP_ID || process.env.CLIENT_ID || process.env.NEXT_PUBLIC_APP_ID;

    if (!clientId) throw new Error('OAuth client ID is missing. Set APP_ID in Vercel.');

    const state = generateCSRFToken();
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);

    storeCSRFToken(state);
    storeCodeVerifier(verifier);

    const redirectUri = window.location.origin;
    const url = new URL(`${hostname}auth`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', String(clientId));
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', 'trade');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    if (prompt) url.searchParams.set('prompt', prompt);

    return url.toString();
};
