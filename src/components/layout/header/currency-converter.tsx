import { useEffect, useState } from 'react';
import './currency-converter.scss';

const CurrencyConverter = () => {
    const [open, setOpen] = useState(false);
    const [amount, setAmount] = useState('1');
    const [usdToKes, setUsdToKes] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open || usdToKes !== null) return;
        let cancelled = false;
        setLoading(true);
        fetch('https://open.er-api.com/v6/latest/USD')
            .then(response => response.json())
            .then(data => {
                const rate = Number(data?.rates?.KES);
                if (!cancelled && Number.isFinite(rate)) setUsdToKes(rate);
            })
            .catch(() => {
                if (!cancelled) setUsdToKes(null);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open, usdToKes]);

    const numericAmount = Number(amount) || 0;
    const kesValue = usdToKes === null ? null : numericAmount * usdToKes;

    return (
        <div className='derivfx-currency'>
            <button type='button' className='derivfx-currency__tab' onClick={() => setOpen(value => !value)} aria-expanded={open}>
                <span className='derivfx-currency__usd'>$</span>
                <span>USD</span>
                <span className='derivfx-currency__swap'>⇄</span>
                <span>KSh</span>
                <span className='derivfx-currency__chevron'>{open ? '⌃' : '⌄'}</span>
            </button>
            {open && (
                <div className='derivfx-currency__panel'>
                    <div className='derivfx-currency__title'>USD ⇄ Kenyan Shilling</div>
                    <label className='derivfx-currency__field'>
                        <span>$</span>
                        <input value={amount} onChange={event => setAmount(event.target.value.replace(/[^0-9.]/g, ''))} inputMode='decimal' aria-label='USD amount' />
                        <span>USD</span>
                    </label>
                    <div className='derivfx-currency__result'>
                        <span>KSh</span>
                        <strong>{loading ? 'Loading…' : kesValue === null ? '—' : kesValue.toLocaleString('en-KE', { maximumFractionDigits: 2 })}</strong>
                    </div>
                    <div className='derivfx-currency__rate'>
                        {usdToKes === null ? 'Exchange rate unavailable' : `1 USD = ${usdToKes.toFixed(2)} KSh`}
                    </div>
                </div>
            )}
        </div>
    );
};

export default CurrencyConverter;
