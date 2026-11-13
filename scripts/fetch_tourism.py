"""Descarga los CSV públicos del tablero oficial cuando el catálogo/API no responde."""

import json
import sys
from urllib.parse import urljoin

import requests


def download_tourism(source):
    from playwright.sync_api import Error, sync_playwright

    try:
        with sync_playwright() as driver:
            browser = driver.chromium.launch(
                headless=True,
                **({"channel": "chrome"} if sys.platform == "win32" else {}),
            )
            try:
                page = browser.new_page(accept_downloads=True)
                page.set_default_timeout(45000)
                page.goto(source["sourceUrl"])
                result = {}
                for tab, download_id, year_id, month_id, key in [
                    ("RECEPTIVO", "downloadCSVRec", "anio", "mes", "inbound"),
                    ("EMISIVO", "downloadCSVEmi", "anio_e", "mes_e", "outbound"),
                ]:
                    page.get_by_role("link", name=tab, exact=True).click()
                    for control in [year_id, month_id]:
                        selected = page.locator(f"#{control}").evaluate(
                            "node => Array.from(node.selectedOptions).map(option => option.value)"
                        )
                        if "Todos" not in selected:
                            page.locator(f"#{control}-selectized").fill("Todos")
                            page.locator(
                                '.selectize-dropdown:visible .option[data-value="Todos"]'
                            ).click()
                    page.get_by_role(
                        "checkbox", name="Excursionistas", exact=True
                    ).uncheck()
                    page.get_by_text(
                        "VIAJES DE TURISTAS NO RESIDENTES"
                        if key == "inbound"
                        else "VIAJES AL EXTERIOR DE TURISTAS RESIDENTES",
                        exact=False,
                    ).filter(visible=True).first.wait_for()
                    page.wait_for_function(
                        "id => document.getElementById(id)?.value === 'Todos'",
                        arg="paso_publ" if key == "inbound" else "paso_publ_e",
                    )
                    page.locator(
                        "#btnSearchReceptivo"
                        if key == "inbound"
                        else "#btnSearchEmisivo"
                    ).click()
                    page.locator(
                        ".tab-pane.active table.dataTable tbody tr"
                    ).first.wait_for()
                    page.wait_for_function(
                        "id => !!document.getElementById(id)?.getAttribute('href')",
                        arg=download_id,
                    )
                    href = page.locator(f"#{download_id}").get_attribute("href")
                    response = page.request.get(urljoin(page.url, href))
                    if not response.ok:
                        raise requests.RequestException(
                            f"Descarga CSV SINTA ({key}): HTTP {response.status}"
                        )
                    result[key] = response.body().decode("utf-8-sig")
                return json.dumps(result, ensure_ascii=False).encode("utf-8"), source[
                    "sourceUrl"
                ]
            finally:
                browser.close()
    except Error as error:
        raise requests.RequestException(
            "No se pudo descargar el CSV público del tablero SINTA"
        ) from error
