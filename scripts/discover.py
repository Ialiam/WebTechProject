# Temporary: inspect NRCan's fuel price pages to learn their structure.
import re, urllib.request, datetime

UA = {"User-Agent": "Mozilla/5.0 (TripFuelCost price updater)"}

def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        print(f"== {url} -> {r.status} {r.headers.get('content-type')}")
        return r.read().decode("utf-8", "replace")

year = datetime.date.today().year
urls = [
    "https://www2.nrcan.gc.ca/eneene/sources/pripri/prices_bycity_e.cfm",
    f"https://www2.nrcan.gc.ca/eneene/sources/pripri/prices_bycity_e.cfm?productID=1&locationID=66&frequency=D&priceYear={year}&Redisplay=",
]
for u in urls:
    try:
        html = get(u)
    except Exception as e:
        print("ERR", u, e)
        continue
    print("length", len(html))
    for sel in re.findall(r"<select[^>]*>.*?</select>", html, re.S | re.I):
        name = re.search(r'name="?([^"\s>]+)', sel)
        opts = re.findall(r'<option[^>]*value="?([^">]*)"?[^>]*>([^<]*)', sel, re.I)
        print("SELECT", name and name.group(1), len(opts), opts[:120])
    for form in re.findall(r"<form[^>]*>", html, re.I):
        print("FORM", form)
    for a in sorted(set(re.findall(r'href="([^"]+)"', html))):
        if re.search(r"csv|xls|download|price", a, re.I):
            print("LINK", a)
    tables = re.findall(r"<table.*?</table>", html, re.S | re.I)
    print("TABLES", len(tables))
    for t in tables[:3]:
        text = re.sub(r"<[^>]+>", " ", t)
        text = re.sub(r"\s+", " ", text)
        print("TABLE", text[:1500])
