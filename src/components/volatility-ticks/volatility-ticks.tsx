import React from 'react';
import './volatility-ticks.scss';

type Tick = { symbol: string; quote: number | null; epoch?: number };

const SYMBOLS = [
    ['R_10', 'Volatility 10'],
    ['R_25', 'Volatility 25'],
    ['R_50', 'Volatility 50'],
    ['R_75', 'Volatility 75'],
    ['R_100', 'Volatility 100'],
    ['1HZ10V', 'Volatility 10 (1s)'],
    ['1HZ15V', 'Volatility 15 (1s)'],
    ['1HZ25V', 'Volatility 25 (1s)'],
    ['1HZ30V', 'Volatility 30 (1s)'],
    ['1HZ50V', 'Volatility 50 (1s)'],
    ['1HZ75V', 'Volatility 75 (1s)'],
    ['1HZ100V', 'Volatility 100 (1s)'],
] as const;

const getAppId = () => String(process.env.APP_ID || process.env.CLIENT_ID || '340');

const VolatilityTicks = () => {
    const [ticks, setTicks] = React.useState<Record<string, Tick>>(() =>
        Object.fromEntries(SYMBOLS.map(([symbol]) => [symbol, { symbol, quote: null }]))
    );
    const [connected, setConnected] = React.useState(false);

    React.useEffect(() => {
        let socket: WebSocket | null = null;
        let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
        let stopped = false;

        const connect = () => {
            if (stopped) return;
            socket = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(getAppId())}`);

            socket.onopen = () => {
                if (stopped || !socket) return;
                setConnected(true);
                SYMBOLS.forEach(([symbol]) =>
                    socket?.send(JSON.stringify({ ticks: symbol, subscribe: 1 }))
                );
            };

            socket.onmessage = event => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.msg_type !== 'tick' || !data.tick?.symbol) return;
                    const { symbol, quote, epoch } = data.tick;
                    setTicks(previous => ({
                        ...previous,
                        [symbol]: { symbol, quote: Number(quote), epoch },
                    }));
                } catch {
                    // Ignore malformed WebSocket frames.
                }
            };

            socket.onclose = () => {
                setConnected(false);
                if (!stopped) reconnectTimer = setTimeout(connect, 2500);
            };

            socket.onerror = () => setConnected(false);
        };

        connect();
        return () => {
            stopped = true;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            socket?.close();
        };
    }, []);

    return (
        <section className='volatility-ticks'>
            <div className='volatility-ticks__header'>
                <div>
                    <h2>Live Volatility Indices</h2>
                    <p>Real-time Deriv tick prices</p>
                </div>
                <span className={connected ? 'status status--live' : 'status'}>
                    <i /> {connected ? 'LIVE' : 'CONNECTING'}
                </span>
            </div>
            <div className='volatility-ticks__grid'>
                {SYMBOLS.map(([symbol, label]) => {
                    const item = ticks[symbol];
                    return (
                        <div className='tick-card' key={symbol}>
                            <div className='tick-card__name'>{label}</div>
                            <div className='tick-card__symbol'>{symbol}</div>
                            <strong>{item?.quote === null ? '—' : item?.quote?.toFixed(2)}</strong>
                            <span className='tick-card__dot' />
                        </div>
                    );
                })}
            </div>
        </section>
    );
};

export default VolatilityTicks;
