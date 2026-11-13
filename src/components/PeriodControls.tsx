import type { ViewWindow } from '../lib/viewFilters';

export function PeriodControls({
  value,
  onChange,
}: {
  value: ViewWindow;
  onChange: (value: ViewWindow) => void;
}) {
  return (
    <>
      <label>
        Período
        <select
          value={value.preset}
          onChange={(event) => onChange({ ...value, preset: event.target.value })}
        >
          <option value="catalog">Período del indicador</option>
          <option value="3">Últimos 3 años</option>
          <option value="5">Últimos 5 años</option>
          <option value="10">Últimos 10 años</option>
          <option value="full">Toda la historia</option>
          <option value="custom">Personalizado</option>
        </select>
      </label>
      {value.preset === 'custom' && (
        <div className="year-range">
          <label>
            Desde
            <input
              aria-label="Desde el año"
              type="number"
              min="1900"
              max="2100"
              placeholder="Inicio"
              value={value.from}
              onChange={(event) => onChange({ ...value, from: event.target.value })}
            />
          </label>
          <span aria-hidden="true">—</span>
          <label>
            Hasta
            <input
              aria-label="Hasta el año"
              type="number"
              min="1900"
              max="2100"
              placeholder="Último"
              value={value.to}
              onChange={(event) => onChange({ ...value, to: event.target.value })}
            />
          </label>
        </div>
      )}
      {value.preset === 'custom' && value.from && value.to && Number(value.from) > Number(value.to) && (
        <span className="warning" role="alert">
          El año inicial debe ser menor o igual al final.
        </span>
      )}
    </>
  );
}
