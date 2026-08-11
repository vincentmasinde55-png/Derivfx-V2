/* [AI] - Analytics removed - utility functions moved to @/utils/account-helpers */
import { getAccountId, getAccountType, isDemoAccount, removeUrlParameter } from '@/utils/account-helpers';
/* [/AI] */
import CommonStore from '@/stores/common-store';
import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import { TAuthData } from '@/types/api-types';
import { clearAuthData } from '@/utils/auth-utils';
import { handleBackendError, isBackendError } from '@/utils/error-handler';
import { activeSymbolsProcessorService } from '../../../../services/active-symbols-processor.service';
import { observer as globalObserver } from '../../utils/observer';
import { doUntilDone, socket_state } from '../tradeEngine/utils/helpers';
import { CONNECTION_STATUS, setAccountList, setAuthData, setConnectionStatus, setIsAuthorized, setIsAuthorizing } from './observables/connection-status-stream';
import ApiHelpers from './api-helpers';
import { generateDerivApiInstance, V2GetActiveAccountId } from './appId';
import chart_api from './chart-api';

type CurrentSubscription = { id: string; unsubscribe: () => void };
type SubscriptionPromise = Promise<{ subscription: CurrentSubscription }>;
type TApiBaseApi = { connection: { readyState: keyof typeof socket_state; addEventListener: (event: string, callback: () => void) => void; removeEventListener: (event: string, callback: () => void) => void }; send: (data: unknown) => void; disconnect: () => void; authorize: (token: string) => Promise<{ authorize: TAuthData; error: unknown }>; onMessage: () => { subscribe: (callback: (message: unknown) => void) => { unsubscribe: () => void } } } & ReturnType<typeof generateDerivApiInstance>;

class APIBase {
    api: TApiBaseApi | null = null;
    token = '';
    account_id = '';
    pip_sizes = {};
    account_info = {};
    is_running = false;
    subscriptions: CurrentSubscription[] = [];
    time_interval: ReturnType<typeof setInterval> | null = null;
    has_active_symbols = false;
    is_stopping = false;
    active_symbols: any[] = [];
    current_auth_subscriptions: SubscriptionPromise[] = [];
    is_authorized = false;
    active_symbols_promise: Promise<any[] | undefined> | null = null;
    common_store: CommonStore | undefined;
    reconnection_attempts = 0;

    private readonly ACTIVE_SYMBOLS_TIMEOUT_MS = 10000;
    private readonly ENRICHMENT_TIMEOUT_MS = 10000;
    private readonly PUBLIC_WS_TIMEOUT_MS = 10000;
    private readonly MAX_RECONNECTION_ATTEMPTS = 5;

    unsubscribeAllSubscriptions = () => {
        this.current_auth_subscriptions?.forEach(subscription_promise => {
            subscription_promise.then(({ subscription }) => {
                if (subscription?.id) this.api?.send({ forget: subscription.id });
            });
        });
        this.current_auth_subscriptions = [];
    };

    onsocketopen() {
        setConnectionStatus(CONNECTION_STATUS.OPENED);
        this.reconnection_attempts = 0;
        const currentClientStore = globalObserver.getState('client.store');
        if (currentClientStore) currentClientStore.setIsAccountRegenerating(false);
        this.handleTokenExchangeIfNeeded();
    }

    private async handleTokenExchangeIfNeeded() {
        const urlParams = new URLSearchParams(window.location.search);
        const account_id = urlParams.get('account_id');
        const accountType = urlParams.get('account_type');
        if (account_id) { localStorage.setItem('active_loginid', account_id); removeUrlParameter('account_id'); }
        if (accountType) { localStorage.setItem('account_type', accountType); removeUrlParameter('account_type'); }
        let activeAccountId: string | null = getAccountId();
        if (!activeAccountId) {
            try {
                const storedAccounts = sessionStorage.getItem('deriv_accounts');
                if (storedAccounts) {
                    const accounts = JSON.parse(storedAccounts);
                    if (accounts?.length && accounts[0]?.account_id) {
                        activeAccountId = accounts[0].account_id;
                        localStorage.setItem('active_loginid', activeAccountId);
                        localStorage.setItem('account_type', accounts[0].account_type === 'demo' ? 'demo' : 'real');
                    }
                }
            } catch (error) { console.error('[APIBase] Error reading accounts:', error); }
        }
        if (activeAccountId) { setIsAuthorizing(true); await this.authorizeAndSubscribe(); }
    }

    onsocketclose() { setConnectionStatus(CONNECTION_STATUS.CLOSED); this.reconnectIfNotConnected(); }

    async init(force_create_connection = false) {
        this.toggleRunButton(true);
        if (this.api) this.unsubscribeAllSubscriptions();
        if (!force_create_connection) this.reconnection_attempts = 0;
        if (!this.api || this.api.connection.readyState !== 1 || force_create_connection) {
            if (this.api?.connection) {
                ApiHelpers.disposeInstance();
                setConnectionStatus(CONNECTION_STATUS.CLOSED);
                this.api.disconnect();
            }
            this.api = await generateDerivApiInstance(force_create_connection);
            this.api?.connection.addEventListener('open', this.onsocketopen.bind(this));
            this.api?.connection.addEventListener('close', this.onsocketclose.bind(this));
            const currentClientStore = globalObserver.getState('client.store');
            if (currentClientStore) {
                const active_login_id = getAccountId();
                if (active_login_id) currentClientStore.setWebSocketLoginId(active_login_id);
            }
        }
        const hasAccountID = V2GetActiveAccountId();
        if (!this.has_active_symbols && !hasAccountID) this.active_symbols_promise = this.getActiveSymbols().then(() => undefined);
        this.initEventListeners();
        if (this.time_interval) clearInterval(this.time_interval);
        this.time_interval = null;
        chart_api.init(force_create_connection);
    }

    getConnectionStatus() {
        if (this.api?.connection) return socket_state[this.api.connection.readyState as keyof typeof socket_state] || 'Unknown';
        return 'Socket not initialized';
    }
    terminate() { if (this.api) this.api.disconnect(); }
    initEventListeners() { if (window) { window.addEventListener('online', this.reconnectIfNotConnected); window.addEventListener('focus', this.reconnectIfNotConnected); } }
    async createNewInstance(account_id: string) { if (this.account_id !== account_id) await this.init(); }

    reconnectIfNotConnected = () => {
        if (this.api?.connection?.readyState && this.api.connection.readyState > 1) {
            this.reconnection_attempts += 1;
            if (this.reconnection_attempts >= this.MAX_RECONNECTION_ATTEMPTS) {
                this.reconnection_attempts = 0; setIsAuthorized(false); setAccountList([]); setAuthData(null);
                localStorage.removeItem('active_loginid'); localStorage.removeItem('account_type'); localStorage.removeItem('accountsList'); localStorage.removeItem('clientAccounts');
            }
            this.init(true);
        }
    };

    async authorizeAndSubscribe() {
        if (!this.api) return;
        this.account_id = getAccountId() || '';
        setIsAuthorizing(true);
        try {
            const { balance, error } = await this.api.balance();
            if (error) {
                const errorMessage = isBackendError(error) ? handleBackendError(error) : error.message || 'Authorization failed';
                console.error('Authorization error:', errorMessage); setIsAuthorizing(false); return { ...error, localizedMessage: errorMessage };
            }
            this.account_info = { balance: balance?.balance, currency: balance?.currency, loginid: balance?.loginid };
            this.token = balance?.loginid;
            const account_type = getAccountType(balance?.loginid);
            const currentAccount = balance?.loginid ? { balance: balance.balance, currency: balance.currency || 'USD', is_virtual: account_type === 'real' ? 0 : 1, loginid: balance.loginid } : null;
            const storedAccounts = DerivWSAccountsService.getStoredAccounts();
            const accountList = storedAccounts?.length ? storedAccounts.filter(a => !a.status || a.status === 'active').map(a => ({ balance: parseFloat(String(a.balance)) || 0, currency: a.currency || 'USD', is_virtual: a.account_type === 'demo' ? 1 : 0, loginid: a.account_id })) : currentAccount ? [currentAccount] : [];
            setAccountList(accountList);
            setAuthData({ balance: balance?.balance, currency: balance?.currency, loginid: balance?.loginid, is_virtual: account_type === 'real' ? 0 : 1, account_list: accountList });
            const loginid = balance?.loginid || '';
            localStorage.setItem('account_type', isDemoAccount(loginid) ? 'demo' : 'real');
            globalObserver.emit('api.authorize', { account_list: accountList, current_account: { loginid: balance?.loginid, currency: balance?.currency || 'USD', is_virtual: account_type === 'real' ? 0 : 1, balance: typeof balance?.balance === 'number' ? balance.balance : undefined } });
            const currentClientStore = globalObserver.getState('client.store');
            if (currentClientStore && balance?.loginid) currentClientStore.setWebSocketLoginId(balance.loginid);
            setIsAuthorized(true); this.is_authorized = true;
            localStorage.setItem('client_account_details', JSON.stringify(accountList));
            localStorage.setItem('client.country', balance?.country);
            if (balance?.loginid) localStorage.setItem('active_loginid', balance.loginid);
            if (this.has_active_symbols) this.toggleRunButton(false); else this.active_symbols_promise = this.getActiveSymbols();
            this.subscribe();
        } catch (e) { this.is_authorized = false; clearAuthData(); setIsAuthorized(false); globalObserver.emit('Error', e); }
        finally { setIsAuthorizing(false); }
    }

    async subscribe() {
        const subscribeToStream = (streamName: string) => doUntilDone(() => {
            const subscription = this.api?.send({ [streamName]: 1, subscribe: 1 });
            if (subscription) this.current_auth_subscriptions.push(subscription);
            return subscription;
        }, [], this);
        await Promise.all(['balance', 'transaction', 'proposal_open_contract'].map(subscribeToStream));
    }

    private getPublicActiveSymbols = async (): Promise<any[]> => {
        const wsUrl = 'wss://api.derivws.com/trading/v1/options/ws/public';
        return new Promise((resolve, reject) => {
            let settled = false;
            const ws = new WebSocket(wsUrl);
            const timeoutId = window.setTimeout(() => {
                if (settled) return;
                settled = true;
                try { ws.close(); } catch {}
                reject(new Error('New Deriv public WebSocket timed out while loading active symbols.'));
            }, this.PUBLIC_WS_TIMEOUT_MS);
            const finish = (callback: () => void) => {
                if (settled) return;
                settled = true; window.clearTimeout(timeoutId);
                try { ws.close(); } catch {}
                callback();
            };
            ws.addEventListener('open', () => ws.send(JSON.stringify({ active_symbols: 'brief', req_id: Date.now() })));
            ws.addEventListener('message', event => {
                try {
                    const response = JSON.parse(event.data);
                    if (response.error) return finish(() => reject(new Error(response.error.message || 'Deriv public API error')));
                    if (response.msg_type === 'active_symbols' && Array.isArray(response.active_symbols)) {
                        const normalizedSymbols = response.active_symbols.map(symbol => ({
                            ...symbol,
                            symbol: symbol.symbol || symbol.underlying_symbol,
                            underlying_symbol: symbol.underlying_symbol || symbol.symbol,
                            display_name: symbol.display_name || symbol.underlying_symbol_name || symbol.underlying_symbol || symbol.symbol,
                            symbol_type: symbol.symbol_type || symbol.underlying_symbol_type,
                            underlying_symbol_type: symbol.underlying_symbol_type || symbol.symbol_type,
                            pip: symbol.pip ?? symbol.pip_size,
                            pip_size: symbol.pip_size ?? symbol.pip,
                        }));
                        finish(() => resolve(normalizedSymbols));
                    }
                } catch (error) { finish(() => reject(error instanceof Error ? error : new Error('Invalid Deriv API response'))); }
            });
            ws.addEventListener('error', () => finish(() => reject(new Error('Unable to connect to the new Deriv public WebSocket.'))));
            ws.addEventListener('close', () => { if (!settled) finish(() => reject(new Error('Deriv public WebSocket closed before active symbols were received.'))); });
        });
    };

    getActiveSymbols = async () => {
        if (!this.api) throw new Error('API connection not available for fetching active symbols');
        try {
            const apiResult = !this.is_authorized ? await this.getPublicActiveSymbols() : await Promise.race([
                doUntilDone(() => this.api?.send({ active_symbols: 'brief' }), [], this),
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Active symbols fetch timeout')), this.ACTIVE_SYMBOLS_TIMEOUT_MS)),
            ]);
            const activeSymbols = Array.isArray(apiResult) ? apiResult : (apiResult as any)?.active_symbols || [];
            if (!activeSymbols.length) throw new Error('No active symbols received from the new Deriv API.');
            this.has_active_symbols = true;
            try {
                const processedResult = await Promise.race([
                    activeSymbolsProcessorService.processActiveSymbols(activeSymbols),
                    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Enrichment timeout')), this.ENRICHMENT_TIMEOUT_MS)),
                ]);
                this.active_symbols = processedResult.enrichedSymbols;
                this.pip_sizes = processedResult.pipSizes;
            } catch (enrichmentError) { console.warn('Symbol enrichment failed, using raw symbols:', enrichmentError); this.active_symbols = activeSymbols; this.pip_sizes = {}; }
            this.toggleRunButton(false);
            return this.active_symbols;
        } catch (error) { this.has_active_symbols = false; console.error('Failed to fetch and process active symbols:', error); throw error; }
    };

    toggleRunButton = (toggle: boolean) => { const run_button = document.querySelector('#db-animation__run-button'); if (run_button) (run_button as HTMLButtonElement).disabled = toggle; };
    setIsRunning(toggle = false) { this.is_running = toggle; }
    pushSubscription(subscription: CurrentSubscription) { this.subscriptions.push(subscription); }
    clearSubscriptions() { this.subscriptions.forEach(s => s.unsubscribe()); this.subscriptions = []; const global_timeouts = globalObserver.getState('global_timeouts') ?? []; global_timeouts.forEach((_: unknown, i: number) => clearTimeout(i)); }
}

export const api_base = new APIBase();
