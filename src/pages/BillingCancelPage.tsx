// =====================================================================
// MOZONA TPV — BillingCancelPage (/billing/cancel)
// =====================================================================
// Pantalla de "pago cancelado" cuando el usuario cierra Stripe Checkout.
// Ofrece volver a la página de precios o al login.
// =====================================================================

import { Link } from "react-router-dom";
import { IconShield, IconArrowRight } from "../components/icons";

export function BillingCancelPage() {
    return (
        <div className="min-h-dvh w-full bg-gradient-to-b from-slate-50 to-white
                        flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200/80
                            shadow-xl p-7 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-amber-100 text-amber-600
                                flex items-center justify-center">
                    <IconShield size={28} strokeWidth={1.8} />
                </div>

                <h1 className="text-[22px] font-black text-slate-900">
                    Pago cancelado
                </h1>
                <p className="mt-2 text-[13px] text-slate-500 leading-relaxed">
                    No te preocupes, no se ha realizado ningún cargo.
                    Puedes volver a la página de precios cuando quieras.
                </p>

                <div className="mt-6 flex flex-col gap-2.5">
                    <Link
                        to="/welcome"
                        className="w-full h-12 inline-flex items-center justify-center gap-2
                                   rounded-2xl bg-blue-600 hover:bg-blue-700 text-white
                                   text-[13.5px] font-black
                                   shadow-md shadow-blue-600/30 active:scale-95 transition"
                    >
                        Volver a Planes
                        <IconArrowRight size={16} strokeWidth={2.4} />
                    </Link>
                    <Link
                        to="/auth"
                        className="w-full h-12 inline-flex items-center justify-center gap-2
                                   rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700
                                   text-[13.5px] font-bold active:scale-95 transition"
                    >
                        Iniciar sesión
                    </Link>
                </div>
            </div>
        </div>
    );
}

export default BillingCancelPage;
