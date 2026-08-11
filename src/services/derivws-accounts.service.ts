export interface DerivAccount {
    account_id: string;
    balance: string;
    currency: string;
    group: string;
    status: string;
    account_type: 'demo' | 'real';
}

interface AccountsResponse { data: DerivAccount[]; }
interface OTPResponse { data: { url: string }; }

export class DerivWSAccountsService {
    private static accountsFetchPromise: Promise<DerivAccount[]> | null = null;
    private static otpFetchPromises: Map<string, Promise<string>> = new Map();
    private static readonly REQUEST_TIMEOUT_MS = 10000;

    private static async fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT_MS);
        try { return await fetch(url, { ...options, signal: controller.signal }); }
        catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') throw new Error('Deriv account request timed out.');
            throw error;
        } finally { window.clearTimeout(timeoutId); }
    }

    static clearCache(): void { this.accountsFetchPromise = null; this.otpFetchPromises.clear(); }
    static storeAccounts(accounts: DerivAccount[]): void { sessionStorage.setItem('deriv_accounts', JSON.stringify(accounts)); }
    static getStoredAccounts(): DerivAccount[] | null {
        try { const value = sessionStorage.getItem('deriv_accounts'); return value ? JSON.parse(value) as DerivAccount[] : null; }
        catch { return null; }
    }
    static getDefaultAccount(): DerivAccount | null { const accounts = this.getStoredAccounts(); return accounts?.length ? accounts[0] : null; }
    static clearStoredAccounts(): void { sessionStorage.removeItem('deriv_accounts'); }

    static async fetchAccountsList(accessToken: string): Promise<DerivAccount[]> {
        if (this.accountsFetchPromise) return this.accountsFetchPromise;
        this.accountsFetchPromise = (async () => {
            try {
                const response = await this.fetchWithTimeout('/api/deriv/accounts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({ access_token: accessToken }),
                });
                const body = await response.text();
                let data: AccountsResponse & { error?: string; error_description?: string };
                try { data = JSON.parse(body); } catch { throw new Error(body || `Accounts request failed (${response.status}).`); }
                if (!response.ok) throw new Error(data.error_description || data.error || `Accounts request failed (${response.status}).`);
                const accounts = Array.isArray(data.data) ? data.data : [];
                this.storeAccounts(accounts);
                return accounts;
            } catch (error) { this.accountsFetchPromise = null; throw error; }
            finally { setTimeout(() => { this.accountsFetchPromise = null; }, 100); }
        })();
        return this.accountsFetchPromise;
    }

    static async fetchOTPWebSocketURL(accessToken: string, accountId: string): Promise<string> {
        const existing = this.otpFetchPromises.get(accountId);
        if (existing) return existing;
        const promise = (async () => {
            try {
                const response = await this.fetchWithTimeout('/api/deriv/account-otp', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({ access_token: accessToken, account_id: accountId }),
                });
                const body = await response.text();
                let data: OTPResponse & { error?: string; error_description?: string };
                try { data = JSON.parse(body); } catch { throw new Error(body || `OTP request failed (${response.status}).`); }
                if (!response.ok) throw new Error(data.error_description || data.error || `OTP request failed (${response.status}).`);
                const url = data?.data?.url;
                if (!url) throw new Error('Authenticated WebSocket URL not found.');
                return url.replace(/^https:/, 'wss:');
            } finally { setTimeout(() => this.otpFetchPromises.delete(accountId), 100); }
        })();
        this.otpFetchPromises.set(accountId, promise);
        return promise;
    }

    static async getAuthenticatedWebSocketURL(accessToken: string): Promise<string> {
        let accounts = this.getStoredAccounts();
        if (!accounts?.length) accounts = await this.fetchAccountsList(accessToken);
        if (!accounts?.length) throw new Error('No Deriv trading accounts were returned.');
        const activeLoginId = localStorage.getItem('active_loginid');
        const target = (activeLoginId && accounts.find(a => a.account_id === activeLoginId)) || accounts[0];
        return this.fetchOTPWebSocketURL(accessToken, target.account_id);
    }
}
