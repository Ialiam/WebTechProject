# Temporary: inspect NRCan's fuel price pages to learn their structure.
import re, urllib.request, datetime

UA = {"User-Agent": "Mozilla/5.0 (TripFuelCost price updater)"}
BASE = "https://www2.nrcan.gc.ca/eneene/sources/pripri/"

def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        print(f"== {url} -> {r.status} {r.headers.get('content-type')}")
        return r.read()

year = datetime.date.today().year
html = get(BASE + "prices_bycity_e.cfm").decode("utf-8", "replace")
# Location and product inputs (checkboxes / radios / selects)
for m in re.finditer(r'<input[^>]*name="?(locationID|productID)"?[^>]*>', html, re.I):
    tag = m.group(0)
    val = re.search(r'value="?([^"\s>]+)', tag)
    iid = re.search(r'id="?([^"\s>]+)', tag)
    label = ""
    if iid:
        lm = re.search(r'<label[^>]*for="%s"[^>]*>(.*?)</label>' % re.escape(iid.group(1)), html, re.S | re.I)
        if lm: label = re.sub(r"<[^>]+>|\s+", " ", lm.group(1)).strip()
    if not label:
        after = html[m.end():m.end() + 200]
        label = re.sub(r"<[^>]+>|\s+", " ", after).strip()[:60]
    print("INPUT", m.group(1), val and val.group(1), "|", label)
for sel in re.findall(r"<select[^>]*>.*?</select>", html, re.S | re.I):
    if re.search(r"location|product", sel[:200], re.I):
        print("SELECT", re.findall(r'<option[^>]*value="?([^">]*)"?[^>]*>([^<]*)', sel, re.I))
i = html.find("locationID")
print("CONTEXT", re.sub(r"\s+", " ", html[i - 300:i + 1500]))

feed = get(BASE + f"webfeed_e.cfm?priceYear={year}&productID=1&locationID=66,8,39,17")
print("FEED", feed[:1500].decode("utf-8", "replace"))
xls = get(BASE + f"prices_bycity_e.cfm?productID=1&locationID=66&frequency=D&priceYear={year}&Redisplay=&downloadXLS")
print("XLS", xls[:600])
