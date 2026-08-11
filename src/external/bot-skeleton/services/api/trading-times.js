import { getTradingTimes, TRADING_TIMES } from '../../../../components/shared/utils/common-data';
import { api_base } from './api-base';
import PendingPromise from '../../utils/pending-promise';

export default class TradingTimes {
    constructor({ ws, server_time }) {
        this.init_promise = new PendingPromise();
        this.is_initialised = false;
        this.trading_times = {};
        this.ws = ws;
        this.server_time = server_time.clone();
        this.onMarketOpenCloseChanged = null;
    }

    async initialise() {
        if (this.is_initialised) return this.init_promise;

        this.is_initialised = true;
        this.last_update_moment = this.server_time.local();

        // Trading times are supplementary metadata. They must never block the
        // initial market-symbol load or the whole DerivFX dashboard.
        try {
            await Promise.race([
                this.updateTradingTimes(),
                new Promise(resolve => setTimeout(resolve, 3000)),
            ]);
        } catch (error) {
            console.warn('[TradingTimes] Initial load failed; using fallback:', error);
            this.setTradingTimes();
        }

        if (!Object.keys(this.trading_times).length) this.setTradingTimes();
        this.updateMarketOpenClosed();
        this.init_promise.resolve();

        return this.init_promise;
    }

    async updateTradingTimes() {
        const last_update_date = this.last_update_moment.format('YYYY-MM-DD');

        try {
            if (!api_base.api && !this.ws) {
                this.setTradingTimes();
                return;
            }

            const response = await Promise.race([
                api_base.api?.send({ trading_times: last_update_date }) || this.ws?.send({ trading_times: last_update_date }),
                new Promise(resolve => setTimeout(() => resolve(null), 2500)),
            ]);

            if (response?.error || !response?.trading_times?.markets) {
                this.setTradingTimes();
                return;
            }

            this.trading_times = {};
            const now = this.server_time.local().toDate();
            const date_str = now.toISOString().substring(0, 11);
            const getUTCDate = hour => new Date(`${date_str}${hour}Z`);

            response.trading_times.markets?.forEach(market => {
                market.submarkets?.forEach(submarket => {
                    submarket.symbols?.forEach(symbol_obj => {
                        const { times, underlying_symbol } = symbol_obj;
                        if (!underlying_symbol || !times?.open || !times?.close) return;

                        const is_open_all_day = times.open.length === 1 && times.open[0] === '00:00:00' && times.close[0] === '23:59:59';
                        const is_closed_all_day = times.open.length === 1 && times.open[0] === '--' && times.close[0] === '--';
                        let processed_times;

                        if (!is_open_all_day && !is_closed_all_day) {
                            processed_times = times.open.map((open_time, index) => ({
                                open: getUTCDate(open_time),
                                close: getUTCDate(times.close[index]),
                            }));
                        }

                        this.trading_times[underlying_symbol] = {
                            is_open_all_day,
                            is_closed_all_day,
                            times: processed_times,
                        };
                    });
                });
            });

            this.injectAdditionalTradingTimes();
            if (!Object.keys(this.trading_times).length) this.setTradingTimes();
        } catch (error) {
            console.warn('[TradingTimes] API request failed; using fallback:', error);
            this.setTradingTimes();
        }
    }

    injectAdditionalTradingTimes() {
        ['1HZ15V', '1HZ30V', '1HZ90V'].forEach(symbol => {
            if (!this.trading_times[symbol]) {
                this.trading_times[symbol] = {
                    is_open_all_day: true,
                    is_closed_all_day: false,
                    times: undefined,
                    is_opened: true,
                };
            }
        });
    }

    setTradingTimes() {
        this.trading_times = {};
        TRADING_TIMES.SYMBOLS.forEach(symbol => {
            try {
                const data = getTradingTimes(symbol);
                if (data && typeof data === 'object') this.trading_times[symbol] = data;
            } catch (error) {
                console.warn(`[TradingTimes] Fallback failed for ${symbol}:`, error);
            }
        });
        this.injectAdditionalTradingTimes();
    }

    updateMarketOpenClosed() {
        const changes = {};
        Object.keys(this.trading_times).forEach(symbol_name => {
            const is_opened = this.calcIsMarketOpened(symbol_name);
            const symbol_obj = this.trading_times[symbol_name];
            if (symbol_obj.is_opened !== is_opened) {
                symbol_obj.is_opened = is_opened;
                changes[symbol_name] = is_opened;
            }
        });
        return changes;
    }

    calcIsMarketOpened(symbol_name) {
        const item = this.trading_times[symbol_name];
        if (!item) return false;
        if (item.is_closed_all_day) return false;
        if (item.is_open_all_day) return true;
        if (!item.times?.length) return true;
        const now = this.server_time.local().unix();
        return item.times.some(session => now >= session.open && now < session.close);
    }

    nextUpdateDate() {
        const now = this.server_time.local().toDate();
        let nextDate;
        Object.keys(this.trading_times).forEach(symbol_name => {
            const { times, is_open_all_day, is_closed_all_day } = this.trading_times[symbol_name];
            if (is_open_all_day || is_closed_all_day || !times) return;
            times.forEach(session => {
                if (session.open > now && (!nextDate || session.open < nextDate)) nextDate = session.open;
                if (session.close > now && (!nextDate || session.close < nextDate)) nextDate = session.close;
            });
        });
        return nextDate;
    }

    isMarketOpened(symbol_name) {
        return !!this.trading_times[symbol_name]?.is_opened;
    }

    getSymbolDisplayName(symbol) {
        return TRADING_TIMES.SYMBOL_DISPLAY_NAMES[symbol] || symbol;
    }
}
