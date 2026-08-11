import React, { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { ToastContainer } from 'react-toastify';
import AuthLoadingWrapper from '@/components/auth-loading-wrapper';
import useLiveChat from '@/components/chat/useLiveChat';
import ChunkLoader from '@/components/loader/chunk-loader';
import { getUrlBase } from '@/components/shared';
import TransactionDetailsModal from '@/components/transaction-details';
import { api_base, ApiHelpers, ServerTime } from '@/external/bot-skeleton';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
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

const AppContent = observer(() => {
    const [is_api_initialized, setIsApiInitialized] = React.useState(false);
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

    const livechat_client_information = {
        is_client_store_initialized: client?.is_logged_in ? true : !!client,
        is_logged_in: client?.is_logged_in,
        loginid: client?.loginid,
        currency: client?.currency,
        residence: client?.residence,
        email: '',
        first_name: '',
        last_name: '',
    };

    useLiveChat(livechat_client_information);

    useEffect(() => {
        if (connectionStatus === CONNECTION_STATUS.OPENED) {
            setIsApiInitialized(true);
            common.setSocketOpened(true);
        } else {
            common.setSocketOpened(false);
        }
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
        if (!is_subscribed_to_msg_listener.current && client.is_logged_in && is_api_initialized && api_base?.api) {
            is_subscribed_to_msg_listener.current = true;
            msg_listener.current = api_base.api.onMessage()?.subscribe(handleMessage);
        }
        return () => {
            if (is_subscribed_to_msg_listener.current && msg_listener.current) {
                is_subscribed_to_msg_listener.current = false;
                msg_listener.current.unsubscribe?.();
            }
        };
    }, [is_api_initialized, client.is_logged_in, client.loginid, handleMessage, connectionStatus]);

    const init = () => {
        ServerTime.init(common);
        app.setDBotEngineStores();
        ApiHelpers.setInstance(app.api_helpers_store);
        import('@/utils/gtm').then(({ default: GTM }) => GTM.init(store));
    };

    /**
     * New API initialization path.
     *
     * Do NOT call the legacy ActiveSymbols.retrieveActiveSymbols() here. That
     * method starts by waiting for legacy trading_times and was the source of
     * the indefinite loading state. The new public Options WebSocket is the
     * source of truth for initial market metadata.
     */
    const initializeNewDerivAPI = React.useCallback(async () => {
        init();
        setInitializationError('');
        setIsLoading(true);

        try {
            if (!api_base?.api) {
                throw new Error('Deriv WebSocket is not ready.');
            }

            const symbols = await Promise.race([
                api_base.getActiveSymbols(),
                new Promise((_, reject) =>
                    window.setTimeout(
                        () => reject(new Error('New Deriv API timed out while loading active markets.')),
                        15000
                    )
                ),
            ]);

            if (!Array.isArray(symbols) || symbols.length === 0) {
                throw new Error('New Deriv API returned no active markets.');
            }

            // Seed the existing bot helper with the new API response so the
            // existing dropdowns/categorization can continue working.
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

            setInitializationError('');
            setIsLoading(false);
        } catch (error) {
            console.error('[DerivFX] New API initialization failed:', error);
            setInitializationError(error instanceof Error ? error.message : 'Unable to load Deriv trading data.');
            setIsLoading(false);
        }
    }, [common, app, store]);

    React.useEffect(() => {
        if (is_api_initialized) {
            initializeNewDerivAPI();
        }
    }, [is_api_initialized, initializeNewDerivAPI]);

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
