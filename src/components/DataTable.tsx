import { useState } from 'react';
import type { PreparedView } from '../data/types';
import { exportCsv, tableRows } from '../lib/exportCsv';
import { formatNumber, formatPeriod } from '../lib/format';

export function DataTable({ view, id, source }: { view: PreparedView; id: string; source: string }) {
  const [page, setPage] = useState(0);
  const allRows = tableRows(view);
  const ordered = view.categorical ? allRows : [...allRows].reverse();
  const totalPages = Math.max(1, Math.ceil(ordered.length / 12));
  const currentPage = Math.min(page, totalPages - 1);
  const rows = ordered.slice(currentPage * 12, currentPage * 12 + 12);
  return (
    <div className="data-table" id={`table-${id}`}>
      <div className="table-toolbar">
        <strong>Cuadro de datos</strong>
        <button onClick={() => exportCsv(view, id, source)}>Descargar CSV</button>
      </div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={`Tabla: ${view.title}`}>
        <table>
          <caption>
            {view.title} · {view.unit}. {ordered.length} {view.categorical ? 'categorías' : 'períodos'}.
            {!view.categorical && ' Orden: más reciente primero. — = dato no disponible.'}
          </caption>
          <thead>
            <tr>
              <th scope="col">{view.categorical ? 'Categoría' : 'Período'}</th>
              {view.series.map((s) => (
                <th scope="col" key={s.id}>
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, column) =>
                  column === 0 ? (
                    <th scope="row" key={column}>
                      {view.categorical ? String(cell) : formatPeriod(String(cell), view.frequency)}
                    </th>
                  ) : (
                    <td key={column}>{formatNumber(typeof cell === 'number' ? cell : null)}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="pagination">
          <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
            Anterior
          </button>
          <span>
            Página {currentPage + 1} de {totalPages}
          </span>
          <button disabled={currentPage === totalPages - 1} onClick={() => setPage(currentPage + 1)}>
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}
