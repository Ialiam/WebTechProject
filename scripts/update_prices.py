"""Collect daily average pump prices for Canadian cities and save them to
data/prices.json, which the website reads.

Source: Natural Resources Canada, "Daily Average Retail Prices" by city
(https://www2.nrcan.gc.ca/eneene/sources/pripri/prices_bycity_e.cfm).
Prices there are in cents per litre and include taxes.

Run by .github/workflows/update-prices.yml every day. Uses only the Python
standard library.
"""
import datetime
import json
import sys
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

URL = "https://www2.nrcan.gc.ca/eneene/sources/pripri/prices_bycity_e.cfm"
SOURCE = "Natural Resources Canada"
OUT = Path(__file__).resolve().parent.parent / "data" / "prices.json"
MAX_AGE_DAYS = 14  # ignore a city whose latest price is older than this

# NRCan product IDs, checked against the page title on each page.
PRODUCTS = {1: "regular", 2: "midgrade", 3: "premium", 5: "diesel"}
TITLE_WORDS = {"regular": "regular", "midgrade": "mid-grade", "premium": "premium", "diesel": "diesel"}

NATIONAL_ID = 66
# NRCan location ID: (name as NRCan lists it, province, latitude, longitude).
# "Grand Falls" and "Woodstock" are left out: each name exists in two provinces.
CITIES = {
    90: ("Abbotsford", "BC", 49.0504, -122.3045), 91: ("Barrie", "ON", 44.3894, -79.6903),
    36: ("Bathurst", "NB", 47.6186, -65.6509), 16: ("Brandon", "MB", 49.8485, -99.9501),
    92: ("Brantford", "ON", 43.1394, -80.2644), 8: ("Calgary", "AB", 51.0447, -114.0719),
    82: ("Campbellton", "NB", 48.0055, -66.6727), 43: ("Charlottetown", "PE", 46.2382, -63.1311),
    32: ("Chicoutimi", "QC", 48.4280, -71.0680), 46: ("Corner Brook", "NL", 48.9500, -57.9522),
    69: ("Drummondville", "QC", 45.8838, -72.4843), 10: ("Edmonton", "AB", 53.5461, -113.4938),
    37: ("Edmundston", "NB", 47.3737, -68.3251), 70: ("Fort St. John", "BC", 56.2524, -120.8466),
    34: ("Fredericton", "NB", 45.9636, -66.6431), 45: ("Gander", "NL", 48.9569, -54.6089),
    31: ("Gaspé", "QC", 48.8316, -64.4869), 98: ("Gatineau", "QC", 45.4765, -75.7013),
    100: ("Grande Prairie", "AB", 55.1707, -118.7947), 93: ("Guelph", "ON", 43.5448, -80.2482),
    39: ("Halifax", "NS", 44.6488, -63.5752), 26: ("Hamilton", "ON", 43.2557, -79.8711),
    5: ("Kamloops", "BC", 50.6745, -120.3273), 6: ("Kelowna", "BC", 49.8880, -119.4960),
    71: ("Kentville", "NS", 45.0771, -64.4958), 72: ("Kingston", "ON", 44.2312, -76.4860),
    94: ("Kitchener", "ON", 43.4516, -80.4925), 73: ("Labrador City", "NL", 52.9463, -66.9114),
    11: ("Lethbridge", "AB", 49.6956, -112.8451), 74: ("Lloydminster", "AB", 53.2783, -110.0053),
    20: ("London", "ON", 42.9849, -81.2453), 38: ("Miramichi", "NB", 47.0296, -65.5019),
    35: ("Moncton", "NB", 46.0878, -64.7782), 28: ("Montreal", "QC", 45.5019, -73.5674),
    97: ("Moose Jaw", "SK", 50.3934, -105.5519), 75: ("New Glasgow", "NS", 45.5869, -62.6453),
    24: ("North Bay", "ON", 46.3091, -79.4608), 95: ("Oshawa", "ON", 43.8971, -78.8658),
    18: ("Ottawa", "ON", 45.4215, -75.6972), 76: ("Peterborough", "ON", 44.3091, -78.3197),
    14: ("Prince Albert", "SK", 53.2033, -105.7531), 4: ("Prince George", "BC", 53.9171, -122.7497),
    29: ("Quebec", "QC", 46.8139, -71.2080), 9: ("Red Deer", "AB", 52.2681, -113.8112),
    12: ("Regina", "SK", 50.4452, -104.6189), 77: ("Rimouski", "QC", 48.4490, -68.5230),
    33: ("Saint John", "NB", 45.2733, -66.0633), 58: ("Sarnia", "ON", 42.9745, -82.4066),
    13: ("Saskatoon", "SK", 52.1332, -106.6700), 22: ("Sault Ste Marie", "ON", 46.5219, -84.3461),
    30: ("Sherbrooke", "QC", 45.4042, -71.8929), 27: ("St. Catharines", "ON", 43.1594, -79.2469),
    44: ("St. John's", "NL", 47.5615, -52.7126), 21: ("Sudbury", "ON", 46.4917, -80.9930),
    78: ("Sussex", "NB", 45.7226, -65.5105), 40: ("Sydney", "NS", 46.1368, -60.1942),
    23: ("Thunder Bay", "ON", 48.3809, -89.2477), 25: ("Timmins", "ON", 48.4758, -81.3305),
    17: ("Toronto", "ON", 43.6532, -79.3832), 79: ("Trois-Rivières", "QC", 46.3432, -72.5421),
    42: ("Truro", "NS", 45.3650, -63.2861), 80: ("Val d'Or", "QC", 48.0975, -77.7828),
    2: ("Vancouver", "BC", 49.2827, -123.1207), 3: ("Victoria", "BC", 48.4284, -123.3656),
    1: ("Whitehorse", "YT", 60.7212, -135.0568), 19: ("Windsor", "ON", 42.3149, -83.0364),
    15: ("Winnipeg", "MB", 49.8951, -97.1384), 41: ("Yarmouth", "NS", 43.8375, -66.1174),
    7: ("Yellowknife", "NT", 62.4540, -114.3718),
}


class TableParser(HTMLParser):
    """Collects the page title (h1) and the rows of every table."""

    def __init__(self):
        super().__init__()
        self.title = ""
        self.rows = []
        self._in_h1 = self._in_cell = False
        self._table_depth = 0
        self._row = None
        self._cell = []

    def handle_starttag(self, tag, attrs):
        if tag == "h1":
            self._in_h1 = True
        elif tag == "table":
            self._table_depth += 1
        elif tag == "tr" and self._table_depth:
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._in_cell, self._cell = True, []

    def handle_endtag(self, tag):
        if tag == "h1":
            self._in_h1 = False
        elif tag == "table" and self._table_depth:
            self._table_depth -= 1
        elif tag in ("td", "th") and self._in_cell:
            self._row.append(" ".join("".join(self._cell).split()))
            self._in_cell = False
        elif tag == "tr" and self._row is not None:
            if self._row:
                self.rows.append(self._row)
            self._row = None

    def handle_data(self, data):
        if self._in_h1:
            self.title += data
        if self._in_cell:
            self._cell.append(data)


def fetch(product_id, year):
    ids = ",".join(str(i) for i in [NATIONAL_ID, *CITIES])
    url = f"{URL}?productID={product_id}&locationID={ids}&frequency=D&priceYear={year}&Redisplay="
    req = urllib.request.Request(url, headers={"User-Agent": "TripFuelCost price updater (GitHub Actions)"})
    with urllib.request.urlopen(req, timeout=60) as res:
        return res.read().decode("utf-8", "replace")


def is_date(text):
    try:
        datetime.date.fromisoformat(text)
        return True
    except ValueError:
        return False


def latest_prices(html, fuel):
    """Returns {location name: (date, dollars per litre)} with each location's latest price."""
    page = TableParser()
    page.feed(html)
    if TITLE_WORDS[fuel] not in page.title.lower():
        raise ValueError(f"expected a {fuel} table, page title is {page.title.strip()!r}")

    names = {name.lower(): name for name, *_ in CITIES.values()}
    names["canada"] = "Canada"
    header = next((r for r in page.rows if sum(c.lower() in names for c in r) >= 2), None)
    if not header:
        raise ValueError("no header row with city names")
    locations = [names[c.lower()] for c in header if c.lower() in names]

    latest = {}
    for row in page.rows:
        if not row or not is_date(row[0]):
            continue
        values = row[1:]
        width = len(values) // len(locations)  # Price, Taxes, Marketing Margin, Refining Margin
        if width < 1:
            continue
        for i, name in enumerate(locations):
            try:
                cents = float(values[i * width])
            except (ValueError, IndexError):
                continue
            if cents > 0 and (name not in latest or row[0] > latest[name][0]):
                latest[name] = (row[0], round(cents / 100, 3))
    return latest


def main():
    today = datetime.date.today()
    oldest = (today - datetime.timedelta(days=MAX_AGE_DAYS)).isoformat()
    by_fuel = {}
    for product_id, fuel in PRODUCTS.items():
        found = {}
        # Early in January the current year may have no data yet; then use last year's.
        for year in (today.year, today.year - 1):
            for name, (date, price) in latest_prices(fetch(product_id, year), fuel).items():
                if name not in found or date > found[name][0]:
                    found[name] = (date, price)
            if found:
                break
        by_fuel[fuel] = {name: v for name, v in found.items() if v[0] >= oldest}
        print(f"{fuel}: {len(by_fuel[fuel])} locations")

    def entry(name, extra):
        prices = {f: by_fuel[f][name][1] for f in PRODUCTS.values() if name in by_fuel[f]}
        if "regular" not in prices:
            return None
        return {"name": name, **extra, "date": by_fuel["regular"][name][0], "prices": prices}

    cities = []
    for name, province, lat, lon in CITIES.values():
        item = entry(name, {"region": province, "lat": lat, "lon": lon})
        if item:
            cities.append(item)
    national = entry("Canada", {})

    # Sanity checks: keep the previous file rather than publishing a broken one.
    if not national or len(cities) < 30:
        sys.exit(f"Only {len(cities)} cities parsed (national: {bool(national)}); not updating.")
    for c in cities + [national]:
        if not all(0.5 < p < 4 for p in c["prices"].values()):
            sys.exit(f"Implausible price for {c['name']}: {c['prices']}")

    data = {
        "updated": today.isoformat(),
        "countries": {
            "CA": {
                "currency": "CAD",
                "unit": "L",
                "source": SOURCE,
                "sourceUrl": URL,
                "national": national,
                "cities": sorted(cities, key=lambda c: c["name"]),
            }
        },
    }
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    sudbury = next((c for c in cities if c["name"] == "Sudbury"), None)
    print(f"Saved {len(cities)} cities. Canada: {national['prices']}  Sudbury: {sudbury and sudbury['prices']}")


if __name__ == "__main__":
    main()
