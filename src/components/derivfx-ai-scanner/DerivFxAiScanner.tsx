import { useEffect, useMemo, useRef, useState } from 'react';
import './DerivFxAiScanner.scss';

type SymbolCode = '1HZ30V' | '1HZ50V' | '1HZ75V' | '1HZ100V';
type Strategy = 'DIGITOVER' | 'DIGITUNDER' | 'DIGITEVEN' | 'DIGITODD';
type Score = { symbol: SymbolCode; score: number; strategy: Strategy; digit: number; digits: number[] };

const MARKETS: SymbolCode[] = ['1HZ30V', '1HZ50V', '1HZ75V', '1HZ100V'];
const digitOf = (quote: number) => Number(String(quote).replace('.', '').slice(-1));

const DerivFxAiScanner = () => {
    const [open, setOpen] = useState(true);
    const [running, setRunning] = useState(false);
    const [connected, setConnected] = useState(false);
    const [ticks, setTicks] = useState<Record<SymbolCode, number[]>>({
        '1HZ30V': [], '1HZ50V': [], '1HZ75V': [], '1HZ100V': [],
    });
    const socket = useRef<WebSocket | null>(null);

    useEffect(() => {
        const ws = new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public');
        socket.current = ws;
        ws.onopen = () => {
            setConnected(true);
            MARKETS.forEach(symbol => ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 })));
        };
        ws.onmessage = event => {
            try {
                const data = JSON.parse(event.data);
                if (data.msg_type !== 'tick' || !data.tick) return;
                const symbol = data.tick.symbol as SymbolCode;
                if (!MARKETS.includes(symbol)) return;
                const digit = digitOf(Number(data.tick.quote));
                setTicks(prev => ({ ...prev, [symbol]: [...prev[symbol], digit].slice(-100) }));
            } catch { return; }
        };
        ws.onclose = () => setConnected(false);
        ws.onerror = () => setConnected(false);
        return () => ws.close();
    }, []);

    const scores = useMemo<Score[]>(() => MARKETS.map(symbol => {
        const digits = ticks[symbol];
        if (!digits.length) return { symbol, score: 0, strategy: 'DIGITOVER', digit: 4, digits };
        const counts = Array.from({ length: 10 }, (_, i) => digits.filter(d => d === i).length);
        const over4 = counts.slice(5).reduce((a, b) => a + b, 0) / digits.length;
        const under5 = counts.slice(0, 5).reduce((a, b) => a + b, 0) / digits.length;
        const even = counts.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) / digits.length;
        const odd = 1 - even;
        const candidates: { strategy: Strategy; p: number; digit: number }[] = [
            { strategy: 'DIGITOVER', p: over4, digit: 4 },
            { strategy: 'DIGITUNDER', p: under5, digit: 5 },
            { strategy: 'DIGITEVEN', p: even, digit: 0 },
            { strategy: 'DIGITODD', p: odd, digit: 0 },
        ].sort((a, b) => b.p - a.p);
        const best = candidates[0];
        return { symbol, score: Math.round(best.p * 100), strategy: best.strategy, digit: best.digit, digits };
    }), [ticks]);

    const best = [...scores].sort((a, b) => b.score - a.score)[0];
    const strategyName = (s: Strategy) => ({ DIGITOVER: 'OVER 4', DIGITUNDER: 'UNDER 5', DIGITEVEN: 'EVEN', DIGITODD: 'ODD' }[s]);

    const loadBot = () => {
        if (!best) return;
        window.dispatchEvent(new CustomEvent('derivfx:ai-scanner-load', { detail: {
            symbol: best.symbol, contractType: best.strategy, barrier: best.digit,
            duration: 1, durationUnit: 't', stake: 0.35, recoveryMultiplier: 2,
            stopLoss: 50, takeProfit: 10, maxWins: 4,
        }}));
    };
    const runBot = () => { loadBot(); setRunning(true); window.dispatchEvent(new CustomEvent('derivfx:ai-scanner-run')); };
    const stopBot = () => { setRunning(false); window.dispatchEvent(new CustomEvent('derivfx:ai-scanner-stop')); };

    if (!open) return <button className="dfx-ai-bubble" onClick={() => setOpen(true)}>✦ AI</button>;
    return <aside className="dfx-ai-scanner" aria-label="DerivFX AI Scanner">
        <header><div><span className="dfx-ai-dot" /><b>DerivFX AI Scanner</b><small>{connected ? ' LIVE' : ' CONNECTING'}</small></div><button onClick={() => setOpen(false)}>−</button></header>
        <div className="dfx-ai-body">
            <div className="dfx-ai-title">BEST MARKET <strong>{best?.symbol}</strong></div>
            <div className="dfx-ai-market-list">{scores.map(item => <div key={item.symbol} className={item.symbol === best?.symbol ? 'best' : ''}><span>{item.symbol}</span><b>{item.score || '—'}%</b></div>)}</div>
            <div className="dfx-ai-signal"><small>LIVE SIGNAL</small><strong>{strategyName(best?.strategy || 'DIGITOVER')}</strong><span>{best?.score || 0}% statistical score</span></div>
            <div className="dfx-ai-last">{best?.digits.slice(-24).map((d, i) => <i key={`${i}-${d}`}>{d}</i>)}</div>
            <div className="dfx-ai-settings"><span>$0.35</span><span>×2</span><span>1 TICK</span><span>SL $50</span><span>TP $10</span><span>4 WINS</span></div>
            <div className="dfx-ai-actions"><button onClick={loadBot}>LOAD BOT</button><button className="run" onClick={runBot} disabled={running}>RUN BOT</button></div>
            {running && <button className="dfx-ai-stop" onClick={stopBot}>■ STOP BOT</button>}
            <small className="dfx-ai-note">Scanner ranks recent live digits; it does not guarantee the next outcome.</small>
        </div>
    </aside>;
};

export default DerivFxAiScanner;
