import { isProduction } from '@/components/shared';
import brandConfig from '../../brand.config.json';

export interface DerivAccount {
    account_id: string;
    balance: string;
    currency: string;
    group: string;
    status: string;
    account_type: 'demo' | 'real';
}

interface AccountsResponse {
    data: DerivAccount[];
}

interface OTPResponseData {
    url: string;
}

interface OTPResponse {
    data: OTPResponseData;
}

/**
 * Deriv Options API account service.
 *
 * Uses the new REST flow for authenticated connections:
 * access token -> accounts -> account OTP -> authenticated wss URL.
 *
 * Deriv-App-ID is sent on every REST request as required by the new API.
 */
export class DerivWSAccountsService {
    private static accountsFetchPromise: Promise<DerivAccount[]> | null = null;
    private static otpFetchPromises: Map<string, Promise<string>> = new Map();

    private static getDerivWSBaseURL(): string {
        const environment = isProduction() ? 'production' : 'staging';
        return brandConfig.platform.derivws.url[environment];
    }

    private static getAppId(): string {
        const appId = process.env.APP_ID;
        if (!appId) {
            throw new Error('APP_ID is not configured. Add APP_ID to the deployment environment variables.');
        }
        return String(appId);
    }

    private static getHeaders(accessToken: string): Record<string, string> {
        return {
            Authorization: `Bearer ${accessToken}`,
            'Deriv-App-ID': this.getAppId(),
            Accept: 'application/json',
            'Content-Type': 'application/json',
        };
    }

    static clearCache(): void {
        this.accountsFetchPromise = null;
        this.otpFetchPromises.clear();
    }

    static storeAccounts(accounts: DerivAccount[]): void {
        sessionStorage.setItem('deriv_accounts', JSON.stringify(accounts));
    }

    static getStoredAccounts(): DerivAccount[] | null {
        try {
            const accountsStr = sessionStorage.getItem('deriv_accounts');
            if (!accountsStr) return null;
            return JSON.parse(accountsStr) as DerivAccount[];
        } catch (error) {
            console.error('[DerivWS] Error parsing stored accounts:', error);
            return null;
        }
    }

    static getDefaultAccount(): DerivAccount | null {
        const accounts = this.getStoredAccounts();
        return accounts?.length ? accounts[0] : null;
    }

    static clearStoredAccounts(): void {
        sessionStorage.removeItem('deriv_accounts');
    }

    static async fetchAccountsList(accessToken: string): Promise<DerivAccount[]> {
        if (this.accountsFetchPromise) return this.accountsFetchPromise;

        this.accountsFetchPromise = (async () => {
            try {
                const endpoint = `${this.getDerivWSBaseURL()}options/accounts`;
                const response = await fetch(endpoint, {
                    method: 'GET',
                    headers: this.getHeaders(accessToken),
                });

                if (!response.ok) {
                    const body = await response.text().catch(() => '');
                    throw new Error(`Failed to fetch accounts: ${response.status} ${response.statusText}${body ? ` - ${body}` : ''}`);
                }

                const data: AccountsResponse = await response.json();
                const accounts = data?.data || [];
                this.storeAccounts(accounts);
                return accounts;
            } catch (error) {
                console.error('[DerivWS] Error fetching accounts:', error);
                this.accountsFetchPromise = null;
                throw error;
            } finally {
                setTimeout(() => {
                    this.accountsFetchPromise = null;
                }, 100);
            }
        })();

        return this.accountsFetchPromise;
    }

    static async fetchOTPWebSocketURL(accessToken: string, accountId: string): Promise<string> {
        const cacheKey = accountId;
        const existing = this.otpFetchPromises.get(cacheKey);
        if (existing) return existing;

        const otpPromise = (async () => {
            try {
                const endpoint = `${this.getDerivWSBaseURL()}options/accounts/${encodeURIComponent(accountId)}/otp`;
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: this.getHeaders(accessToken),
                    body: JSON.stringify({}),
                });

                if (!response.ok) {
                    const body = await response.text().catch(() => '');
                    throw new Error(`Failed to fetch account OTP: ${response.status} ${response.statusText}${body ? ` - ${body}` : ''}`);
                }

                const otpResponse: OTPResponse = await response.json();
                const websocketURL = otpResponse?.data?.url;

                if (!websocketURL) {
                    throw new Error('Authenticated WebSocket URL not found in OTP response');
                }

                // Defensive normalization: WebSocket() must receive wss:// or ws://.
                return websocketURL.replace(/^https:/, 'wss:');
            } catch (error) {
                console.error('[DerivWS] Error fetching account OTP:', error);
                this.otpFetchPromises.delete(cacheKey);
                throw error;
            } finally {
                setTimeout(() => this.otpFetchPromises.delete(cacheKey), 100);
            }
        })();

        this.otpFetchPromises.set(cacheKey, otpPromise);
        return otpPromise;
    }

    static async getAuthenticatedWebSocketURL(accessToken: string): Promise<string> {
        try {
            let accounts = this.getStoredAccounts();

            if (!accounts?.length) {
                accounts = await this.fetchAccountsList(accessToken);
            }

            if (!accounts?.length) {
                throw new Error('No Deriv trading accounts were returned for this OAuth session.');
            }

            const activeLoginId = localStorage.getItem('active_loginid');
            const targetAccount =
                (activeLoginId && accounts.find(account => account.account_id === activeLoginId)) || accounts[0];

            return await this.fetchOTPWebSocketURL(accessToken, targetAccount.account_id);
        } catch (error) {
            console.error('[DerivWS] Error in authenticated WebSocket URL flow:', error);
            throw error;
        }
    }
}
