import React, { useState, useEffect } from 'react';
import { safeLocalGet, safeLocalSet } from '../../lib/safeJson';

export function TablesPanel() {
  const [tablesCount, setTablesCount] = useState<number>(16);

  useEffect(() => {
    const saved = safeLocalGet('pos_tables_total');
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 32) {
        setTablesCount(parsed);
      }
    }
  }, []);

  const updateCount = (val: number) => {
    const next = Math.max(1, Math.min(32, val));
    setTablesCount(next);
    safeLocalSet('pos_tables_total', next.toString());
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Configuración de Mesas</h2>
        <p className="text-xs text-slate-500">Define el número de mesas disponibles en sala</p>
      </div>

      <div className="flex items-center gap-3 bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 max-w-sm">
        <span className="text-sm font-semibold">Total de Mesas:</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => updateCount(tablesCount - 1)}
            className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-700 font-bold"
          >
            -
          </button>
          <span className="text-base font-black px-2">{tablesCount}</span>
          <button
            type="button"
            onClick={() => updateCount(tablesCount + 1)}
            className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-700 font-bold"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
