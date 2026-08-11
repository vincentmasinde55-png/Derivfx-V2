import { OAuthTokenExchangeService } from './oauth-token-exchange.service';
import { DerivWSAccountsService, DerivAccount } from './derivws-accounts.service';

// Keep the PKCE/state keys identical to the callback/token-exchange flow.
const VERIFIER_KEY = 'oauth_code_verifier';
const VERIFIER_TIMESTAMP_KEY = 'oauth_code_verifier_timestamp';
const STATE_KEY = 'oauth_csrf_token';
const STATE_TIMESTAMP_KEY = 'oauth_csrf_token_timestamp';
const REDIRECT_URI = 'https://derivfx.site';

const toBase64Url = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const randomString = (length: number) => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const values = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(values, value => alphabet[value % alphabet.length]).join('');
};

const challengeFor = async (verifier: string) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return toBase64Url(new Uint8Array(digest));
};

export type OAuthMode = 'login' | 'signup';

export class OAuthLoginService {
    private static clientId() {
        const id = process.env.APP_ID || process.env.CLIENT_ID || process.env.NEXT_PUBLIC_APP_ID;
        if (!id) throw new Error('Deriv OAuth client ID is missing from the Vercel environment.');
        return String(id);
    }

    static async start(mode: OAuthMode) {
        const verifier = randomString(64);
        const state = randomString(32);
        const challenge = await challengeFor(verifier);

        // Store the exact verifier that generated the challenge. This same value
        // must still exist when Deriv redirects back with the authorization code.
        sessionStorage.setItem(VERIFIER_KEY, verifier);
        sessionStorage.setItem(VERIFIER_TIMESTAMP_KEY, Date.now().toString());
        sessionStorage.setItem(STATE_KEY, state);
        sessionStorage.setItem(STATE_TIMESTAMP_KEY, Date.now().toString());
        sessionStorage.setItem('derivfx_oauth_mode', mode);

        const url = new URL('https://auth.deriv.com/oauth2/auth');
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', this.clientId());
        url.searchParams.set('redirect_uri', REDIRECT_URI);
        url.searchParams.set('scope', 'trade');
        url.searchParams.set('state', state);
        url.searchParams.set('code_challenge', challenge);
        url.searchParams.set('code_challenge_method', 'S256');
        if (mode === 'signup') url.searchParams.set('prompt', 'registration');

        window.location.assign(url.toString());
    }

    static async handleCallback(): Promise<{ accounts?: DerivAccount[]; error?: string }> {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const returnedState = params.get('state');
        const oauthError = params.get('error');

        if (oauthError) return { error: params.get('error_description') || oauthError };
        if (!code) return {};

        const savedState = sessionStorage.getItem(STATE_KEY);
        const verifier = sessionStorage.getItem(VERIFIER_KEY);
        if (!savedState || !verifier || savedState !== returnedState) {
            return { error: 'OAuth state or PKCE verification data is missing. Please restart login.' };
        }

        try {
            const result = await OAuthTokenExchangeService.exchangeCodeForToken(code);
            if (result.error || !result.access_token) {
                return { error: result.error_description || result.error || 'Deriv authentication failed.' };
            }

            const accounts = await DerivWSAccountsService.fetchAccountsList(result.access_token);
            if (!accounts.length) return { error: 'No Deriv trading accounts were returned for this OAuth session.' };

            const preferred = accounts.find(account => account.account_type === 'demo') || accounts[0];
            localStorage.setItem('active_loginid', preferred.account_id);
            localStorage.setItem('account_type', preferred.account_type);
            localStorage.setItem('derivfx_authenticated', '1');
            window.history.replaceState({}, document.title, REDIRECT_URI);
            return { accounts };
        } catch (error) {
            return { error: error instanceof Error ? error.message : 'Deriv authentication failed.' };
        }
    }
}
