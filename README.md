# Sector Real | Argentina

Dashboard de indicadores del sector real de la economía argentina. Permite consultar series
históricas, comparar indicadores y descargar gráficos y cuadros para informes.

**[Abrir el dashboard](https://duranemmanu.github.io/sector-real-argentina/)**

## Funciones

- Nueve secciones: actividad y PIB, industria y comercio, construcción, agro, turismo, energía y minería,
  trabajo, estructura productiva y **CRÉDITO PRIVADO**.
- Búsqueda de indicadores y filtros por frecuencia, tipo de vista y período.
- Gráficos ampliables con selección de series, tablas y notas metodológicas.
- Descarga de PNG con fondo blanco y CSV compatibles con Excel: UTF-8 con BOM, punto y coma y
  coma decimal.
- Pronósticos exploratorios en las series con historia suficiente y resultados de validación
  admisibles. Cada pronóstico muestra modelo, muestra, horizonte y error de validación.
- Diseño adaptable a celulares y temas claro y oscuro.
- Fuente, unidad, último período observado y fecha de consulta disponibles en cada indicador.

## Tecnologías

| Tecnología                 | Función                                                                    |
| -------------------------- | -------------------------------------------------------------------------- |
| React y TypeScript         | Interfaz, filtros, ventanas de detalle y transformaciones de las series.   |
| Vite                       | Desarrollo local y compilación de los archivos estáticos.                  |
| CSS                        | Estilos, disposición adaptable y temas claro y oscuro.                     |
| Chart.js y react-chartjs-2 | Gráficos interactivos y exportación de imágenes.                           |
| Python, requests y pandas  | Descarga, normalización, validación y generación de JSON y CSV.            |
| openpyxl y xlrd            | Lectura de las planillas oficiales XLSX y XLS.                             |
| pdfplumber                 | Extracción de cuadros y gráficos de publicaciones PDF.                     |
| Playwright                 | Descarga de CSV públicos de turismo cuando el portal requiere interacción. |
| statsmodels                | Ajuste y validación del pronóstico SARIMA del EMAE.                        |
| GitHub Actions             | Actualización programada, pruebas, compilación y publicación.              |
| GitHub Pages               | Alojamiento del sitio estático.                                            |

El navegador consulta los archivos publicados con el sitio. No hay servidor de aplicación,
registro de usuarios ni servicios de analítica. La preferencia de tema se guarda localmente.
La tipografía Arimo se sirve con el sitio; su licencia está en
[public/fonts/OFL-Arimo.txt](public/fonts/OFL-Arimo.txt).

## Fuentes de los indicadores

Las secciones de **Energía y minería** y **Trabajo** utilizan también las
[series oficiales del IPI minero](https://www.indec.gob.ar/ftp/cuadros/economia/serie_ipi_minero.xlsx)
y los [cuadros de la EPH](https://www.indec.gob.ar/Nivel4/Tema/4/31/58), junto con los CSV
de salarios e IPC que se enumeran a continuación.

La producción física del EPI incluye postres lácteos y flanes (toneladas), aceite de girasol,
harina de trigo y molienda de arroz (miles de toneladas). Cada producto conserva el último mes
publicado en su cuadro; no se adelanta al mes de la portada del informe.

| Fuente                                                                                                                     | Indicadores                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [INDEC: cuentas nacionales](https://www.indec.gob.ar/Nivel4/Tema/3/9/47)                                                   | PIB, consumo, componentes de la demanda, valor agregado y series desestacionalizadas.                                           |
| [INDEC: EMAE](https://www.indec.gob.ar/Nivel4/Tema/3/9/48)                                                                 | Actividad mensual, sectores e incidencias publicadas.                                                                           |
| [INDEC: industria manufacturera](https://www.indec.gob.ar/Nivel4/Tema/3/6/14)                                              | IPI manufacturero, sectores y estimaciones propias de incidencias.                                                              |
| [INDEC: productos industriales](https://www.indec.gob.ar/Institucional/Indec/Publicaciones)                                | Producción física de productos industriales; algunas estadísticas provienen de cámaras sectoriales identificadas en las fichas. |
| [INDEC](https://www.indec.gob.ar/) y [Datos Argentina](https://datos.gob.ar/)                                              | Capacidad instalada, supermercados, mayoristas, construcción, empleo y expectativas del sector.                                 |
| [INDEC: comercio exterior](https://www.indec.gob.ar/indec/web/Nivel3-Tema-3-2)                                             | Complejos exportadores, grandes rubros y origen provincial de las exportaciones.                                                |
| [Banco Mundial: WDI](https://data.worldbank.org/indicator/NY.GDP.MKTP.KD.ZG)                                               | Crecimiento anual del PIB real de Argentina y países seleccionados.                                                             |
| [BCRA: Informe sobre Bancos](https://www.bcra.gob.ar/informe-sobre-bancos/)                                                | Mora de familias y empresas, líneas y sectores, saldos reales, probabilidad de default y solvencia.                             |
| [BCRA: Informe Monetario Mensual](https://www.bcra.gob.ar/informe-monetario-mensual/)                                      | Tasas personales y plazo fijo minorista de personas humanas, en los meses publicados.                                           |
| [BCRA: estadísticas e indicadores](https://www.bcra.gob.ar/estadisticas-indicadores/)                                      | Series mensuales de tasas de préstamos y depósitos en pesos de 30–59 días.                                                      |
| [BCRA: Inclusión Financiera](https://www.bcra.gob.ar/informe-de-inclusion-financiera/)                                     | Personas humanas con crédito y cobertura de la población adulta.                                                                |
| [INDEC: salarios](https://www.indec.gob.ar/Nivel4/Tema/4/31/61) e [IPC](https://www.indec.gob.ar/Nivel4/Tema/3/5/31)       | Salarios reales, comparación entre precios y salarios, inflación y aproximación de tasa real.                                   |
| [SIPA: trabajo registrado](https://www.argentina.gob.ar/trabajo/estadisticas/situacion-y-evolucion-del-trabajo-registrado) | Trabajo registrado total y asalariados privados, series originales y desestacionalizadas; empleo público sin estacionalidad.    |
| [Seguridad Social: RIPTE](https://www.argentina.gob.ar/trabajo/seguridadsocial/ripte)                                      | Remuneración imponible promedio de trabajadores estables, nominal y deflactada por IPC nacional.                                |
| [EcoGo / Universidad Austral](https://www.austral.edu.ar/cienciasempresariales/monitor-economico-financiero/credito-mora/) | Mora por monto, deudores con mora y comparación de Salta con Nación y jurisdicciones.                                           |
| [Fortress](https://fortressconsulting.com.ar/informes/mora-hogares)                                                        | Procesamiento complementario de mora de hogares por tipo de otorgante.                                                          |
| [Grupo Construya](https://www.grupoconstruya.com/servicios/indice_construya)                                               | Índice Construya original y desestacionalizado.                                                                                 |
| [Secretaría de Agricultura](https://datos.magyp.gob.ar/)                                                                   | Estimaciones agrícolas de soja: superficie, producción y rendimiento por provincia.                                             |
| [Secretaría de Turismo: SINTA](https://tableros.yvera.tur.ar/turismo_internacional/)                                       | Turismo receptivo y emisivo.                                                                                                    |
| [INDEC: turismo](https://www.indec.gob.ar/indec/web/Nivel3-Tema-3-13)                                                      | Pernoctaciones en establecimientos hoteleros y parahoteleros.                                                                   |
| [WTTC / Oxford Economics](https://researchhub.wttc.org/)                                                                   | Aporte directo y total del turismo al PIB y comparación internacional.                                                          |
| [Gobierno de Salta](https://www.salta.gob.ar/prensa), [CAME](https://www.redcame.org.ar/) y Télam                          | Balance turístico de las vacaciones de invierno, según el año y la publicación.                                                 |

Las direcciones de descarga, las series y las reglas de lectura están definidas en
[scripts/source_registry.json](scripts/source_registry.json). El catálogo de indicadores y sus
vistas está en [scripts/catalog.json](scripts/catalog.json). Las fichas del sitio incluyen los
enlaces concretos a publicaciones y notas sobre su cobertura.

### Cobertura y actualización

Las fuentes descargables se consultan dos veces al día, a las 09:17 y 20:17 de Argentina.
El horario de ejecución de GitHub Actions puede demorarse. Una consulta exitosa no implica que
el organismo haya publicado un período nuevo.

Si una fuente falla o cambia de estructura, se conserva el último snapshot validado y se indica
su estado. Los respaldos se guardan como artefactos de Actions durante 30 días. La siguiente
ejecución recupera esos datos; si no están disponibles, intenta recuperar el último sitio
publicado y, por último, usa los snapshots incluidos en el código. Las actualizaciones de datos
no generan commits automáticos.

Los porcentajes de WTTC EIR 2026 para Argentina, los balances de invierno de Salta y los cuadros
provinciales de EcoGo/Austral de agosto de 2026 son
compilaciones documentadas en `data/manual/`. Requieren revisar nuevas publicaciones y actualizar
sus CSV y fecha de verificación. Las ejecuciones automáticas no adelantan artificialmente esa
fecha. La comparación internacional de turismo conserva la edición EIR 2025 para mantener
una revisión comparable entre países y regiones.

Los aportes directo y total de WTTC no se suman: el total ya incluye el directo. Los balances de
Salta tienen diferencias de duración y cobertura; las aproximaciones y cotas se señalan en sus
fichas. Las incidencias industriales reconstruidas y la tendencia del consumo privado leída del
gráfico oficial se identifican como elaboración propia o lectura aproximada.

### Crédito privado

La sección reúne 31 gráficos sobre mora, crédito, tasas, acceso al financiamiento, empleo,
salarios, precios y actividad. Los detalles de Salta incluyen cuadros de las 24 jurisdicciones
y el total nacional. Cada gráfico permite consultar datos, notas y fuentes y exportar PNG o CSV.

Las publicaciones de bancos, indicadores monetarios e inclusión se localizan mediante el índice
público de publicaciones del BCRA. Las tasas, salarios, IPC, SIPA y Fortress se descargan desde
sus archivos públicos. Las ventanas móviles conservan la historia validada; una observación
revisada reemplaza su valor anterior. Los meses no publicados del cuadro de tasas minoristas
quedan nulos en la base; los gráficos comparan sólo los meses informados, con igual separación
entre barras. Las transcripciones provinciales de EcoGo/Austral conservan su fecha de verificación
y requieren revisar un nuevo dossier para actualizarse.

La mora bancaria, la mora por monto de EcoGo/Austral, los deudores con alguna deuda irregular y
el procesamiento de Fortress tienen universos y denominadores propios. Se consultan por separado.
El plazo fijo minorista de 30–35 días tampoco se empalma con la serie de 30–59 días para el total
de depositantes. La TNA y su diferencia no representan CFT ni beneficio neto bancario.

El saldo real irregular se encadena desde diciembre de 2024=100, sin saltar faltantes. Los
salarios se deflactan con IPC nacional y se rebasan a noviembre de 2023=100. La comparación
de salarios con precios usa el último mes común. La tasa real mensual aproximada es
`100 × [(1 + TNA / 1200) / (IPC(t) / IPC(t−1)) − 1]`: referencia ex post sin cargos.
Los acumulados de actividad y supermercados comparan exactamente los mismos meses del año.

El ejemplo presupuestario del informe no es una medición argentina y no se incorpora como serie
observada. Tampoco se estima un DSR o DSCR nacional con datos agregados. Los indicadores de
esta sección no ofrecen pronósticos automáticos.

### Energía y minería

La sección reúne cuatro gráficos: IPI minero general (original, desestacionalizado y
tendencia-ciclo), variación interanual por categoría, extracción de petróleo crudo convencional
y no convencional y producción de carbonato de litio. Se descargan automáticamente las series
históricas del INDEC. Cada indicador conserva su tabla de datos, notas, selección de períodos
y exportaciones PNG/CSV.

La extracción no convencional no se identifica exclusivamente con Vaca Muerta. Los datos
confidenciales, faltantes y que no corresponde presentar se mantienen nulos; el cero absoluto
se distingue de esos estados. La producción física pública de carbonato de litio comienza en
junio de 2023. Su unidad es toneladas y se distingue del índice agregado de minerales de litio.

### Trabajo

Trabajo reúne 25 gráficos de tasas laborales, niveles de población y empleo, informalidad,
subocupación, categorías ocupacionales, trabajo registrado, salarios nominales y reales, RIPTE
e IPC. La EPH cubre 31 aglomerados urbanos. Las tasas principales se leen del cuadro 1.1;
la informalidad, del cuadro 1.3; las categorías ocupacionales, del cuadro 1.5.
La población ocupada menos la ocupada informal puede incluir personas sin dato de formalidad;
por eso se rotula «resto de ocupados». Las tasas oficiales mantienen sus denominadores:
población, PEA u ocupados, según el indicador. Los cambios de población son variaciones netas,
no flujos brutos de altas y bajas.

Los índices reales de Trabajo usan diciembre de 2023=100 y se calculan con niveles exactos de
salarios, RIPTE e IPC, sin encadenar tasas redondeadas. Los índices de Crédito privado conservan
su base de noviembre de 2023. RIPTE cubre asalariados públicos y privados declarados de forma
continua durante 13 meses; no equivale al salario de todos los ocupados ni al índice salarial
del INDEC. Se utiliza el monto nominal publicado, distinto del índice no decreciente de riesgos
del trabajo. El total SIPA incluye también casas particulares, autónomos y monotributistas.

Las comparaciones de salarios reales se calculan dividiendo cada índice salarial por el IPC
nacional antes de calcular la variación. Se usan niveles exactos del archivo publicado, no
tasas mensuales redondeadas. El acumulado del año toma diciembre previo como base. Los
períodos de salarios y precios se alinean antes de calcular el poder adquisitivo. Las pequeñas
diferencias con cuadros redondeados se deben a la precisión de los insumos oficiales.

Las dos secciones se actualizan con el proceso programado. Los archivos facilitados sirven de
contraste del alcance; no se publican las planillas de trabajo, imágenes ni documentos locales.

### Pronósticos

Los modelos dependen del tipo de serie: tasas, niveles, proporciones y datos desestacionalizados.
Se comparan regresiones temporales, AR(1) y suavizado con tendencia amortiguada frente a
referencias simples, con tres bloques temporales de validación del horizonte elegido. Sólo se
ofrecen combinaciones que mejoran al menos un 5% el error absoluto medio de la mejor referencia,
ganan en dos de los tres bloques y no producen una trayectoria prácticamente plana. La ventana
de entrenamiento se selecciona usando la historia disponible, independientemente del zoom.

El EMAE tiene un procedimiento específico: selección entre modelos SARIMA y una referencia
estacional ingenua sobre una reserva de doce meses, seguida del ajuste con toda la historia.
Se recalcula al cambiar o revisarse el histórico oficial. Sus intervalos del 95% son
condicionales al modelo; los demás modelos no muestran bandas inventadas. Las pestañas de
pronóstico se omiten cuando no hay un resultado admisible o el corte quedó desactualizado.

Son estimaciones exploratorias del proyecto, no proyecciones oficiales. La selección y su error
de validación no garantizan la precisión futura.

## Desarrollo local

Requiere Node.js 24. Los snapshots incluidos permiten abrir el sitio sin ejecutar las descargas:

```sh
npm ci
npm run dev
```

Para compilar y revisar la versión estática:

```sh
npm test
npm run build
npm run preview
```

La base de publicación es `/sector-real-argentina/`, configurada en `vite.config.ts`.

Para actualizar datos se requiere Python 3.12 y las dependencias indicadas:

```sh
python -m pip install -r scripts/requirements.txt
python -m playwright install --with-deps --only-shell chromium
python -m unittest discover -s scripts -p 'test_*.py'
python scripts/update_all.py
python scripts/check_data.py
```

En Windows, el descargador de turismo utiliza Chrome instalado. Las fuentes usadas por el
pipeline son públicas y no requieren claves de API. `python scripts/update_all.py --offline`
permite comprobar la recuperación ante una caída de las fuentes.

## Archivos principales

- `src/`: interfaz, gráficos, tablas, filtros, pronósticos del navegador y pruebas.
- `scripts/`: descarga, parsers, validaciones, pronóstico EMAE y pruebas de datos.
- `public/data/`: JSON y CSV servidos por el sitio, con metadatos de consulta y cobertura.
- `data/cache/`: respaldos verificados para recuperarse de errores de las fuentes.
- `data/manual/`: series compiladas que requieren revisión de sus publicaciones.
- `.github/workflows/deploy.yml`: actualización, verificaciones y despliegue de Pages.

La publicación se ejecuta al actualizar `main`, en el horario programado o manualmente desde
Actions. Requiere habilitar GitHub Pages con origen **GitHub Actions**. El workflow valida los
datos, corre las pruebas y compila antes de desplegar; mientras el repositorio sea privado, el
paso de despliegue se omite.
