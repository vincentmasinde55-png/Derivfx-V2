import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { addComma, getCurrencyDisplayCode, getDecimalPlaces } from '@/components/shared';
import Text from '@/components/shared_ui/text';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { isDemoAccount } from '@/utils/account-helpers';
import { DerivWSAccountsService, type DerivAccount } from '@/services/derivws-accounts.service';
import { Localize } from '@deriv-com/translations';
import { TAccountSwitcher } from './common/types';
import AccountInfoWrapper from './account-info-wrapper';
import './account-switcher.scss';

const AccountSwitcher = observer(({ activeAccount }: TAccountSwitcher) => {
    const [isOpen, setIsOpen] = useState(false);
    const [storedAccounts, setStoredAccounts] = useState<DerivAccount[]>(() => DerivWSAccountsService.getStoredAccounts() || []);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const { accountList, activeLoginid } = useApiBase();
    const { client, run_panel } = useStore() ?? {};

    const is_bot_running = run_panel?.is_running || api_base.is_running;

    useEffect(() => {
        const refresh = () => setStoredAccounts(DerivWSAccountsService.getStoredAccounts() || []);
        refresh();
        window.addEventListener('derivfx-authenticated', refresh);
        return () => window.removeEventListener('derivfx-authenticated', refresh);
    }, []);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setIsOpen(false);
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    const combinedAccounts = useMemo(() => {
        const fromApi = (accountList || []).map(account => ({
            loginid: account.loginid,
            currency: account.currency,
            balance: account.balance,
            account_type: isDemoAccount(account.loginid) ? 'demo' as const : 'real' as const,
        }));
        const fromOAuth = storedAccounts.map(account => ({
            loginid: account.account_id,
            currency: account.currency,
            balance: account.balance,
            account_type: account.account_type,
        }));
        const map = new Map(fromOAuth.map(account => [account.loginid, account]));
        fromApi.forEach(account => map.set(account.loginid, { ...map.get(account.loginid), ...account }));
        return [...map.values()];
    }, [accountList, storedAccounts]);

    const isSingleAccount = combinedAccounts.length <= 1;
    const currentLoginid = activeLoginid || localStorage.getItem('active_loginid') || combinedAccounts[0]?.loginid;
    const current = combinedAccounts.find(account => account.loginid === currentLoginid) || combinedAccounts[0];

    const toggleDropdown = useCallback(() => {
        if (is_bot_running || isSingleAccount) return;
        setIsOpen(prev => !prev);
    }, [is_bot_running, isSingleAccount]);

    const handleAccountSelect = useCallback(
        (loginid: string) => {
            localStorage.setItem('active_loginid', loginid);
            client?.checkAndRegenerateWebSocket();
            setIsOpen(false);
        },
        [client]
    );

    const formattedAccounts = useMemo(
        () =>
            combinedAccounts
                .map(account => ({
                    ...account,
                    balance: addComma(Number(account.balance ?? 0).toFixed(getDecimalPlaces(account.currency))),
                    isVirtual: account.account_type === 'demo' || isDemoAccount(account.loginid),
                    isActive: account.loginid === currentLoginid,
                }))
                .sort((a, b) => (a.isActive ? -1 : b.isActive ? 1 : 0)),
        [combinedAccounts, currentLoginid]
    );

    if (!current) return null;

    const isVirtual = current.account_type === 'demo' || isDemoAccount(current.loginid);
    const balance = addComma(Number(current.balance ?? 0).toFixed(getDecimalPlaces(current.currency)));
    const currencyCode = getCurrencyDisplayCode(current.currency);
    const showChevron = !isSingleAccount && !is_bot_running;

    return (
        <div className='acc-info__wrapper' ref={wrapperRef}>
            <AccountInfoWrapper>
                <div
                    data-testid='dt_acc_info'
                    id='dt_core_account-info_acc-info'
                    role={showChevron ? 'button' : undefined}
                    tabIndex={showChevron ? 0 : -1}
                    aria-expanded={showChevron ? isOpen : undefined}
                    aria-haspopup={showChevron ? 'listbox' : undefined}
                    className={classNames('acc-info', {
                        'acc-info--is-virtual': isVirtual,
                        'acc-info--interactive': showChevron,
                    })}
                    onClick={toggleDropdown}
                    onKeyDown={e => {
                        if (showChevron && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            toggleDropdown();
                        }
                    }}
                >
                    <span className='acc-info__currency-logo' aria-hidden='true'>{currencyCode === 'USD' ? '$' : currencyCode}</span>
                    <div className='acc-info__content'>
                        <div className='acc-info__account-type-header'>
                            <Text as='p' size='xs' className='acc-info__account-type'>
                                <span className={isVirtual ? 'acc-info__demo-label' : 'acc-info__real-label'}>
                                    {isVirtual ? 'Demo account' : 'Real account'}
                                </span>
                                {showChevron && <span className={classNames('acc-info__select-arrow', { 'acc-info__select-arrow--invert': isOpen })}>⌄</span>}
                            </Text>
                        </div>
                        <p data-testid='dt_balance' className='acc-info__balance'>
                            {balance} {currencyCode}
                        </p>
                        <p className='acc-info__loginid'>{current.loginid}</p>
                    </div>
                </div>
            </AccountInfoWrapper>
            {isOpen && (
                <div className='acc-dropdown' role='listbox'>
                    {formattedAccounts.map(account => (
                        <div
                            key={account.loginid}
                            role='option'
                            aria-selected={account.isActive}
                            tabIndex={0}
                            className={classNames('acc-dropdown__account', {
                                'acc-dropdown__account--selected': account.isActive,
                                'acc-dropdown__account--virtual': account.isVirtual,
                            })}
                            onClick={() => !account.isActive && handleAccountSelect(account.loginid)}
                            onKeyDown={e => {
                                if (!account.isActive && (e.key === 'Enter' || e.key === ' ')) {
                                    e.preventDefault();
                                    handleAccountSelect(account.loginid);
                                }
                            }}
                        >
                            <span className='acc-dropdown__currency-logo'>{account.currency === 'USD' ? '$' : account.currency}</span>
                            <div className='acc-dropdown__account-details'>
                                <Text size='xxxs' className={classNames('acc-dropdown__account-type', { 'acc-dropdown__account-type--virtual': account.isVirtual })}>
                                    {account.isVirtual ? 'Demo account' : 'Real account'}
                                </Text>
                                <Text size='xs' weight='bold' className='acc-dropdown__balance'>
                                    {account.balance} {getCurrencyDisplayCode(account.currency)}
                                </Text>
                                <span className='acc-dropdown__loginid'>{account.loginid}</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
});

export default AccountSwitcher;
