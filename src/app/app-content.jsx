import React, { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { ToastContainer } from 'react-toastify';
import AuthLoadingWrapper from '@/components/auth-loading-wrapper';
import useLiveChat from '@/components/chat/useLiveChat';
import ChunkLoader from '@/components/loader/chunk-loader';
import { getUrlBase } from '@/components/shared';
import TransactionDetailsModal from '@/components/transaction-details';
import { api_base, ApiHelpers, ServerTime } from '@/external/bot-skeleton';
import { useApiBase } from '@/hooks/useApiBase';
import useDevMode from '@/hooks/useDevMode';
import { useStore } from '@/hooks/useStore';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import { ThemeProvider } from '@deriv-com/quill-ui';
import { setSmartChartsPublicPath } from '@deriv-com/smartcharts-champion';
import { localize } from '@deriv-com/translations';
import Audio from '../components/audio';
import BlocklyLoading from '../components/blockly-loading';
import BotStopped from '../components/bot-stopped';
import BotBuilder from '../pages/bot-builder';
import Main from '../pages/main';
import './app.scss';
import 'react-toastify/dist/ReactToastify.css';
import '../components/bot-notification/bot-notification.scss';

const sleep = ms => new Promise(resolve => window.setTimeout(resolve, ms));

const AppContent = observer(() => {
    const [is_loading, setIsLoading] = React.useState(true);
    const [initialization_error, setInitializationError] = React.useState('');

    const store = useStore();
    const { app, transactions, common, client } = store;
    const { is_dark_mode_on } = useThemeSwitcher();
    const { recovered_transactions, recoverPendingContracts } = transactions;
    const is_subscribed_to_msg_listener = React.useRef(false);
    const msg_listener = React.useRef(null);
    const { connectionStatus } = useApiBase();

    useDevMode();

    useLiveChat({
        is_client_store_initialized: client?.is_logged_in ? true : !!client,
        is_logged_in: client?.is_logged_in,
        loginid: client?.loginid,
        currency: client?.currency,
        residence: client?.residence,
        email: '',
        first_name: '',
        last_name: '',
    });

    useEffect(() => {
        common.setSocketOpened(connectionStatus === 'opened');
    }, [common, connectionStatus]);

    const { current_language } = common;
    const html = document.documentElement;
    React.useEffect(() => {
        html?.setAttribute('lang', current_language.toLowerCase());
        html?.setAttribute('dir', current_language.toLowerCase() === 'ar' ? 'rtl' : 'ltr');
    }, [current_language, html]);

    const handleMessage = React.useCallback(({ data }) => {
        if (data?.msg_type === 'proposal_open_contract' && !data?.error) {
            const { proposal_open_contract } = data;
            if (proposal_open_contract?.status !== 'open' && !recovered_transactions?.includes(proposal_open_contract?.contract_id)) {
                recoverPendingContracts(proposal_open_contract);
            }
        }
    }, [recovered_transactions, recoverPendingContracts]);

    React.useEffect(() => {
        setSmartChartsPublicPath(getUrlBase('/js/smartcharts/'));
    }, []);

    React.useEffect(() => {
        if (!is_subscribed_to_msg_listener.current && client.is_logged_in && api_base?.api) {
            is_subscribed_to_msg_listener.current = true;
            msg_listener.current = api_base.api.onMessage()?.subscribe(handleMessage);
        }
        return () => {
            if (is_subscribed_to_msg_listener.current && msg_listener.current) {
                is_subscribed_to_msg_listener.current = false;
                msg_listener.current.unsubscribe?.();
                msg_listener.current = null;
            }
        };
    }, [client.is_logged_in, client.loginid, handleMessage, connectionStatus]);

    const init = React.useCallback(() => {
        ServerTime.init(common);
        app.setDBotEngineStores();
        ApiHelpers.setInstance(app.api_helpers_store);
        import('@/utils/gtm').then(({ default: GTM }) => GTM.init(store));
    }, [app, common, store]);

    const initializeDashboard = React.useCallback(async () => {
        init();
        setInitializationError('');
        setIsLoading(true);

        let lastError = null;

        // The dashboard must not wait for the legacy DerivAPIBasic socket.
        // The new public Options API is used directly for initial market data.
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                if (!api_base.api) {
                    await api_base.init();
                }

                if (!api_base.api) throw new Error('Deriv API client could not be created.');

                const symbols = await Promise.race([
                    api_base.getActiveSymbols(),
                    new Promise((_, reject) =>
                        window.setTimeout(
                            () => reject(new Error('New Deriv API timed out while loading active markets.')),
                            12000
                        )
                    ),
                ]);

                if (!Array.isArray(symbols) || symbols.length === 0) {
                    throw new Error('New Deriv API returned no active markets.');
                }

                // Adapt the new API response to the existing bot UI without
                // running the old startup promise/trading-times chain.
                const activeSymbols = ApiHelpers.instance?.active_symbols;
                if (!activeSymbols) throw new Error('DerivFX symbol helper is unavailable.');

                activeSymbols.active_symbols = symbols;
                activeSymbols.is_initialised = true;
                activeSymbols.has_initialization_error = false;
                activeSymbols.processed_symbols = activeSymbols.processActiveSymbols();
                activeSymbols.init_promise?.resolve?.();

                api_base.has_active_symbols = true;
                api_base.active_symbols = symbols;
                api_base.active_symbols_promise = Promise.resolve(symbols);

                setIsLoading(false);
                return;
            } catch (error) {
                lastError = error;
                console.error(`[DerivFX] New API startup attempt ${attempt + 1} failed:`, error);
                if (attempt < 2) await sleep(1000);
            }
        }

        setInitializationError(lastError instanceof Error ? lastError.message : 'Unable to load the new Deriv API.');
        setIsLoading(false);
    }, [init]);

    React.useEffect(() => {
        let cancelled = false;
        const start = async () => {
            // AppRoot initializes the API in parallel. Do not require its
            // connection-status observable to become OPEN before proceeding.
            await sleep(500);
            if (!cancelled) initializeDashboard();
        };
        start();
        return () => {
            cancelled = true;
        };
    }, [initializeDashboard]);

    if (common?.error) return null;

    if (is_loading) return <ChunkLoader message={localize('Connecting to DerivFX New API...')} />;

    if (initialization_error) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
                <div>
                    <h2>{localize('Unable to initialize DerivFX')}</h2>
                    <p style={{ margin: '12px 0 20px' }}>{initialization_error}</p>
                    <button type='button' onClick={() => window.location.reload()} style={{ padding: '12px 24px', borderRadius: 8, border: 0, cursor: 'pointer' }}>
                        {localize('Retry')}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <AuthLoadingWrapper>
            <ThemeProvider theme={is_dark_mode_on ? 'dark' : 'light'}>
                <BlocklyLoading />
                <div className='bot-dashboard bot' data-testid='dt_bot_dashboard'>
                    <Audio />
                    <Main />
                    <BotBuilder />
                    <BotStopped />
                    <TransactionDetailsModal />
                    <ToastContainer limit={3} draggable={false} />
                </div>
            </ThemeProvider>
        </AuthLoadingWrapper>
    );
});

export default AppContent;
