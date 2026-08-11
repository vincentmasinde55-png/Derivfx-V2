import React, { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { ToastContainer } from 'react-toastify';
import useLiveChat from '@/components/chat/useLiveChat';
import { getUrlBase } from '@/components/shared';
import TransactionDetailsModal from '@/components/transaction-details';
import { api_base } from '@/external/bot-skeleton';
import useDevMode from '@/hooks/useDevMode';
import { useStore } from '@/hooks/useStore';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import { ThemeProvider } from '@deriv-com/quill-ui';
import { setSmartChartsPublicPath } from '@deriv-com/smartcharts-champion';
import Audio from '../components/audio';
import BlocklyLoading from '../components/blockly-loading';
import BotStopped from '../components/bot-stopped';
import BotBuilder from '../pages/bot-builder';
import Main from '../pages/main';
import './app.scss';
import 'react-toastify/dist/ReactToastify.css';
import '../components/bot-notification/bot-notification.scss';

const AppContent = observer(() => {
    const store = useStore();
    const { transactions, common, client } = store;
    const { is_dark_mode_on } = useThemeSwitcher();
    const { recovered_transactions, recoverPendingContracts } = transactions;

    useDevMode();

    useLiveChat({
        is_client_store_initialized: !!client,
        is_logged_in: client?.is_logged_in,
        loginid: client?.loginid,
        currency: client?.currency,
        residence: client?.residence,
        email: '',
        first_name: '',
        last_name: '',
    });

    useEffect(() => {
        const html = document.documentElement;
        html?.setAttribute('lang', common.current_language.toLowerCase());
        html?.setAttribute('dir', common.current_language.toLowerCase() === 'ar' ? 'rtl' : 'ltr');
        setSmartChartsPublicPath(getUrlBase('/js/smartcharts/'));
    }, [common.current_language]);

    // The public website must NEVER wait for Deriv. API connections are only
    // relevant after the user logs in. This listener therefore starts only
    // when the client is already authenticated and a socket exists.
    useEffect(() => {
        if (!client?.is_logged_in || !api_base?.api) return undefined;

        const subscription = api_base.api.onMessage()?.subscribe(({ data }) => {
            if (data?.msg_type === 'proposal_open_contract' && !data?.error) {
                const contract = data.proposal_open_contract;
                if (contract?.status !== 'open' && !recovered_transactions?.includes(contract?.contract_id)) {
                    recoverPendingContracts(contract);
                }
            }
        });

        return () => subscription?.unsubscribe?.();
    }, [client?.is_logged_in, client?.loginid, recovered_transactions, recoverPendingContracts]);

    // IMPORTANT: no API initialization, active-symbol request, OAuth request,
    // WebSocket connection, or loading gate is performed here.
    // The UI renders immediately for logged-out visitors.
    return (
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
    );
});

export default AppContent;
