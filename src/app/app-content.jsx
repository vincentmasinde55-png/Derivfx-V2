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
        } else if (connectionStatus !== CONNECTION_STATUS.OPENED) {
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

    const changeActiveSymbolLoadingState = () => {
        init();
        setInitializationError('');

        const retrieveActiveSymbols = async () => {
            try {
                const { active_symbols } = ApiHelpers.instance;
                if (!active_symbols) throw new Error('Deriv API helpers were not initialized.');

                // Never allow symbol initialization to block the entire app forever.
                await Promise.race([
                    active_symbols.retrieveActiveSymbols(true),
                    new Promise((_, reject) =>
                        window.setTimeout(
                            () => reject(new Error('Deriv active-symbols request timed out after 15 seconds.')),
                            15000
                        )
                    ),
                ]);

                setInitializationError('');
                setIsLoading(false);
            } catch (error) {
                console.error('[DerivFX] Initialization failed:', error);
                setInitializationError(error instanceof Error ? error.message : 'Unable to load Deriv trading data.');
                setIsLoading(false);
            }
        };

        if (ApiHelpers?.instance?.active_symbols) {
            retrieveActiveSymbols();
            return;
        }

        let elapsed = 0;
        const intervalId = setInterval(() => {
            elapsed += 250;
            if (ApiHelpers?.instance?.active_symbols) {
                clearInterval(intervalId);
                retrieveActiveSymbols();
            } else if (elapsed >= 10000) {
                clearInterval(intervalId);
                setInitializationError('Deriv API initialization timed out. Please retry.');
                setIsLoading(false);
            }
        }, 250);
    };

    React.useEffect(() => {
        if (is_api_initialized) {
            init();
            setIsLoading(true);
            if (!client.is_logged_in) changeActiveSymbolLoadingState();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [is_api_initialized]);

    React.useEffect(() => {
        if (client.is_logged_in && is_api_initialized) changeActiveSymbolLoadingState();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [is_api_initialized, client.loginid]);

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
