"""Generates the "<From> to <To> gas cost" route pages for tripfuelcost.ca.

Each page shows the estimated gas cost by vehicle type, today's price in the
starting city (from data/prices.json), live prices for cities along the route
with the cheapest one named, fill-up, toll and winter advice, FAQs with
FAQPage structured data, and a button that opens the calculator with the
route filled in. The Google tag is included.

Usage (from the repository root):
    python3 scripts/make_route_pages.py                 # all routes below
    python3 scripts/make_route_pages.py toronto-to-ottawa-gas-cost

To add a route:
  1. Add an entry to ROUTES at the bottom of this file. "price_city" and
     "stops" must be city names exactly as they appear in data/prices.json
     (see CITIES in scripts/update_prices.py).
  2. Run the script.
  3. Link the new page from the "Popular trips" list in index.html and from
     the "Other trips" lists of related route pages (update "others" here
     and regenerate), and add it to sitemap.xml.

toronto-to-montreal-gas-cost.html was written by hand and is not generated
here, so running this script never overwrites it.
"""
import html
import json
import sys
from pathlib import Path
from urllib.parse import quote

OUT = Path(__file__).resolve().parent.parent
FALLBACK_PRICE = 1.90
VEHICLES = [("Hybrid car", 5.0), ("Compact car", 7.0), ("Mid-size sedan", 8.0),
            ("Mid-size SUV", 9.0), ("Minivan", 10.5), ("Pickup truck", 12.5)]

CSS = """  :root{--sign:#0E5A3A;--asphalt:#26292C;--line:#F2C230;--paper:#F7F8F5;--muted:#5E6468;--rule:#DADDD8}
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--asphalt);font-family:"Overpass",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:17px;line-height:1.6}
  main{max-width:720px;margin:0 auto;padding:28px 20px 48px}
  a{color:var(--sign)}
  a:focus-visible,input:focus-visible{outline:3px solid var(--line);outline-offset:2px}
  h1{font-size:clamp(1.8rem,5vw,2.5rem);line-height:1.12;letter-spacing:-.02em;margin:0 0 14px}
  h2{font-size:1.45rem;line-height:1.25;margin:40px 0 10px;letter-spacing:-.01em}
  .route{background:var(--sign);color:#fff;border:4px solid #fff;box-shadow:0 0 0 3px var(--sign);border-radius:14px;padding:18px 22px;margin:0 0 22px}
  .route .road{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-weight:800;font-size:1.3rem}
  .route .road span:last-child{font-size:1.9rem;color:var(--line)}
  .route p{margin:6px 0 0;opacity:.92}
  .answer{background:#fff;border-left:5px solid var(--line);padding:14px 16px;border-radius:0 8px 8px 0}
  .price{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0 14px;font-weight:700}
  .price input{font:inherit;font-size:1.05rem;width:110px;padding:9px 10px;border:2px solid var(--rule);border-radius:8px}
  .table-scroll{overflow-x:auto}
  table{border-collapse:collapse;width:100%;background:#fff;min-width:460px}
  th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--rule)}
  th{background:var(--asphalt);color:#fff;font-weight:700}
  td.num,th.num{text-align:right}
  .small{color:var(--muted);font-size:.9rem}
  .cta{display:inline-block;background:var(--sign);color:#fff;text-decoration:none;font-weight:800;padding:12px 18px;border-radius:8px;margin-top:6px}
  details{border-bottom:1px solid var(--rule);padding:12px 0}
  summary{font-weight:700;cursor:pointer}
  details p{margin:8px 0 0}
  .site-bar{background:#fff;border-bottom:1px solid var(--rule)}
  .site-bar div{max-width:720px;margin:0 auto;padding:12px 20px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
  .brand{font-weight:800;font-size:1.15rem;text-decoration:none;color:var(--asphalt)}
  .brand span{color:var(--sign)}
  .site-bar nav a{font-weight:600;text-decoration:none}
  .site-foot{border-top:1px solid var(--rule);color:var(--muted);font-size:.85rem;text-align:center;padding:20px}
  .site-foot p{margin:4px 0}"""

SCRIPT = """<script>
  // Estimated costs follow the gas price; today's price comes from data/prices.json
  // (daily city averages from Natural Resources Canada).
  (function(){
    const KM = %(km)d;
    const PRICE_CITY = %(price_city)s;
    const STOPS = %(stops)s;
    const vehicles = %(vehicles)s;
    const input = document.getElementById('gas-price');
    const rows = document.getElementById('cost-rows');
    const money = n => n.toLocaleString('en-CA',{style:'currency',currency:'CAD'});
    const whole = n => Math.round(n).toLocaleString('en-CA');
    const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    function render(){
      const price = parseFloat(input.value);
      const ok = price > 0;
      rows.innerHTML = vehicles.map(([name,l100]) => {
        const litres = KM * l100 / 100;
        return `<tr><td>${name}</td><td class="num">${l100.toFixed(1)} L/100 km</td>
          <td class="num">${litres.toFixed(0)} L</td>
          <td class="num">${ok ? money(litres*price) : '–'}</td>
          <td class="num">${ok ? money(litres*price*2) : '–'}</td></tr>`;
      }).join('');
      if (!ok) return;
      setText('qa-price', price.toFixed(2));
      setText('qa-car', whole(KM * 7.0 / 100 * price));
      setText('qa-suv', whole(KM * 9.0 / 100 * price));
      setText('split-price', price.toFixed(2));
      setText('split-rt', whole(KM * 2 * 7.0 / 100 * price));
      setText('split-pp', whole(KM * 2 * 7.0 / 100 * price / 4));
    }
    let edited = false;
    input.addEventListener('input', () => { edited = true; render(); });
    render();

    fetch('data/prices.json').then(r => r.ok ? r.json() : null).then(data => {
      const ca = data && data.countries && data.countries.CA;
      if (!ca) return;
      const city = name => ca.cities.find(c => c.name === name && c.prices.regular);
      const start = city(PRICE_CITY);
      if (!start) return;
      const day = new Date(start.date + 'T12:00:00').toLocaleDateString('en-CA', { month: 'long', day: 'numeric' });
      if (!edited) {
        input.value = start.prices.regular.toFixed(3);
        render();
        setText('price-note', `Costs use the average regular gas price in ${start.name} on ${day} ($${start.prices.regular.toFixed(3)}/L), from ${ca.source}.`);
      }
      const stops = STOPS.map(city).filter(Boolean);
      if (stops.length < 2) return;
      const note = document.getElementById('city-prices');
      const cheapest = stops.reduce((a, b) => (b.prices.regular < a.prices.regular ? b : a));
      const priciest = stops.reduce((a, b) => (b.prices.regular > a.prices.regular ? b : a));
      const gap = Math.round((priciest.prices.regular - cheapest.prices.regular) * 100);
      note.textContent = `Average regular gas on ${day}: ` + stops.map(c => `${c.name} $${c.prices.regular.toFixed(3)}/L`).join(', ') + ` (${ca.source}).`
        + (gap >= 2 ? ` Right now ${cheapest.name} is the cheapest of these, about ${gap}¢ a litre less than ${priciest.name}.` : '');
      note.hidden = false;
    }).catch(() => {});
  })();
</script>"""


def cta_link(frm, to):
    return f"/?from={quote(frm)}&amp;to={quote(to)}&amp;country=CA"


def page(r):
    km = r["km"]
    litres = {name: km * l / 100 for name, l in VEHICLES}
    r0 = lambda x: int(x + 0.5)  # round half up, like the page script
    car, suv = litres["Compact car"], litres["Mid-size SUV"]
    rt = km * 2 * 7.0 / 100 * FALLBACK_PRICE
    faq_ld = json.dumps({
        "@context": "https://schema.org", "@type": "FAQPage",
        "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in r["faqs"]],
    }, indent=1, ensure_ascii=False)
    faqs = "\n".join(f"  <details><summary>{html.escape(q)}</summary><p>{html.escape(a)}</p></details>" for q, a in r["faqs"])
    others = "\n".join(f'    <li><a href="{href}">{html.escape(text)}</a></li>' for href, text in r["others"])
    url = f"https://tripfuelcost.ca/{r['slug']}.html"
    script = SCRIPT % {
        "km": km, "price_city": json.dumps(r["price_city"]), "stops": json.dumps(r["stops"]),
        "vehicles": json.dumps([[n, l] for n, l in VEHICLES]),
    }
    return f"""<!doctype html>
<html lang="en-CA">
<head>
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-55PYKGQ2VE"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){{dataLayer.push(arguments);}}
  gtag('js', new Date());

  gtag('config', 'G-55PYKGQ2VE');
</script>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{r['from']} to {r['to']} Gas Cost (2026) – How Much Gas for the Drive? | TripFuelCost</title>
<meta name="description" content="{html.escape(r['description'])}">
<link rel="canonical" href="{url}">
<meta property="og:title" content="{r['from']} to {r['to']} Gas Cost">
<meta property="og:description" content="{html.escape(r['og'])}">
<meta property="og:type" content="article">
<meta property="og:url" content="{url}">
<meta name="theme-color" content="#0E5A3A">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⛽</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Overpass:wght@400;600;700;800&display=swap" rel="stylesheet">
<script type="application/ld+json">
{faq_ld}
</script>
<style>
{CSS}
</style>
</head>
<body>
<header class="site-bar">
  <div>
    <a class="brand" href="/">⛽ <span>TripFuel</span>Cost</a>
    <nav><a href="/">Fuel cost calculator</a></nav>
  </div>
</header>
<main>
  <h1>{r['from']} to {r['to']} gas cost</h1>

  <div class="route" aria-label="Route summary">
    <div class="road"><span>{r['from']} to {r['to']}</span><span>{km} km</span></div>
    <p>{r['route_line']}</p>
  </div>

  <p class="answer"><strong>Quick answer:</strong> driving one way from {r['from']} to {r['to']} takes about {r0(car)} litres of gas in a compact car and about {r0(suv)} litres in a mid-size SUV. At $<span id="qa-price">{FALLBACK_PRICE:.2f}</span> per litre, that's an estimated <strong>$<span id="qa-car">{r0(car * FALLBACK_PRICE)}</span> for a car</strong> and <strong>$<span id="qa-suv">{r0(suv * FALLBACK_PRICE)}</span> for an SUV</strong>. Enter a different price below to update the costs.</p>
  <p class="small" id="price-note">Costs use a typical {r['price_city']} gas price.</p>

  <!-- AD SLOT: add an ad unit here after AdSense approval -->

  <h2>Estimated gas cost by type of vehicle</h2>
  <label class="price" for="gas-price">Gas price per litre: $<input type="number" id="gas-price" inputmode="decimal" min="0" step="0.01" value="{FALLBACK_PRICE:.2f}"></label>
  <div class="table-scroll">
    <table>
      <thead><tr><th>Vehicle</th><th class="num">Fuel use</th><th class="num">Litres</th><th class="num">Est. one way</th><th class="num">Est. round trip</th></tr></thead>
      <tbody id="cost-rows"></tbody>
    </table>
  </div>
  <p class="small">These are estimates based on {km} km and typical combined fuel ratings. Your actual cost depends on your car, speed, traffic, weather and the price you pay at the pump.</p>
  <p><a class="cta" href="{cta_link(r['cta_from'], r['cta_to'])}">Calculate for your exact car</a></p>

  <h2>Splitting the cost</h2>
  <p>{r['split_intro']} In a compact car at $<span id="split-price">{FALLBACK_PRICE:.2f}</span> per litre, a round trip costs about $<span id="split-rt">{r0(rt)}</span> in gas. Split four ways, that's around $<span id="split-pp">{r0(rt / 4)}</span> per person, {r['split_compare']}</p>

  <h2>Where to fill up</h2>
{r['fill_up']}
  <p class="small" id="city-prices" hidden></p>

  <h2>Tolls on the way</h2>
{r['tolls']}

  <!-- AD SLOT: add an ad unit here after AdSense approval -->

  <h2>Driving this route in winter</h2>
{r['winter']}

  <h2>How to spend less on gas</h2>
  <ul>
{r['tips']}
  </ul>

  <h2>Common questions</h2>
{faqs}

  <h2>Other trips</h2>
  <ul>
{others}
  </ul>
  <p>For any other trip, use the <a href="/">trip fuel cost calculator</a>: enter your route and your car to see the estimated cost with today's gas prices.</p>
</main>
<footer class="site-foot">
  <p><strong>All costs on this page are estimates for trip planning and are not guaranteed.</strong> Gas prices: daily city averages from Natural Resources Canada.</p>
  <p><a href="/">Fuel cost calculator</a> · <a href="/privacy.html">Privacy policy</a> · © 2026 TripFuelCost</p>
</footer>

{script}
</body>
</html>
"""


ROUTES = [
    {
        "slug": "toronto-to-ottawa-gas-cost", "from": "Toronto", "to": "Ottawa", "km": 450,
        "description": "How much gas does it cost to drive from Toronto to Ottawa? Estimated costs for hybrids, cars, SUVs and pickups, round-trip totals, today's prices along the 401, and tips to spend less.",
        "og": "Estimated gas cost for the 450 km drive from Toronto to Ottawa for hybrids, cars, SUVs and pickups, using today's prices.",
        "route_line": "About 4.5–5 hours via Highway 401 east and Highway 416 north. No tolls on the main route.",
        "price_city": "Toronto", "stops": ["Toronto", "Oshawa", "Kingston", "Ottawa"],
        "cta_from": "Toronto, Ontario, Canada", "cta_to": "Ottawa, Ontario, Canada",
        "split_intro": "Driving is often the cheapest way to make this trip with friends or family.",
        "split_compare": "which is often less than a one-way train ticket between the two cities.",
        "fill_up": """  <p>You'll drive most of this trip on Highway 401, where gas prices can differ by several cents a litre from one city to the next. On a full tank, picking the cheaper stop can save a few dollars.</p>
  <p>Good places to stop:</p>
  <ul>
    <li><strong>Kingston</strong>, a little over halfway, with plenty of stations and food just off the 401.</li>
    <li><strong>Brockville</strong>, the last larger town before you turn north onto Highway 416.</li>
    <li><strong>ONroute service centres</strong> along the 401, which are convenient but often charge a little more than stations in town.</li>
  </ul>""",
        "tolls": """  <p>The standard route, Highway 401 east to Highway 416 north, has no tolls. If your GPS sends you onto Highway 407 ETR to get around Toronto traffic, you'll be billed by licence plate, which can add a noticeable amount to the trip. Set your map app to avoid tolls if you'd rather skip it.</p>""",
        "winter": """  <p>Eastern Ontario gets regular snow and freezing rain from December to March, and the open stretches of Highway 416 can see blowing snow. Cold weather, winter tires and slower speeds all raise fuel use, so budget roughly 15–25% more gas than in summer. Check road conditions on Ontario 511 before you leave, and keep your tank above half in case of closures.</p>""",
        "tips": """    <li>Keep to the speed limit. Driving at 120 km/h instead of 100 km/h can use noticeably more fuel.</li>
    <li>Leave Toronto before 7 a.m. or after 9 a.m. to avoid stop-and-go traffic on the 401.</li>
    <li>Use cruise control on the long, flat stretches of the 401 and 416.</li>
    <li>Check your tire pressure and take off empty roof racks or cargo boxes before you leave.</li>""",
        "faqs": [
            ("How much gas does it take to drive from Toronto to Ottawa?",
             "The drive is about 450 km. A compact car using 7 L/100 km needs about 32 litres, a mid-size SUV about 41 litres, and a pickup truck about 56 litres."),
            ("Can I make it on one tank?",
             "Most cars can. A car with a 50-litre tank using 7 L/100 km can go about 700 km, so you'd arrive with fuel to spare. Larger trucks and SUVs may need a stop, especially in winter."),
            ("Are there tolls between Toronto and Ottawa?",
             "The main route along Highway 401 and Highway 416 has no tolls. Highway 407 ETR near Toronto is an optional toll road; you can avoid it by staying on the 401."),
            ("How long is the drive from Toronto to Ottawa?",
             "Usually about 4.5 to 5 hours without major traffic. Leaving Toronto at rush hour or driving in winter weather can add an hour or more."),
            ("Is there a shorter route?",
             "Highway 7 through Peterborough and Perth is a little shorter in distance, but it's mostly two-lane road through towns, so it usually takes longer than the 401 and 416."),
        ],
        "others": [("sudbury-to-toronto-gas-cost.html", "Sudbury to Toronto gas cost"),
                   ("toronto-to-montreal-gas-cost.html", "Toronto to Montreal gas cost")],
    },
    {
        "slug": "sudbury-to-toronto-gas-cost", "from": "Sudbury", "to": "Toronto", "km": 390,
        "description": "How much gas does it cost to drive from Sudbury to Toronto? Estimated costs for hybrids, cars, SUVs and pickups, round-trip totals, today's Sudbury gas price, and tips for Highway 69 and the 400.",
        "og": "Estimated gas cost for the 390 km drive from Sudbury to Toronto for hybrids, cars, SUVs and pickups, using today's prices.",
        "route_line": "About 4–4.5 hours via Highway 69 and Highway 400. No tolls on the main route.",
        "price_city": "Sudbury", "stops": ["Sudbury", "Barrie", "Toronto"],
        "cta_from": "Greater Sudbury, Ontario, Canada", "cta_to": "Toronto, Ontario, Canada",
        "split_intro": "Driving is often the cheapest way to make this trip with friends or family, especially for students heading home for the weekend.",
        "split_compare": "which is often less than a one-way bus ticket between the two cities.",
        "fill_up": """  <p>Start with a full tank. Gas stations are few and far between on Highway 69 between Sudbury and Parry Sound, and there's no reason to risk running low on that stretch, especially at night or in winter.</p>
  <p>Good places to stop:</p>
  <ul>
    <li><strong>Sudbury</strong>, before you leave. Compare today's Sudbury and Toronto prices below to see whether it's the better place to fill up.</li>
    <li><strong>Parry Sound</strong>, roughly halfway, with stations and food just off the highway.</li>
    <li><strong>Barrie</strong> and the <strong>ONroute service centres</strong> on Highway 400, which are convenient but often charge a little more than stations in town.</li>
  </ul>""",
        "tolls": """  <p>The standard route, Highway 69 south to Highway 400, has no tolls. If your GPS sends you onto Highway 407 ETR near Toronto, you'll be billed by licence plate. Set your map app to avoid tolls if you'd rather skip it.</p>""",
        "winter": """  <p>The Parry Sound area is in the Georgian Bay snowbelt, so lake-effect snow squalls can drop visibility quickly between November and March. Cold weather, winter tires and slower speeds all raise fuel use, so budget roughly 15–25% more gas than in summer. Check road conditions on Ontario 511 before you leave and keep your tank above half, since services are limited north of Parry Sound.</p>
  <p>Watch for deer and moose on Highway 69, especially at dawn and dusk.</p>""",
        "tips": """    <li>Keep to the speed limit. Driving at 120 km/h instead of 100 km/h can use noticeably more fuel.</li>
    <li>Avoid Highway 400 southbound on summer Sunday afternoons and holiday Mondays, when cottage traffic can turn it into stop-and-go.</li>
    <li>Use cruise control on the long stretches of Highway 69 and the 400.</li>
    <li>Check your tire pressure and take off empty roof racks or cargo boxes before you leave.</li>""",
        "faqs": [
            ("How much gas does it take to drive from Sudbury to Toronto?",
             "The drive is about 390 km. A compact car using 7 L/100 km needs about 27 litres, a mid-size SUV about 35 litres, and a pickup truck about 49 litres."),
            ("Can I make it on one tank?",
             "Yes, almost any car can. A car with a 50-litre tank using 7 L/100 km can go about 700 km. Still, start with a full tank, because stations are limited between Sudbury and Parry Sound."),
            ("Are there tolls between Sudbury and Toronto?",
             "The main route along Highway 69 and Highway 400 has no tolls. Highway 407 ETR near Toronto is an optional toll road."),
            ("How long is the drive from Sudbury to Toronto?",
             "Usually about 4 to 4.5 hours. Summer weekend cottage traffic on Highway 400, rush hour in Toronto, or winter weather can add an hour or more."),
            ("Is gas cheaper in Sudbury or Toronto?",
             "It changes over time. This page shows today's average prices for Sudbury, Barrie and Toronto so you can pick the cheaper place to fill up."),
        ],
        "others": [("toronto-to-ottawa-gas-cost.html", "Toronto to Ottawa gas cost"),
                   ("toronto-to-montreal-gas-cost.html", "Toronto to Montreal gas cost")],
    },
]

if __name__ == "__main__":
    wanted = set(sys.argv[1:])
    unknown = wanted - {r["slug"] for r in ROUTES}
    if unknown:
        sys.exit(f"Unknown route(s): {', '.join(sorted(unknown))}")
    for r in ROUTES:
        if wanted and r["slug"] not in wanted:
            continue
        (OUT / f"{r['slug']}.html").write_text(page(r), encoding="utf-8")
        print(f"wrote {r['slug']}.html")
