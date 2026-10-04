#!/bin/bash
set -e

echo "=== Actualizando PaymentPanel.tsx con soporte completo de props ==="
cat << 'PAY_EOF' > src/components/pos/PaymentPanel.tsx
import React, { useState, useEffect, useRef } from 'react';

export interface PaymentPanelProps {
  total?: number;
  paymentAmount?: string | number;
  onPay?: (method: 'cash' | 'card', received?: number, change?: number) => void;
  onEmitInvoice?: () => void;
  lastPaymentResult?: { received: number; change: number } | null;
  [key: string]: any;
}

export function PaymentPanel(props: PaymentPanelProps) {
  const { total = 0, onPay, onEmitInvoice, lastPaymentResult } = props;
  const [receivedAmount, setReceivedAmount] = useState<string>(
    props.paymentAmount ? String(props.paymentAmount) : '0'
  );
  const [changeInfo, setChangeInfo] = useState<{ received: number; change: number } | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (props.paymentAmount !== undefined) {
      setReceivedAmount(String(props.paymentAmount));
    }
  }, [props.paymentAmount]);

  useEffect(() => {
    if (lastPaymentResult) {
      showChange(lastPaymentResult.received, lastPaymentResult.change);
    }
  }, [lastPaymentResult]);

  const showChange = (received: number, change: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setChangeInfo({ received, change });

    // Mantener quieto en pantalla durante 6 segundos exactos
    timerRef.current = setTimeout(() => {
      setChangeInfo(null);
      setReceivedAmount('0');
    }, 6000);
  };

  const handleNumClick = (val: string) => {
    if (changeInfo) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setChangeInfo(null);
    }

    if (val === 'C') {
      setReceivedAmount('0');
      if (props.onPaymentAmountChange) props.onPaymentAmountChange('0');
    } else if (val === 'DEL') {
      setReceivedAmount(prev => {
        const next = prev.length > 1 ? prev.slice(0, -1) : '0';
        if (props.onPaymentAmountChange) props.onPaymentAmountChange(next);
        return next;
      });
    } else {
      setReceivedAmount(prev => {
        const next = prev === '0' ? val : prev + val;
        if (props.onPaymentAmountChange) props.onPaymentAmountChange(next);
        return next;
      });
    }
  };

  const handleCashPay = () => {
    const recNum = parseFloat(receivedAmount) || total;
    const finalTotal = Number(total) || 0;
    const calculatedChange = Math.max(0, recNum - finalTotal);

    showChange(recNum, calculatedChange);

    if (onPay) {
      onPay('cash', recNum, calculatedChange);
    }
  };

  const handleCardPay = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setChangeInfo(null);
    setReceivedAmount('0');
    if (onPay) {
      onPay('card', total, 0);
    }
  };

  return (
    <div className="h-full flex flex-col justify-between p-2 min-h-0 select-none">
      {/* Display Principal / Banner de Cambio (Fijo 6s) */}
      <div className="bg-slate-900 text-white p-3 rounded-2xl flex flex-col justify-center shrink-0 shadow-inner transition-all">
        {changeInfo ? (
          <div className="flex flex-col gap-1 animate-fadeIn">
            <div className="flex justify-between items-center text-xs text-slate-400 font-bold uppercase tracking-wider">
              <span>Importe Recibido</span>
              <span className="text-white text-sm">{changeInfo.received.toFixed(2)} €</span>
            </div>
            <div className="flex justify-between items-baseline border-t border-slate-700/80 pt-1 mt-0.5">
              <span className="text-xs font-black text-emerald-400 tracking-wider">A DEVOLVER</span>
              <span className="text-2xl font-black text-emerald-400">{changeInfo.change.toFixed(2)} €</span>
            </div>
            <span className="text-[10px] text-slate-500 text-right mt-0.5">Cierre automático en 6s...</span>
          </div>
        ) : (
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Importe Recibido</span>
            <span className="text-2xl font-black">{receivedAmount} €</span>
          </div>
        )}
      </div>

      {/* Teclado Numérico */}
      <div className="grid grid-cols-3 gap-1 my-1.5 flex-1">
        {['7', '8', '9', '4', '5', '6', '1', '2', '3', 'C', '0', 'DEL'].map(btn => (
          <button
            key={btn}
            type="button"
            onClick={() => handleNumClick(btn)}
            className="h-full min-h-[34px] rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-white font-black text-sm shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-95 transition flex items-center justify-center"
          >
            {btn === 'DEL' ? '⌫' : btn}
          </button>
        ))}
      </div>

      {/* Botones de Cobro */}
      <div className="flex flex-col gap-1.5 shrink-0">
        <button
          type="button"
          onClick={handleCashPay}
          className="w-full h-9 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm transition active:scale-95 flex items-center justify-center gap-1"
        >
          💵 EFECTIVO
        </button>
        <button
          type="button"
          onClick={handleCardPay}
          className="w-full h-9 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-sm transition active:scale-95 flex items-center justify-center gap-1"
        >
          💳 TARJETA / DATÁFONO
        </button>
        <button
          type="button"
          onClick={() => onEmitInvoice?.()}
          className="w-full h-7 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 text-slate-700 dark:text-slate-200 font-bold text-[10px] rounded-lg transition active:scale-95 flex items-center justify-center"
        >
          EMITIR FACTURA (VERIFACTU + QR)
        </button>
      </div>
    </div>
  );
}

export default PaymentPanel;
PAY_EOF

echo "=== Compilando y desplegando a GitHub / Vercel ==="
npm run build
git add src/components/pos/PaymentPanel.tsx
git commit -m "fix(payment): soportar paymentAmount y props de PosTerminalPro"
git push origin main

echo "✅ ¡Build exitoso y desplegado!"
