import React, { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { ToastContainer } from 'react-toastify';
import useLiveChat from '@/components/chat/useLiveChat';
import { getUrlBase } from '@/components/shared';
import TransactionDetailsModal from '@/components/transaction-details';
import { api_base, ApiHelpers, ServerTime } from '@/external/bot-skeleton';
import useDevMode from '@/hooks/useDevMode';
import { useStore } from '@/hooks/useStore';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import { OAuthLoginService } from '@/services/oauth-login.service';
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
    const [auth_error, setAuthError] = React.useState('');
    const [auth_loading, setAuthLoading] = React.useState(false);
    const store = useStore();
    const { app, transactions, common, client } = store;
    const { is_dark_mode_on } = useThemeSwitcher();
    const { recovered_transactions, recoverPendingContracts } = transactions;

    useDevMode();
    useLiveChat({ is_client_store_initialized: !!client, is_logged_in: client?.is_logged_in, loginid: client?.loginid, currency: client?.currency, residence: client?.residence, email: '', first_name: '', last_name: '' });

    useEffect(() => {
        const html = document.documentElement;
        html?.setAttribute('lang', common.current_language.toLowerCase());
        html?.setAttribute('dir', common.current_language.toLowerCase() === 'ar' ? 'rtl' : 'ltr');
        setSmartChartsPublicPath(getUrlBase('/js/smartcharts/'));
    }, [common.current_language]);

    const initStores = React.useCallback(() => {
        ServerTime.init(common);
        app.setDBotEngineStores();
        ApiHelpers.setInstance(app.api_helpers_store);
        import('@/utils/gtm').then(({ default: GTM }) => GTM.init(store));
    }, [app, common, store]);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (!params.has('code') && !params.has('error')) return undefined;
        let cancelled = false;
        (async () => {
            setAuthLoading(true);
            setAuthError('');
            const result = await OAuthLoginService.handleCallback();
            if (cancelled) return;
            if (result.error) {
                setAuthError(result.error);
                setAuthLoading(false);
                return;
            }
            if (result.accounts?.length) {
                initStores();
                try {
                    await api_base.init(true);
                } catch (error) {
                    setAuthError(error instanceof Error ? error.message : 'Deriv connection failed after login.');
                }
            }
            setAuthLoading(false);
        })();
        return () => { cancelled = true; };
    }, [initStores]);

    useEffect(() => {
        const attach = () => {
            const elements = Array.from(document.querySelectorAll('button, a'));
            const login = elements.find(el => el.textContent?.trim().toLowerCase() === 'log in');
            const signup = elements.find(el => el.textContent?.trim().toLowerCase() === 'sign up');
            const onLogin = event => {
                event.preventDefault(); event.stopPropagation(); setAuthError('');
                OAuthLoginService.start('login').catch(error => setAuthError(error instanceof Error ? error.message : 'Unable to start Deriv login.'));
            };
            const onSignup = event => {
                event.preventDefault(); event.stopPropagation(); setAuthError('');
                OAuthLoginService.start('signup').catch(error => setAuthError(error instanceof Error ? error.message : 'Unable to start Deriv sign up.'));
            };
            login?.addEventListener('click', onLogin, true);
            signup?.addEventListener('click', onSignup, true);
            return () => {
                login?.removeEventListener('click', onLogin, true);
                signup?.removeEventListener('click', onSignup, true);
            };
        };
        let cleanup = attach();
        const mutationObserver = new MutationObserver(() => { cleanup(); cleanup = attach(); });
        mutationObserver.observe(document.body, { childList: true, subtree: true });
        return () => { cleanup(); mutationObserver.disconnect(); };
    }, []);

    useEffect(() => {
        if (!client?.is_logged_in || !api_base?.api) return undefined;
        const subscription = api_base.api.onMessage()?.subscribe(({ data }) => {
            if (data?.msg_type === 'proposal_open_contract' && !data?.error) {
                const contract = data.proposal_open_contract;
                if (contract?.status !== 'open' && !recovered_transactions?.includes(contract?.contract_id)) recoverPendingContracts(contract);
            }
        });
        return () => subscription?.unsubscribe?.();
    }, [client?.is_logged_in, client?.loginid, recovered_transactions, recoverPendingContracts]);

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
                {auth_loading && <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(2,8,23,.86)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ background: '#0b1224', color: '#fff', border: '1px solid rgba(22,200,255,.25)', borderRadius: 18, padding: 28, textAlign: 'center', maxWidth: 340, boxShadow: '0 20px 60px rgba(0,0,0,.45)' }}><img src='/deriv-logo.svg' alt='DerivFX' style={{ width: 220, maxWidth: '80%', height: 'auto', marginBottom: 16 }} /><strong>Connecting to Deriv…</strong><p style={{ opacity: .75 }}>Signing you in and loading your trading accounts.</p></div></div>}
                {auth_error && <div role='alert' style={{ position: 'fixed', left: 16, right: 16, bottom: 80, zIndex: 100000, background: '#0b1224', color: '#fff', border: '1px solid rgba(255,68,79,.45)', borderRadius: 12, padding: 16, boxShadow: '0 8px 30px rgba(0,0,0,.35)' }}><strong>DerivFX connection failed</strong><div style={{ marginTop: 6, opacity: .82 }}>{auth_error}</div><button type='button' onClick={() => setAuthError('')} style={{ marginTop: 10 }}>Close</button></div>}
            </div>
        </ThemeProvider>
    );
});

export default AppContent;
