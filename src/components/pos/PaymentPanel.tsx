import React, { useState, useEffect, useRef } from 'react';

export interface PaymentPanelProps {
  total?: number;
  paymentAmount?: string | number;
  /** Callback principal de cobro (preferido) */
  onCharge?: (method: 'cash' | 'card', received?: number, change?: number) => void;
  /** Alias de onCharge (compatibilidad) */
  onPay?: (method: 'cash' | 'card', received?: number, change?: number) => void;
  /** VeriFactu */
  onChargeVeriFactu?: (method: 'cash' | 'card', received?: number, change?: number) => void;
  /** Limpia la mesa tras mostrar el cambio */
  onClearTable?: () => void;
  onEmitInvoice?: () => void;
  [key: string]: any;
}

export function PaymentPanel(props: PaymentPanelProps) {
  const { total = 0, onCharge, onPay, onChargeVeriFactu, onClearTable, onEmitInvoice } = props;
  const [receivedAmount, setReceivedAmount] = useState<string>('0');
  const [changeInfo, setChangeInfo] = useState<{ received: number; change: number } | null>(null);
  const [chargeError, setChargeError] = useState<string | null>(null);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    if (props.paymentAmount !== undefined && !changeInfo) {
      setReceivedAmount(String(props.paymentAmount));
    }
  }, [props.paymentAmount, changeInfo]);

  const handleNumClick = (val: string) => {
    if (changeInfo) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setChangeInfo(null);
    }

    if (val === 'C') {
      setReceivedAmount('0');
    } else if (val === 'DEL') {
      setReceivedAmount(prev => (prev.length > 1 ? prev.slice(0, -1) : '0'));
    } else {
      setReceivedAmount(prev => (prev === '0' ? val : prev + val));
    }
  };

  const handleCobrar = () => {
    console.log('★ [PaymentPanel] COBRAR clickeado! ★');
    const finalTotal = Number(total) || 0;
    const recNum = parseFloat(receivedAmount) > 0 ? parseFloat(receivedAmount) : finalTotal;
    const calculatedChange = Math.max(0, recNum - finalTotal);

    setChangeInfo({ received: recNum, change: calculatedChange });

    // ★★★ LLAMAR AL COBRO ★★★
    // Prioridad: onCharge > onPay > onChargeVeriFactu
    const callback = onCharge ?? onPay ?? onChargeVeriFactu;
    if (typeof callback === 'function') {
      callback('cash', recNum, calculatedChange);
    } else {
      console.warn('[PaymentPanel] NO hay callback de cobro definido');
      setChargeError('Recarga la página para poder cobrar.');
    }

    // Mantener quieto en pantalla durante 6 segundos y vaciar mesa
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setChangeInfo(null);
      setReceivedAmount('0');
      if (typeof onClearTable === 'function') {
        onClearTable();
      } else if (typeof props.onEmptyCart === 'function') {
        props.onEmptyCart();
      }
    }, 6000);
  };

  return (
    <div className="h-full flex flex-col justify-between p-2 min-h-0 select-none">
      {chargeError && (
        <div className="mb-2 p-2 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center gap-2">
          <span className="font-bold">Atención:</span>
          <span>{chargeError}</span>
          <button
            onClick={() => setChargeError(null)}
            className="ml-auto text-rose-600 hover:text-rose-900 font-bold"
            aria-label="Cerrar aviso"
          >
            ×
          </button>
        </div>
      )}
      {/* Display Principal */}
      <div className="bg-slate-900 text-white p-3 rounded-2xl flex flex-col justify-center shrink-0 shadow-inner">
        {changeInfo ? (
          <div className="flex flex-col gap-1">
            <div className="flex justify-between items-center text-xs text-slate-400 font-bold uppercase">
              <span>Recibido</span>
              <span className="text-white text-sm">{changeInfo.received.toFixed(2)} €</span>
            </div>
            <div className="flex justify-between items-baseline border-t border-slate-700/80 pt-1 mt-0.5">
              <span className="text-xs font-black text-emerald-400 tracking-wider">A DEVOLVER</span>
              <span className="text-2xl font-black text-emerald-400">{changeInfo.change.toFixed(2)} €</span>
            </div>
            <span className="text-[10px] text-slate-400 text-right mt-0.5">Vaciando mesa en 6s...</span>
          </div>
        ) : (
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Importe Recibido</span>
            <span className="text-2xl font-black">{receivedAmount} €</span>
          </div>
        )}
      </div>

      {/* Teclado Numérico */}
      <div className="grid grid-cols-3 gap-1 my-2 flex-1">
        {['7', '8', '9', '4', '5', '6', '1', '2', '3', 'C', '0', 'DEL'].map(btn => (
          <button
            key={btn}
            type="button"
            onClick={() => handleNumClick(btn)}
            className="h-full min-h-[36px] rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-white font-black text-base shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-95 transition flex items-center justify-center"
          >
            {btn === 'DEL' ? '⌫' : btn}
          </button>
        ))}
      </div>

      {/* Botón único COBRAR — más grande y prominente */}
      <div className="flex flex-col gap-1.5 shrink-0">
        <button
          type="button"
          onClick={handleCobrar}
          className="w-full h-16 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xl rounded-2xl shadow-lg shadow-emerald-600/30 transition active:scale-95 flex items-center justify-center gap-2 tracking-wide"
        >
          COBRAR
        </button>
      </div>
    </div>
  );
}

export default PaymentPanel;
